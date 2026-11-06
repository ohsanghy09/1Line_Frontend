"""기존 백엔드 SQLite에 직접 연결한다. 스키마 생성·마이그레이션은 백엔드가 맡는다."""

from contextlib import contextmanager
from dataclasses import dataclass
import json
import sqlite3
from datetime import datetime, timezone
from uuid import uuid4

from pydantic import ValidationError

from .config import Settings
from .schemas import AnalysisContext, ContextSelection, DatabaseContext


class DatabaseError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(code)


@dataclass(frozen=True)
class DatabaseFile:
    id: str
    analysis_id: str
    name: str
    mime_type: str
    size: int
    content: bytes


# 조회에 필요한 최소 스키마만 검사하고 기존 스키마를 수정하지 않는다.
REQUIRED_COLUMNS = {
    "activities": {"id", "name", "category", "summary", "updated_at"},
    "records": {"id", "activity_id", "message", "reply", "created_at"},
    "analyses": {"id"},
    "files": {"id", "analysis_id", "name", "mime_type", "size", "content"},
    "timeline_events": {"id"},
    "analysis_jobs": {"id"},
}


class SharedDatabase:
    def __init__(self, settings: Settings):
        self.path = settings.database_path
        self.timeout = settings.ai_db_timeout_seconds

    @contextmanager
    def connect(self):
        # mode=rw로 오타 경로에 빈 DB를 생성하지 않는다. DB는 먼저 백엔드에서 준비한다.
        connection = None
        if not self.path.is_file():
            raise DatabaseError("database_missing", "공유 DB가 없어요. 백엔드를 먼저 실행하거나 AI_DB_PATH를 확인해 주세요.")
        try:
            connection = sqlite3.connect(self.path.as_uri() + "?mode=rw", uri=True,
                                         timeout=self.timeout, autocommit=True)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            yield connection
        except sqlite3.Error:
            # DB 파일 경로·SQL·사용자 데이터·원본 오류는 API 응답에 노출하지 않는다.
            raise DatabaseError("database_unavailable", "공유 DB에 접근하지 못했어요. 파일 권한과 잠금 상태를 확인해 주세요.") from None
        finally:
            if connection is not None:
                connection.close()

    def check_schema(self, connection):
        for table, required in REQUIRED_COLUMNS.items():
            # 테이블명은 위 고정 목록으로만 사용하며 사용자 입력을 SQL로 조합하지 않는다.
            columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table})")}
            if not required.issubset(columns):
                raise DatabaseError("database_schema_mismatch", "공유 DB 구조가 맞지 않아요. 기존 백엔드의 DB 마이그레이션을 확인해 주세요.")

    def status(self) -> dict:
        try:
            with self.connect() as connection:
                self.check_schema(connection)
                connection.execute("SELECT 1").fetchone()
            return {"status": "connected", "code": None}
        except DatabaseError as error:
            return {"status": "unavailable", "code": error.code}

    def read_context(self) -> DatabaseContext:
        with self.connect() as connection:
            self.check_schema(connection)
            # 한 스냅샷에서 활동과 확정 기록을 읽고 외부 모델 호출 전에 연결을 닫는다.
            connection.execute("BEGIN")
            activities_total = connection.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
            records_total = connection.execute("SELECT COUNT(*) FROM records").fetchone()[0]
            activities = [dict(row) for row in connection.execute(
                "SELECT id, name, category, summary, role, CASE WHEN status IN ('진행 중', '완료') THEN status ELSE NULL END AS status, "
                "start_date AS startDate, end_date AS endDate FROM activities ORDER BY updated_at DESC, rowid DESC LIMIT 50")]
            ids = [activity["id"] for activity in activities]
            records = []
            if ids:
                placeholders = ",".join("?" for _ in ids)
                rows = connection.execute(
                    f"SELECT id, activity_id, message, reply FROM records WHERE activity_id IN ({placeholders}) "
                    "ORDER BY created_at DESC, rowid DESC LIMIT 50", ids)
                for row in rows:
                    try:
                        reply = json.loads(row["reply"])
                        summary = reply["analysis"]["summary"]
                    except (ValueError, KeyError, TypeError):
                        raise DatabaseError("database_context_invalid", "저장된 분석 요약 형식을 확인할 수 없어요.") from None
                    records.append({"id": row["id"], "activityId": row["activity_id"],
                                    "message": row["message"] or None, "summary": summary})
            try:
                context = AnalysisContext(activities=activities, records=records)
            except ValidationError:
                raise DatabaseError("database_context_invalid", "저장된 분석 문맥의 형식이나 크기를 확인해 주세요.") from None
            selection = ContextSelection(
                activitiesTotal=activities_total, activitiesIncluded=len(activities),
                recordsTotal=records_total, recordsIncluded=len(records),
                truncated=activities_total > len(activities) or records_total > len(records))
            return DatabaseContext(context=context, selection=selection)

    def read_file(self, file_id: str) -> DatabaseFile | None:
        # 파일 원본이 필요한 후속 분석에서 사용한다. 문맥 조회에는 BLOB을 적재하지 않는다.
        with self.connect() as connection:
            self.check_schema(connection)
            row = connection.execute(
                "SELECT id, analysis_id, name, mime_type, size, content FROM files WHERE id = ?", (file_id,)
            ).fetchone()
            return DatabaseFile(**dict(row)) if row else None

    def read_conversation_context(self, conversation_id, valid_ids):
        # 최근 완료 대화만 문맥으로 읽는다. 별도의 정정 기록·수정 이력은 만들지 않는다.
        with self.connect() as connection:
            rows = connection.execute("""SELECT a.id, a.message, a.reply FROM analyses a
                JOIN ai_chat_jobs j ON j.analysis_id = a.id WHERE a.conversation_id = ? AND j.status = 'completed'
                ORDER BY a.created_at DESC, a.rowid DESC LIMIT 6""", (conversation_id,)).fetchall()
            messages, active_id, pending = [], None, False
            for row in reversed(rows):
                try:
                    reply = json.loads(row["reply"])
                    messages.extend([{"role": "user", "content": row["message"][:2000]},
                                     {"role": "assistant", "content": reply.get("content", "")[:2000]}])
                    saved = connection.execute("SELECT activity_id FROM records WHERE analysis_id = ?", (row["id"],)).fetchone()
                    proposal = (reply.get("analysis") or {}).get("activity", {})
                    target = saved[0] if saved else reply.get("updatedActivityId") or (proposal.get("id") if proposal.get("match") == "existing" else None)
                    if target in valid_ids:
                        active_id = target
                        pending = False
                    elif proposal.get("match") in {"new", "unresolved"}:
                        active_id, pending = None, True
                except (ValueError, TypeError, KeyError):
                    continue
            return {"active_activity_id": active_id, "active_activity_pending": pending, "recent_messages": messages[-12:]}

    def check_chat_schema(self, connection):
        self.check_schema(connection)
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(ai_chat_jobs)")}
        if not {"id", "request_key", "fingerprint", "analysis_id", "status", "phase", "input_json"}.issubset(columns):
            raise DatabaseError("database_schema_mismatch", "실제 분석 작업 스키마가 없어요. 백엔드를 재시작해 주세요.")

    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @contextmanager
    def write(self):
        with self.connect() as connection:
            self.check_chat_schema(connection)
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
                connection.execute("COMMIT")
            except BaseException:
                connection.execute("ROLLBACK")
                raise

    def create_job(self, *, request_key, fingerprint, conversation_id, kind, message, files, metadata):
        with self.write() as connection:
            previous = connection.execute("SELECT * FROM ai_chat_jobs WHERE request_key = ?", (request_key,)).fetchone()
            if previous:
                if previous["fingerprint"] != fingerprint:
                    raise DatabaseError("request_conflict", "같은 요청 ID에 다른 입력을 전송할 수 없어요.")
                return previous["id"], False
            analysis_id, job_id, now = str(uuid4()), "ai-" + str(uuid4()), self.now()
            connection.execute("INSERT INTO analyses (id, conversation_id, message, reply, created_at) VALUES (?, ?, ?, ?, ?)",
                               (analysis_id, conversation_id, message, '{"pending":true}', now))
            for file in files:
                connection.execute("INSERT INTO files (id, analysis_id, name, mime_type, size, content) VALUES (?, ?, ?, ?, ?, ?)",
                                   (file.id, analysis_id, file.name, file.mime_type, len(file.content), file.content))
            connection.execute("INSERT INTO ai_chat_jobs VALUES (?, ?, ?, ?, ?, 'queued', 'preparing', NULL, ?, ?, ?)",
                               (job_id, request_key, fingerprint, analysis_id, kind, json.dumps(metadata, ensure_ascii=False), now, now))
            return job_id, True

    def read_job(self, job_id):
        with self.connect() as connection:
            self.check_chat_schema(connection)
            row = connection.execute("SELECT * FROM ai_chat_jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                return None
            result = dict(row)
            draft = connection.execute("SELECT * FROM analyses WHERE id = ?", (row["analysis_id"],)).fetchone()
            result["draft"] = dict(draft)
            result["files"] = [dict(item) for item in connection.execute(
                "SELECT id, name, mime_type, size FROM files WHERE analysis_id = ? ORDER BY rowid", (row["analysis_id"],))]
            return result

    def set_phase(self, job_id, phase):
        with self.write() as connection:
            connection.execute("UPDATE ai_chat_jobs SET status = 'running', phase = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')",
                               (phase, self.now(), job_id))

    def fail_job(self, job_id, code, message):
        with self.write() as connection:
            connection.execute("UPDATE ai_chat_jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status != 'completed'",
                               (json.dumps({"code": code, "error": message}, ensure_ascii=False), self.now(), job_id))

    def recover_interrupted_jobs(self):
        with self.write() as connection:
            connection.execute("UPDATE ai_chat_jobs SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued', 'running')",
                               (json.dumps({"code": "server_restarted", "error": "AI 서버가 재시작되어 분석이 중단됐어요. 입력을 다시 전송해 주세요."}, ensure_ascii=False), self.now()))

    def complete_job(self, job_id, reply):
        # 분석 응답만 원자적으로 확정한다. 활동·기록·Timeline은 사용자 확인 저장에서 만든다.
        with self.write() as connection:
            job = connection.execute("SELECT * FROM ai_chat_jobs WHERE id = ?", (job_id,)).fetchone()
            if not job or job["status"] not in {"queued", "running"}:
                raise DatabaseError("job_not_running", "이미 종료된 분석 작업이에요.")
            # 분석 완료는 제안 보관이다. 활동 생성·메타정보 수정은 사용자 확정 저장에서만 한다.
            decision = reply["analysis"]["activity"] if reply.get("analysis") else None
            if decision and decision["match"] == "existing":
                activity = connection.execute("SELECT * FROM activities WHERE id = ?", (decision["id"],)).fetchone()
                if not activity:
                    raise DatabaseError("activity_missing", "분석 중 연결 활동이 삭제됐어요. 다시 분석해 주세요.")
                category = activity["category"] or decision.get("category")
                decision.update({key: activity[key] for key in ["name", "role", "summary"]})
                decision["category"] = category
                decision["status"] = activity["status"] if activity["status"] in {"진행 중", "완료"} else None
                decision["period"] = ({"start": activity["start_date"], "end": activity["end_date"]}
                                      if activity["start_date"] or activity["end_date"] else None)
            connection.execute("UPDATE analyses SET reply = ? WHERE id = ?",
                               (json.dumps(reply, ensure_ascii=False), job["analysis_id"]))
            connection.execute("UPDATE ai_chat_jobs SET status = 'completed', phase = 'completed', updated_at = ? WHERE id = ?",
                               (self.now(), job_id))
