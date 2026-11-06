"""확정 기록으로 활동 전체 정보를 종합한다. 결과 저장은 백엔드가 맡는다."""

from datetime import date
import hashlib
import json
from pathlib import Path
import re
from typing import Literal

from fastapi import APIRouter
from pydantic import Field, model_validator
from starlette.concurrency import run_in_threadpool

from .analysis import AnalysisError, structured_response
from .database import DatabaseError
from .schemas import StrictModel, Text, Identifier


class Evidence(StrictModel):
    recordId: Identifier
    quote: Text


class Fact(StrictModel):
    value: Text
    evidence: list[Evidence] = Field(min_length=1, max_length=10)


class StatusFact(StrictModel):
    value: Literal["진행 중", "완료"]
    evidence: list[Evidence] = Field(min_length=1, max_length=10)


class DateFact(Fact):
    @model_validator(mode="after")
    def valid_date(self):
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])(?:-\d{2})?", self.value):
            raise ValueError("활동 날짜는 YYYY-MM 또는 YYYY-MM-DD 형식이어야 합니다.")
        date.fromisoformat(self.value if len(self.value) == 10 else self.value + "-01")
        return self


class Period(StrictModel):
    start: DateFact | None
    end: DateFact | None


class ActivityMetadata(StrictModel):
    summary: Fact
    status: StatusFact | None
    role: Fact | None
    period: Period


def activity_context(database, activity_id):
    with database.connect() as connection:
        database.check_schema(connection)
        connection.execute("BEGIN")
        activity = connection.execute("SELECT * FROM activities WHERE id = ?", (activity_id,)).fetchone()
        if not activity:
            raise AnalysisError(404, "activity_missing", "활동을 찾을 수 없어요.")
        rows = connection.execute("SELECT id, message, reply, created_at, updated_at FROM records WHERE activity_id = ? ORDER BY id", (activity_id,)).fetchall()
        files = connection.execute("""SELECT r.id, f.id, f.name FROM files f JOIN records r ON r.analysis_id = f.analysis_id
            WHERE r.activity_id = ? ORDER BY r.id, f.id""", (activity_id,)).fetchall()
        fingerprint = hashlib.sha256(json.dumps([[activity["id"], activity["name"], activity["category"]],
            [list(row) for row in rows], [list(row) for row in files]], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
        records = []
        for row in rows:
            try:
                analysis = json.loads(row["reply"])["analysis"]
                records.append({"id": row["id"], "message": row["message"], "summary": analysis["summary"],
                                "changes": analysis["changes"], "savedAt": row["created_at"], "updatedAt": row["updated_at"]})
            except (ValueError, KeyError, TypeError):
                raise DatabaseError("activity_records_invalid", "저장된 활동 기록을 확인하지 못했어요.") from None
        context = {"activity": {"id": activity["id"], "name": activity["name"], "category": activity["category"]},
                   "previous": {key: activity[key] for key in ["summary", "status", "role", "start_date", "end_date"]},
                   "records": records, "files": [list(row) for row in files],
                   "recordCount": len(records), "sourceFingerprint": fingerprint}
        if len(records) > 100 or len(json.dumps(context, ensure_ascii=False)) > 250000:
            raise AnalysisError(422, "activity_context_limit", "활동 분석 범위는 기록 100개·문맥 250000자 이내예요. 기록은 보존했어요.")
        return context


def validate_metadata(result, context):
    sources = {record["id"]: [record["message"], record["summary"]] for record in context["records"]}
    for fact in [result.summary, result.status, result.role, result.period.start, result.period.end]:
        if fact and any(not any(ref.quote in source for source in sources.get(ref.recordId, [])) for ref in fact.evidence):
            raise AnalysisError(502, "activity_evidence_invalid", "활동 정보의 근거가 저장된 기록과 일치하지 않아요.")
    start = result.period.start.value if result.period.start else context["previous"]["start_date"]
    end = result.period.end.value if result.period.end else context["previous"]["end_date"]
    if start and end and (start[:7] > end[:7] or len(start) == len(end) == 10 and start > end):
        raise AnalysisError(502, "activity_period_invalid", "활동 기간의 시작일과 종료일을 확인하지 못했어요.")


async def analyze_activity(database, config, activity_id):
    context = await run_in_threadpool(activity_context, database, activity_id)
    if not context["records"]:
        raise AnalysisError(422, "activity_records_missing", "저장된 자료가 있는 활동만 분석할 수 있어요.")
    prompt = Path(__file__).with_name("prompts").joinpath("activity_metadata.md").read_text(encoding="utf-8")
    result = await structured_response(config, instructions=prompt, input=json.dumps(context, ensure_ascii=False), schema=ActivityMetadata)
    validate_metadata(result, context)
    return {"sourceFingerprint": context["sourceFingerprint"], "recordCount": context["recordCount"],
            "model": config.openai_model, "promptVersion": "activity-metadata-v1", "metadata": result.model_dump()}


def activity_metadata_router(database, config):
    router = APIRouter()

    @router.post("/api/analyze/activities/{activity_id}")
    async def analyze(activity_id: str):
        return await analyze_activity(database, config, activity_id)

    return router
