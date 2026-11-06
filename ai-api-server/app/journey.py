"""확정 기록을 종합하는 성장 분석. DB 조회는 AI 서버, 결과 저장은 백엔드가 맡는다."""

import hashlib
import json
import unicodedata
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import Field, ValidationError
from starlette.concurrency import run_in_threadpool

from .analysis import AnalysisError, structured_response
from .database import DatabaseError
from .schemas import StrictModel, Text, Identifier, Change

PROMPT_VERSION = "journey-v2"
AXIS_OPTIONS = [
    {"value": "all", "label": "전체 분야"}, {"value": "planning", "label": "기획 / PM"},
    {"value": "technology", "label": "AI·기술"}, {"value": "data", "label": "데이터"},
    {"value": "collaboration", "label": "발표·협업"}, {"value": "other", "label": "기타"},
]


class Evidence(StrictModel):
    recordId: Identifier
    quote: Text


class Summary(StrictModel):
    title: Text
    description: Text
    evidence: list[Evidence] = Field(max_length=20)


class Badge(StrictModel):
    label: Text
    icon: str = Field(min_length=1, max_length=16)
    evidence: list[Evidence] = Field(min_length=1, max_length=5)


class Comparison(StrictModel):
    before: Text
    after: Text


class Event(StrictModel):
    activityId: Identifier
    type: Identifier
    axis: Literal["planning", "technology", "data", "collaboration", "other"]
    title: Text
    description: Text
    comparison: Comparison | None
    evidence: list[Evidence] = Field(min_length=1, max_length=10)


class AnalysisType(StrictModel):
    value: Identifier
    label: str = Field(min_length=1, max_length=40)
    icon: str = Field(min_length=1, max_length=16)


class JourneyAnalysis(StrictModel):
    summary: Summary
    typeOptions: list[AnalysisType] = Field(max_length=8)
    badges: list[Badge] = Field(max_length=10)
    events: list[Event] = Field(max_length=20)


class FileReference(StrictModel):
    id: Identifier
    name: Text


class ActivityMetadata(StrictModel):
    category: Text | None
    role: Text | None
    summary: Text | None
    startDate: Text | None
    endDate: Text | None


class ContextRecord(StrictModel):
    id: Identifier
    activityId: Identifier
    activityName: Text
    message: str
    summary: Text
    changes: list[Change]
    savedAt: Text
    updatedAt: Text
    activity: ActivityMetadata
    files: list[FileReference]


class JourneyContext(StrictModel):
    records: list[ContextRecord]
    recordCount: int
    sourceFingerprint: str


class SavedActivity(StrictModel):
    id: Identifier
    name: Text


class SavedComparison(Comparison):
    evidence: list[Text]


class SavedBadge(Badge):
    id: Identifier


class Option(StrictModel):
    value: Identifier
    label: Text
    # '전체'와 분야 선택지는 아이콘이 없을 수 있다.
    icon: str | None = None


class SavedEvent(StrictModel):
    id: str
    occurredAt: str
    activity: SavedActivity
    type: Identifier
    axis: Literal["planning", "technology", "data", "collaboration", "other"]
    title: str
    description: str
    evidence: list[Evidence]
    comparison: SavedComparison | None = None


class SavedJourney(StrictModel):
    source: Literal["api"]
    summary: Summary
    badges: list[SavedBadge]
    typeOptions: list[Option]
    axisOptions: list[Option]
    events: list[SavedEvent]


class JourneyResponse(StrictModel):
    sourceFingerprint: str
    recordCount: int
    model: str
    promptVersion: str
    result: SavedJourney


def journey_context(database):
    """한 스냅샷에서 확정 기록·실제 자료 ID를 조회하고 외부 호출 전에 연결을 닫는다."""
    with database.connect() as connection:
        database.check_schema(connection)
        connection.execute("BEGIN")
        rows = [list(row) for row in connection.execute(
            "SELECT r.id, r.activity_id, a.name, r.message, r.reply, r.created_at, r.updated_at, "
            "a.category, a.role, a.summary, a.start_date, a.end_date "
            "FROM records r JOIN activities a ON a.id = r.activity_id ORDER BY r.id")]
        files = [list(row) for row in connection.execute(
            "SELECT r.id AS record_id, f.id, f.name FROM files f "
            "JOIN records r ON r.analysis_id = f.analysis_id ORDER BY r.id, f.id")]
    fingerprint = hashlib.sha256(json.dumps([rows, files], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    # 전체 기록을 분석했다고 오해하지 않도록 한도를 넘기면 명시적으로 거절한다.
    if len(rows) > 100:
        raise AnalysisError(422, "journey_context_limit", "현재 성장 분석은 확정 기록 100개까지 지원해요. 분석 범위 분할이 필요해요.")
    records = []
    try:
        for row in rows:
            reply = json.loads(row[4])["analysis"]
            records.append({
                "id": row[0], "activityId": row[1], "activityName": row[2], "message": row[3],
                "summary": reply["summary"], "changes": reply.get("changes", []),
                "savedAt": row[5], "updatedAt": row[6],
                "activity": dict(zip(["category", "role", "summary", "startDate", "endDate"], row[7:])),
                "files": [{"id": file[1], "name": file[2]} for file in files if file[0] == row[0]],
            })
    except (ValueError, KeyError, TypeError):
        raise DatabaseError("database_context_invalid", "저장된 기록의 성장 분석 문맥을 확인할 수 없어요.") from None
    context = {"records": records, "recordCount": len(records), "sourceFingerprint": fingerprint}
    if len(json.dumps(context, ensure_ascii=False)) > 250_000:
        raise AnalysisError(422, "journey_context_limit", "성장 분석 문맥이 너무 커요. 분석 범위 분할이 필요해요.")
    try:
        # DB에 보관된 문맥도 공개 응답과 같은 타입으로 검사한다.
        JourneyContext.model_validate(context)
    except ValidationError:
        raise DatabaseError("database_context_invalid", "저장된 성장 분석 문맥의 형식을 확인해 주세요.") from None
    return context


def validate_journey(result, context):
    """모델이 반환한 ID와 인용문을 실제 확정 기록으로 재검증한다."""
    records = {record["id"]: record for record in context["records"]}
    # AI가 새 분류를 만들 수 있지만 이벤트 참조·중복·미사용 분류는 검증한다.
    types = [option.value for option in result.typeOptions]
    labels = [unicodedata.normalize("NFKC", option.label).strip().casefold() for option in result.typeOptions]
    if ("all" in types or len(set(types)) != len(types) or len(set(labels)) != len(labels)
            or not all(labels) or any(not option.icon.strip() for option in result.typeOptions)
            or set(types) != {event.type for event in result.events}):
        raise AnalysisError(502, "invalid_journey", "성장 분석 분류가 중복되거나 이벤트와 일치하지 않아요.")
    def check(evidence):
        for item in evidence:
            record = records.get(item.recordId)
            # 파일명이나 AI가 새로 만든 문장을 원문 근거로 인정하지 않는다.
            if not record or not any(item.quote in (record.get(key) or "") for key in ["message", "summary"]):
                raise AnalysisError(502, "invalid_journey", "성장 분석 근거가 저장된 기록과 일치하지 않아요.")
    if not result.summary.evidence:
        raise AnalysisError(502, "invalid_journey", "성장 요약의 근거가 없어요.")
    check(result.summary.evidence)
    for badge in result.badges:
        check(badge.evidence)
    for event in result.events:
        check(event.evidence)
        if not any(records[item.recordId]["activityId"] == event.activityId for item in event.evidence):
            raise AnalysisError(502, "invalid_journey", "성장 이벤트의 활동과 근거 기록이 일치하지 않아요.")
        if event.comparison and len({item.recordId for item in event.evidence}) < 2:
            raise AnalysisError(502, "invalid_journey", "전후 비교에는 서로 다른 저장 기록의 근거가 필요해요.")
    return result


async def analyze_journey(database, config):
    context = await run_in_threadpool(journey_context, database)
    if not context["records"]:
        raise AnalysisError(422, "journey_records_missing", "홈에서 기록을 저장한 뒤 성장 분석을 실행해 주세요.")
    prompt = Path(__file__).with_name("prompts").joinpath("journey.md").read_text(encoding="utf-8")
    result = await structured_response(config, instructions=prompt, input=json.dumps(context, ensure_ascii=False), schema=JourneyAnalysis)
    validate_journey(result, context)
    records = {record["id"]: record for record in context["records"]}
    events = []
    for index, event in enumerate(result.events):
        activity = next(records[item.recordId] for item in event.evidence if records[item.recordId]["activityId"] == event.activityId)
        item = event.model_dump(exclude={"activityId", "comparison"})
        item.update(id=f"event-{index}", activity={"id": event.activityId, "name": activity["activityName"]},
                    occurredAt=max(records[e.recordId]["savedAt"] for e in event.evidence)[:7])
        if event.comparison:
            item["comparison"] = {**event.comparison.model_dump(), "evidence": [e.quote for e in event.evidence]}
        events.append(item)
    return {
        "sourceFingerprint": context["sourceFingerprint"], "recordCount": context["recordCount"],
        "model": config.openai_model, "promptVersion": PROMPT_VERSION,
        "result": {"source": "api", "summary": result.summary.model_dump(),
                   "badges": [{"id": f"badge-{i}", **badge.model_dump()} for i, badge in enumerate(result.badges)],
                   "typeOptions": [{"value": "all", "label": "전체"}, *[option.model_dump() for option in result.typeOptions]],
                   "axisOptions": AXIS_OPTIONS, "events": events},
    }


def journey_router(database, config):
    router = APIRouter(tags=["성장 분석"])

    @router.get("/api/journey/context", response_model=JourneyContext)
    def context():
        """확정 기록만 조회한다. 모델 호출·DB 변경 없음."""
        return journey_context(database)

    @router.post("/api/analyze/journey", response_model=JourneyResponse, response_model_exclude_none=True,
                 responses={422: {"description": "확정 기록 없음·분석 문맥 한도·분석 거절"},
                            429: {"description": "모델 호출 제한"}, 502: {"description": "분석 실패·근거 불일치"},
                            503: {"description": "설정·DB 오류"}, 504: {"description": "분석 시간 초과"}})
    async def analyze():
        """실제 성장 분석. 결과를 반환하며 확정 저장은 백엔드가 담당한다."""
        return await analyze_journey(database, config)

    return router
