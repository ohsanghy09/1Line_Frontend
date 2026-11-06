"""실제 홈 분석 접수·원본 보관·작업 진행·완료 응답을 연결한다."""

import asyncio
from contextlib import asynccontextmanager
import hashlib
import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Request, Response
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile

from .analysis import AnalysisError
from .database import DatabaseError
from .home_analysis import analyze_home, build_reply, validate_files
from .home_schemas import JobResponse, LinkRequest, UploadedFile
from .links import fetch_link, validate_url
from .network import check_openai_connection


PHASES = [("preparing", "입력과 기존 기록을 확인하고 있어요."),
          ("analyzing", "AI가 실제 자료를 분석하고 있어요."),
          ("persisting", "분석 결과를 보관하고 있어요.")]


class ChatPipeline:
    def __init__(self, database, config):
        self.database = database
        self.config = config
        self.tasks = set()
        self.tasks_by_job = {}
        self.semaphore = asyncio.Semaphore(2)

    @asynccontextmanager
    async def lifespan(self, app):
        try:
            await run_in_threadpool(self.database.recover_interrupted_jobs)
        except DatabaseError:
            # 상태 확인·문서는 DB 준비 전에도 열고 실제 분석 요청에서 오류를 안내한다.
            pass
        try:
            yield
        finally:
            tasks = list(self.tasks)
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)

    async def submit(self, *, message, files, source_url, conversation_id, request_key, wait_for_result=False):
        if not self.config.openai_api_key or not self.config.openai_model:
            raise AnalysisError(503, "not_configured", "OpenAI 키와 모델을 먼저 설정해 주세요.")
        metadata = {"message": message, "sourceUrl": source_url,
                    "files": [{"id": file.id, "name": file.name} for file in files]}
        digest = hashlib.sha256(json.dumps({"message": message, "sourceUrl": source_url,
                                           "conversationId": conversation_id}, sort_keys=True).encode())
        for file in files:
            digest.update(json.dumps([file.name, file.mime_type]).encode())
            digest.update(hashlib.sha256(file.content).digest())
        job_id, created = await run_in_threadpool(
            self.database.create_job, request_key=request_key, fingerprint=digest.hexdigest(),
            conversation_id=conversation_id or str(uuid4()), kind="link" if source_url else "chat",
            message=source_url or message, files=files, metadata=metadata)
        if created:
            task = asyncio.create_task(self.run(job_id))
            self.tasks.add(task)
            self.tasks_by_job[job_id] = task
            task.add_done_callback(self.tasks.discard)
            task.add_done_callback(lambda _: self.tasks_by_job.pop(job_id, None))
        if wait_for_result:
            # 텍스트는 한 HTTP 요청에서 결과까지 기다린다. 같은 요청 재접수도 모델을 중복 호출하지 않는다.
            task = self.tasks_by_job.get(job_id)
            if task is not None:
                await asyncio.shield(task)
        return await self.response(job_id)

    async def run(self, job_id):
        try:
            async with self.semaphore:
                await run_in_threadpool(self.database.set_phase, job_id, "preparing")
                job = await run_in_threadpool(self.database.read_job, job_id)
                metadata = json.loads(job["input_json"])
                stored = await run_in_threadpool(self.database.read_context)
                conversation = await run_in_threadpool(self.database.read_conversation_context, job['draft']['conversation_id'],
                                                       {activity.id for activity in stored.context.activities})
                files = []
                for file in job["files"]:
                    original = await run_in_threadpool(self.database.read_file, file["id"])
                    files.append(UploadedFile(id=original.id, name=original.name, mime_type=original.mime_type, content=original.content))
                source_url = metadata["sourceUrl"]
                link_content = await fetch_link(source_url) if source_url else None
                await run_in_threadpool(self.database.set_phase, job_id, "analyzing")
                result = await analyze_home(message=metadata["message"], files=files, source_url=source_url,
                                            link_content=link_content, context=stored.context, config=self.config, **conversation)
                await run_in_threadpool(self.database.set_phase, job_id, "persisting")
                reply = build_reply(result, files, source_url, "reply-" + job["analysis_id"])
                await run_in_threadpool(self.database.complete_job, job_id, reply)
        except asyncio.CancelledError:
            await run_in_threadpool(self.database.fail_job, job_id, "server_stopped", "서버가 종료되어 분석이 중단됐어요. 다시 전송해 주세요.")
            raise
        except (AnalysisError, DatabaseError) as error:
            await run_in_threadpool(self.database.fail_job, job_id, error.code, error.message)
        except Exception:
            await run_in_threadpool(self.database.fail_job, job_id, "analysis_failed", "분석 작업을 완료하지 못했어요. 서버 설정과 입력을 확인해 주세요.")

    async def response(self, job_id):
        job = await run_in_threadpool(self.database.read_job, job_id)
        if not job:
            raise AnalysisError(404, "job_missing", "분석 작업을 찾을 수 없어요.")
        status = job["status"]
        if status == "failed":
            error = json.loads(job["error"])
            return {"jobId": job_id, "status": "failed", **error, "analysisProvider": "openai"}
        phase = next((index for index, value in enumerate(PHASES) if value[0] == job["phase"]), 0)
        if status == "completed":
            phase = len(PHASES)
        progress = {"title": PHASES[phase][1] if phase < len(PHASES) else "분석 결과를 준비했어요.",
                    "steps": [{"label": label, "status": "completed" if index < phase else "working"}
                              for index, (_, label) in enumerate(PHASES[:min(phase + 1, len(PHASES))])]}
        response = {"jobId": job_id, "status": "completed" if status == "completed" else "running",
                    "progress": progress, "pollAfterMs": 400, "analysisProvider": "openai"}
        if status == "completed":
            draft = job["draft"]
            response["result"] = {"analysisId": draft["id"], "conversationId": draft["conversation_id"],
                                  "message": draft["message"], "reply": json.loads(draft["reply"]),
                                  "attachments": [{"id": file["id"], "name": file["name"], "size": file["size"]} for file in job["files"]],
                                  "createdAt": draft["created_at"]}
        return response

    def router(self):
        router = APIRouter()

        @router.get("/api/chat/health", tags=["홈 분석"])
        async def chat_health(checkConnection: bool = False):
            def check():
                with self.database.connect() as connection:
                    self.database.check_chat_schema(connection)
            try:
                await run_in_threadpool(check)
                ready = bool(self.config.openai_api_key and self.config.openai_model)
            except DatabaseError:
                ready = False
            result = {"status": "ready" if ready else "unavailable", "label": "AI 분석 설정 준비됨" if ready else "AI 서버 설정·DB를 확인해 주세요.",
                      "analysisProvider": "openai"}
            if checkConnection:
                result["network"] = await check_openai_connection()
            return result

        @router.post("/api/chat", tags=["홈 분석"], status_code=202,
                     response_model=JobResponse, response_model_exclude_none=True,
                     responses={200: {"model": JobResponse, "description": "Prefer: respond-sync인 파일 없는 텍스트의 최종 결과. 모델은 한 번만 호출한다."}},
                     openapi_extra={"parameters": [{"name": "Prefer", "in": "header", "required": False,
                                                    "schema": {"type": "string", "enum": ["respond-sync", "respond-async"]}}],
                                    "requestBody": {"required": True, "content": {"multipart/form-data": {
                         "schema": {"type": "object", "properties": {
                             "message": {"type": "string", "maxLength": 20000},
                             "conversationId": {"type": "string", "maxLength": 200},
                             "requestId": {"type": "string", "maxLength": 200},
                             "files": {"type": "array", "maxItems": 10, "items": {"type": "string", "format": "binary"}},
                         }}}}}})
        async def chat(request: Request, response: Response):
            files = []
            async with request.form(max_files=10, max_fields=3) as form:
                message = form.get("message", "")
                conversation_id = form.get("conversationId")
                request_key = form.get("requestId", str(uuid4()))
                if (not isinstance(message, str) or len(message) > 20_000
                        or conversation_id is not None and (not isinstance(conversation_id, str) or not 1 <= len(conversation_id.strip()) <= 200)
                        or not isinstance(request_key, str) or not 1 <= len(request_key.strip()) <= 200):
                    raise AnalysisError(400, "invalid_input", "입력 길이 또는 대화·요청 ID를 확인해 주세요.")
                for value in form.getlist("files"):
                    if not isinstance(value, UploadFile):
                        raise AnalysisError(400, "invalid_file", "파일 첨부 형식을 확인해 주세요.")
                    content = await value.read(10 * 1024 * 1024 + 1)
                    files.append(UploadedFile(id=str(uuid4()), name=Path((value.filename or "자료").replace("\\", "/")).name,
                                              mime_type=value.content_type or "application/octet-stream", content=content))
                if not message.strip() and not files:
                    raise AnalysisError(400, "empty_input", "텍스트 또는 파일을 보내주세요.")
                validate_files(files)
            wait_for_result = not files and request.headers.get("Prefer") == "respond-sync"
            result = await self.submit(message=message, files=files, source_url=None,
                                       conversation_id=conversation_id, request_key=request_key, wait_for_result=wait_for_result)
            if wait_for_result:
                response.status_code = 200
            return result

        @router.post("/api/chat/links", tags=["홈 분석"], status_code=202,
                     response_model=JobResponse, response_model_exclude_none=True)
        async def link(payload: LinkRequest):
            url = payload.url.strip()
            validate_url(url)
            return await self.submit(message=url, files=[], source_url=url,
                                     conversation_id=payload.conversationId, request_key=payload.requestId or str(uuid4()))

        @router.get("/api/chat/jobs/{job_id}", tags=["홈 분석"],
                    response_model=JobResponse, response_model_exclude_none=True)
        async def job(job_id: str):
            return await self.response(job_id)

        return router
