"""확정 기록을 종합하는 성장 분석. DB 조회는 AI 서버, 결과 저장은 백엔드가 맡는다."""

import hashlib
import json
import logging
import re
import unicodedata
from pathlib import Path
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter
from pydantic import Field, ValidationError
from starlette.concurrency import run_in_threadpool

from .analysis import AnalysisError, structured_response
from .database import DatabaseError
from .schemas import StrictModel, Text, Identifier, Change

PROMPT_VERSION = "journey-v5"
logger = logging.getLogger(__name__)


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
    axis: Identifier
    title: Text
    description: Text
    comparison: Comparison | None
    evidence: list[Evidence] = Field(min_length=1, max_length=10)


class AnalysisType(StrictModel):
    value: Identifier
    label: str = Field(min_length=1, max_length=40)
    icon: str = Field(min_length=1, max_length=16)


class AnalysisAxis(StrictModel):
    value: Identifier
    label: str = Field(min_length=1, max_length=40)


class JourneyAnalysis(StrictModel):
    summary: Summary
    typeOptions: list[AnalysisType] = Field(max_length=8)
    axisOptions: list[AnalysisAxis] = Field(max_length=8)
    badges: list[Badge] = Field(max_length=10)
    events: list[Event] = Field(max_length=20)


class EvidenceSelection(StrictModel):
    evidenceId: Identifier


class ModelSummary(Summary):
    evidence: list[EvidenceSelection] = Field(min_length=1, max_length=20)


class ModelBadge(Badge):
    evidence: list[EvidenceSelection] = Field(min_length=1, max_length=5)


class ModelEvent(Event):
    evidence: list[EvidenceSelection] = Field(min_length=1, max_length=10)


class JourneyModelAnalysis(JourneyAnalysis):
    """모델 전용 계약. 공개 API에는 원문으로 복원한 JourneyAnalysis만 전달한다."""
    summary: ModelSummary
    badges: list[ModelBadge] = Field(max_length=10)
    events: list[ModelEvent] = Field(max_length=20)


def evidence_failure(reason, location):
    diagnostic_id = str(uuid4())
    # 모델 원문·사용자 기록·키를 남기지 않고 실패 지점만 추적한다.
    logger.warning("journey_evidence_validation %s", json.dumps({
        "diagnosticId": diagnostic_id, "promptVersion": PROMPT_VERSION,
        "reason": reason, "location": location,
    }))
    return AnalysisError(502, "journey_evidence_invalid",
                         f"성장 분석 근거를 확인하지 못했어요. 기존 결과는 유지돼요. 진단 ID: {diagnostic_id}")


def prepare_journey_input(context):
    """연속 원문 후보를 생성한다. 원본 문맥과 스냅샷 해시는 수정하지 않는다."""
    catalog, records = [], []
    for record in context["records"]:
        records.append({key: value for key, value in record.items() if key not in {"message", "summary"}})
        seen = set()
        for source in ["message", "summary"]:
            # 문장/줄 단위로 나누되 긴 구간도 800자 이하의 연속 원문으로 보존한다.
            for passage in re.split(r"(?<=[.!?。！？])\s+|\n+", record.get(source) or ""):
                passage = passage.strip()
                while passage:
                    end = min(len(passage), 800)
                    if len(passage) > 800:
                        space = passage.rfind(" ", 400, 800)
                        if space != -1:
                            end = space
                    quote, passage = passage[:end].strip(), passage[end:].strip()
                    if quote and quote not in seen:
                        seen.add(quote)
                        catalog.append({"id": f"evidence-{len(catalog) + 1}", "recordId": record["id"],
                                        "source": source, "quote": quote})
                        if len(catalog) > 2000:
                            raise AnalysisError(422, "journey_context_limit", "성장 분석 근거가 너무 많아요. 분석 범위 분할이 필요해요.")
    if not catalog:
        raise AnalysisError(422, "journey_evidence_missing", "성장 분석에 사용할 저장 원문이 없어요.")
    payload = {"records": records, "recordCount": context["recordCount"], "evidenceCatalog": catalog}
    if len(json.dumps(payload, ensure_ascii=False)) > 250_000:
        raise AnalysisError(422, "journey_context_limit", "성장 분석 근거 문맥이 너무 커요. 분석 범위 분할이 필요해요.")
    return payload


def resolve_journey_evidence(selected, catalog):
    sources = {item["id"]: item for item in catalog}
    data = selected.model_dump()
    groups = [("summary", data["summary"])]
    groups += [(f"badges[{i}]", item) for i, item in enumerate(data["badges"])]
    groups += [(f"events[{i}]", item) for i, item in enumerate(data["events"])]
    for location, group in groups:
        restored, seen = [], set()
        for index, reference in enumerate(group["evidence"]):
            source = sources.get(reference["evidenceId"])
            if source is None:
                raise evidence_failure("unknown_evidence_id", f"{location}.evidence[{index}]")
            key = (source["recordId"], source["quote"])
            if key not in seen:
                seen.add(key)
                restored.append({"recordId": key[0], "quote": key[1]})
        group["evidence"] = restored
    return JourneyAnalysis.model_validate(data)


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
    axis: Identifier
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


def normalize_journey_options(result):
    """이벤트/근거는 유지하고 정확히 같은 라벨의 별칭과 미사용 선택지만 정리한다."""
    result = result.model_copy(deep=True)

    def normalize(field, options, label):
        used = {getattr(event, field) for event in result.events}
        by_id, by_label, aliases, selected = {}, {}, {}, []
        for option in options:
            if option.value not in used:
                continue
            name = ' '.join(unicodedata.normalize('NFKC', option.label).split())
            key = name.casefold()
            if option.value == 'all' or not key or key in {'전체', '전체 분야', '전체분야'}:
                raise AnalysisError(502, 'invalid_journey', f'성장 {label}에 사용할 수 없는 분류명이 있어요.')
            if field == 'type' and not option.icon.strip():
                raise AnalysisError(502, 'invalid_journey', '성장 유형의 아이콘이 비어 있어요.')
            if option.value in by_id:
                if by_id[option.value] != key:
                    raise AnalysisError(502, 'invalid_journey', f'성장 {label}의 같은 식별자에 서로 다른 분류명이 있어요.')
                continue
            by_id[option.value] = key
            if key in by_label:
                aliases[option.value] = by_label[key]
            else:
                option.label = name
                if field == 'type':
                    option.icon = option.icon.strip()
                by_label[key] = option.value
                aliases[option.value] = option.value
                selected.append(option)
        if used - aliases.keys():
            raise AnalysisError(502, 'invalid_journey', f'성장 이벤트가 등록되지 않은 {label}을 참조해요. 다시 분석해 주세요.')
        for event in result.events:
            setattr(event, field, aliases[getattr(event, field)])
        return selected

    result.typeOptions = normalize('type', result.typeOptions, '유형')
    result.axisOptions = normalize('axis', result.axisOptions, '분야')
    return result


def validate_journey(result, context):
    """모델이 반환한 ID와 인용문을 실제 확정 기록으로 재검증한다."""
    records = {record["id"]: record for record in context["records"]}
    # AI가 새 분류를 만들 수 있지만 이벤트 참조·중복·미사용 분류는 검증한다.
    types = [option.value for option in result.typeOptions]
    labels = [' '.join(unicodedata.normalize("NFKC", option.label).split()).casefold() for option in result.typeOptions]
    if ("all" in types or len(set(types)) != len(types) or len(set(labels)) != len(labels)
            or not all(labels) or any(not option.icon.strip() for option in result.typeOptions)
            or set(types) != {event.type for event in result.events}):
        raise AnalysisError(502, "invalid_journey", "성장 분석 분류가 중복되거나 이벤트와 일치하지 않아요.")
    # 분야도 모델이 생성한다. 전체 선택지는 서버만 추가하고 실제 이벤트에 쓰인 분야만 허용한다.
    axes = [option.value for option in result.axisOptions]
    axis_labels = [" ".join(unicodedata.normalize("NFKC", option.label).split()).casefold() for option in result.axisOptions]
    if ("all" in axes or len(set(axes)) != len(axes) or len(set(axis_labels)) != len(axis_labels)
            or not all(axis_labels) or any(label in {"전체", "전체 분야", "전체분야"} for label in axis_labels)
            or set(axes) != {event.axis for event in result.events}):
        raise AnalysisError(502, "invalid_journey", "성장 분야가 중복되거나 이벤트와 일치하지 않아요.")
    def check(evidence, location):
        for index, item in enumerate(evidence):
            record = records.get(item.recordId)
            # 파일명이나 AI가 새로 만든 문장을 원문 근거로 인정하지 않는다.
            if not record or not any(item.quote in (record.get(key) or "") for key in ["message", "summary"]):
                raise evidence_failure("record_or_quote_mismatch", f"{location}.evidence[{index}]")
    if not result.summary.evidence:
        raise AnalysisError(502, "invalid_journey", "성장 요약의 근거가 없어요.")
    check(result.summary.evidence, "summary")
    for index, badge in enumerate(result.badges):
        check(badge.evidence, f"badges[{index}]")
    for index, event in enumerate(result.events):
        check(event.evidence, f"events[{index}]")
        if not any(records[item.recordId]["activityId"] == event.activityId for item in event.evidence):
            raise evidence_failure("activity_mismatch", f"events[{index}].activityId")
        if event.comparison and len({item.recordId for item in event.evidence}) < 2:
            raise evidence_failure("comparison_needs_distinct_records", f"events[{index}].comparison")
    return result


async def analyze_journey(database, config):
    context = await run_in_threadpool(journey_context, database)
    if not context["records"]:
        raise AnalysisError(422, "journey_records_missing", "홈에서 기록을 저장한 뒤 성장 분석을 실행해 주세요.")
    prompt = Path(__file__).with_name("prompts").joinpath("journey.md").read_text(encoding="utf-8")
    payload = prepare_journey_input(context)
    selected = await structured_response(config, instructions=prompt, input=json.dumps(payload, ensure_ascii=False), schema=JourneyModelAnalysis)
    result = resolve_journey_evidence(selected, payload["evidenceCatalog"])
    result = normalize_journey_options(result)
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
                   "axisOptions": [{"value": "all", "label": "전체 분야"}, *[option.model_dump() for option in result.axisOptions]], "events": events},
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
