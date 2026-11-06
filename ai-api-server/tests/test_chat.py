"""홈 접수→실제 파이프라인→SQLite 초안 경계 검사. 모델·웹 요청만 대체한다."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import time
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.analysis import AnalysisError
from app.database import SharedDatabase
from app.home_analysis import analyze_home
from app.home_schemas import HomeAnalysis, UploadedFile
from app.main import create_app
from app.links import public_target
from test_server import settings


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "test.db"
        module = Path(__file__).resolve().parents[2] / "api-server/test-support/database.js"
        subprocess.run(["node", "--input-type=module", "-e",
                        f"import {{openDatabase}} from {json.dumps(module.as_uri())}; openDatabase(process.argv[1]).close();",
                        str(self.path)], check=True, capture_output=True)
        self.config = settings(ai_db_path=self.path, openai_api_key="test-secret", openai_model="gpt-5.6-sol")
        self.database = SharedDatabase(self.config)

    @staticmethod
    async def model(**values):
        new = values["message"].startswith("새 활동")
        return HomeAnalysis.model_validate({
            "activity": {"match": "new" if new else "existing", "id": None if new else "line1-hackathon",
                         "name": "새 프로젝트" if new else "1호선톤", "confidence": "high", "category": "독서 모임"},
            "materialType": "회의록", "stage": None, "summary": "실제 입력에 대한 합성 검사 응답", "changes": [],
            "files": [{"id": file.id, "materialType": "회의록"} for file in values["files"]],
        })

    def completed(self, client, job_id):
        for _ in range(200):
            response = client.get(f"/api/chat/jobs/{job_id}")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            if data["status"] in {"completed", "failed"}:
                return data
            time.sleep(0.01)
        self.fail("작업 완료 대기 초과")

    def test_new_activity_draft_and_idempotency(self):
        with patch("app.chat.analyze_home", side_effect=self.model) as model, TestClient(create_app(self.config)) as client:
            data = {"message": "새 활동을 시작했어요.", "requestId": "same-key"}
            first = client.post("/api/chat", data=data)
            self.assertEqual(first.status_code, 202)
            completed = self.completed(client, first.json()["jobId"])
            self.assertEqual(completed["status"], "completed")
            repeated = client.post("/api/chat", data=data).json()
            self.assertEqual(repeated["jobId"], completed["jobId"])
            result = completed["result"]
            self.assertIn("stage", result["reply"]["analysis"])
            self.assertIsNone(result["reply"]["analysis"]["stage"])
            self.assertTrue(result["reply"]["analysis"]["activity"]["id"])
            self.assertEqual(result["reply"]["analysis"]["activity"]["match"], "existing")
            self.assertEqual(result["reply"]["analysis"]["activity"]["category"], "독서 모임")
            self.assertEqual(client.post("/api/chat", data={**data, "message": "다른 입력"}).status_code, 409)
        self.assertEqual(model.call_count, 1)
        with closing(sqlite3.connect(self.path)) as connection:
            self.assertEqual(connection.execute("SELECT category FROM activities WHERE name = '새 프로젝트'").fetchone()[0], "독서 모임")
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM activities").fetchone()[0], 6)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM analyses").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM records").fetchone()[0], 0)

    def test_existing_category_is_preserved(self):
        with closing(sqlite3.connect(self.path)) as connection:
            connection.execute("UPDATE activities SET category = '해커톤' WHERE id = 'line1-hackathon'")
            connection.commit()
        with patch("app.chat.analyze_home", side_effect=self.model), TestClient(create_app(self.config)) as client:
            accepted = client.post("/api/chat", data={"message": "기존 활동 기록"})
            completed = self.completed(client, accepted.json()["jobId"])
            self.assertEqual(completed["status"], "completed")
            self.assertEqual(completed["result"]["reply"]["analysis"]["activity"]["category"], "해커톤")

    def test_invalid_activity_category_is_rejected(self):
        from pydantic import ValidationError
        from app.home_schemas import HomeActivityDecision
        base = {"match": "new", "id": None, "name": "활동", "confidence": None}
        for category in ["all", "전체", "x" * 201]:
            with self.assertRaises(ValidationError):
                HomeActivityDecision.model_validate({**base, "category": category})
        with self.assertRaises(ValidationError):
            HomeActivityDecision.model_validate({**base, "match": "unresolved", "category": "독서 모임"})

    def test_file_and_batch_preserve_original_ids_and_bytes(self):
        with patch("app.chat.analyze_home", side_effect=self.model), TestClient(create_app(self.config)) as client:
            for count in [1, 2]:
                files = [("files", (f"회의록-{index}.txt", b"original bytes", "text/plain")) for index in range(count)]
                accepted = client.post("/api/chat", data={"conversationId": "test-files"}, files=files)
                completed = self.completed(client, accepted.json()["jobId"])
                self.assertEqual(completed["status"], "completed")
                reply = completed["result"]["reply"]
                self.assertEqual(reply["kind"], "no-change" if count == 1 else "batch-analysis")
                self.assertEqual(sum(group["count"] for group in reply["analysis"]["groups"]), count)
                for attachment in completed["result"]["attachments"]:
                    self.assertEqual(self.database.read_file(attachment["id"]).content, b"original bytes")

    def test_failed_model_does_not_create_activity_or_success(self):
        error = AnalysisError(502, "openai_connection", "모델 연결 실패")
        with patch("app.chat.analyze_home", side_effect=error), TestClient(create_app(self.config)) as client:
            accepted = client.post("/api/chat", data={"message": "새 활동"})
            completed = self.completed(client, accepted.json()["jobId"])
        self.assertEqual(completed["status"], "failed")
        self.assertNotIn("result", completed)
        self.assertEqual(completed["code"], "openai_connection")
        self.assertEqual(len(self.database.read_context().context.activities), 5)

    def test_link_reads_body_and_keeps_original_url(self):
        with (patch("app.chat.fetch_link", new_callable=AsyncMock, return_value="실제 페이지 본문") as fetch,
              patch("app.chat.analyze_home", side_effect=self.model) as model,
              TestClient(create_app(self.config)) as client):
            accepted = client.post("/api/chat/links", json={"url": "https://example.com/page"})
            completed = self.completed(client, accepted.json()["jobId"])
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(completed["result"]["reply"]["sourceUrl"], "https://example.com/page")
        self.assertEqual(model.call_args.kwargs["link_content"], "실제 페이지 본문")
        fetch.assert_awaited_once()

    def test_invalid_upload_does_not_create_job(self):
        with patch("app.chat.analyze_home") as model, TestClient(create_app(self.config)) as client:
            self.assertEqual(client.post("/api/chat", data={"message": " "}).status_code, 400)
            self.assertEqual(client.post("/api/chat", files={"files": ("unknown.hwp", b"test")}).status_code, 415)
            self.assertEqual(client.post("/api/chat/links", json={"url": "file:///secret"}).status_code, 400)
        model.assert_not_called()

    def test_restart_marks_unfinished_jobs_failed(self):
        job_id, _ = self.database.create_job(request_key="restart-test", fingerprint="abc", conversation_id="test",
                                            kind="chat", message="입력", files=[], metadata={})
        with TestClient(create_app(self.config)) as client:
            data = client.get(f"/api/chat/jobs/{job_id}").json()
        self.assertEqual(data["status"], "failed")
        self.assertEqual(data["code"], "server_restarted")


class HomeModelTests(unittest.IsolatedAsyncioTestCase):
    async def test_file_content_and_prompt_are_sent_and_file_ids_checked(self):
        from app.schemas import AnalysisContext
        file = UploadedFile(id="f1", name="회의록.txt", mime_type="text/plain", content="실제 본문".encode())
        output = HomeAnalysis.model_validate({"activity": {"match": "unresolved", "id": None, "name": "활동 미확정", "confidence": None},
                                             "materialType": "회의록", "stage": None, "summary": "요약", "changes": [],
                                             "files": [{"id": "f1", "materialType": "회의록"}]})
        with patch("app.home_analysis.structured_response", new_callable=AsyncMock, return_value=output) as provider:
            await analyze_home(message="입력", files=[file], source_url=None, link_content=None,
                               context=AnalysisContext(), config=settings())
        request = provider.call_args.kwargs
        self.assertIn("실제 본문", request["input"][0]["content"][1]["text"])
        self.assertIn("Before", request["instructions"])
        output.files[0].id = "fake-file"
        with patch("app.home_analysis.structured_response", new_callable=AsyncMock, return_value=output):
            with self.assertRaises(AnalysisError):
                await analyze_home(message="입력", files=[file], source_url=None, link_content=None,
                                   context=AnalysisContext(), config=settings())

    async def test_private_link_is_rejected(self):
        address = [(2, 1, 6, "", ("127.0.0.1", 80))]
        with patch("app.links.socket.getaddrinfo", return_value=address):
            with self.assertRaises(AnalysisError) as caught:
                await public_target("http://localhost/test")
        self.assertEqual(caught.exception.code, "private_url")


if __name__ == "__main__":
    unittest.main()
