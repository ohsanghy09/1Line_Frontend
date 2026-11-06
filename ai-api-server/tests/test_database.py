"""Node의 실제 스키마로 만든 임시 DB에서 Python 직접 접근·라우트 연결을 확인한다."""

import json
from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.config import Settings
from app.database import DatabaseError, SharedDatabase
from app.main import create_app
from app.schemas import TextAnalysis
from test_server import settings

BACKEND_DATABASE = Path(__file__).resolve().parents[2] / "api-server/src/database.js"


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "shared 한국어.db"
        self.node("const db = openDatabase(process.argv[1]); db.close();")
        self.config = settings(ai_db_path=self.path)
        self.database = SharedDatabase(self.config)

    def node(self, body):
        script = f"import {{ openDatabase }} from {json.dumps(BACKEND_DATABASE.as_uri())};\n{body}"
        result = subprocess.run(["node", "--input-type=module", "-e", script, str(self.path)],
                                capture_output=True, text=True, encoding="utf-8", check=True)
        return result.stdout.strip()

    def add_record(self, reply=None):
        if reply is None:
            reply = {"analysis": {"summary": "기존 기획의 기능은 6개였습니다."}}
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.execute("INSERT INTO analyses VALUES (?, ?, ?, ?, ?)",
                               ("analysis-1", "conversation-1", "입력", json.dumps(reply), "2026-11-06T00:00:00Z"))
            connection.execute("INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)",
                               ("record-1", "line1-hackathon", "analysis-1", "기능 6개를 기획했습니다.",
                                json.dumps(reply), "2026-11-06T00:00:00Z", "2026-11-06T00:00:00Z"))
            connection.execute("INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)",
                               ("file-1", "analysis-1", "기획.txt", "text/plain", 4, b"test"))

    def test_python_reads_node_database_and_original_file(self):
        self.add_record()
        self.assertEqual(self.database.status()["status"], "connected")
        context = self.database.read_context()
        self.assertEqual(context.selection.activitiesTotal, 5)
        self.assertEqual(context.context.records[0].activityId, "line1-hackathon")
        self.assertEqual(context.context.records[0].summary, "기존 기획의 기능은 6개였습니다.")
        original = self.database.read_file("file-1")
        self.assertEqual(original.content, b"test")
        self.assertEqual(original.name, "기획.txt")
        self.assertIsNone(self.database.read_file("' OR 1=1 --"))
        self.assertNotIn("content", context.model_dump_json())

    def test_python_write_is_visible_to_node_without_schema_changes(self):
        # 직접 연결이 읽기/쓰기 가능한지 임시 DB에서만 확인한다. 앱에는 쓰기 라우트가 없다.
        with self.database.connect() as connection:
            connection.execute("INSERT INTO activities (id, name) VALUES (?, ?)", ("python-created", "테스트 활동"))
            self.assertEqual(connection.execute("PRAGMA foreign_keys").fetchone()[0], 1)
        actual = self.node("const db = openDatabase(process.argv[1]); console.log(db.prepare('SELECT COUNT(*) AS n FROM activities WHERE id = ?').get('python-created').n); db.close();")
        self.assertEqual(actual, "1")

    def test_analysis_uses_database_when_context_is_omitted(self):
        self.add_record()
        config = settings(ai_db_path=self.path, openai_model="test-model", openai_api_key="test-secret")
        analysis = TextAnalysis.model_validate({
            "activity": {"id": "line1-hackathon", "name": "1호선톤", "match": "existing", "confidence": "high"},
            "materialType": "경험 기록", "stage": None, "summary": "입력 요약", "changes": [],
        })
        with (patch("app.main.analyze_text", new_callable=AsyncMock, return_value=analysis) as analyze,
              TestClient(create_app(config)) as client):
            response = client.post("/api/analyze/text", json={"input": {"kind": "text", "message": "1호선톤 기록"}})
            preview = client.get("/api/context")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["contextSource"], "database")
        self.assertEqual(response.json()["contextSelection"]["recordsIncluded"], 1)
        self.assertEqual(analyze.call_args.args[0].context.records[0].id, "record-1")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.json()["selection"]["recordsTotal"], 1)

    def test_missing_database_is_not_created_or_reported_as_empty_success(self):
        missing = self.path.parent / "absent.db"
        with TestClient(create_app(settings(ai_db_path=missing))) as client:
            self.assertEqual(client.get("/api/health").json()["database"]["code"], "database_missing")
            with patch("app.main.analyze_text", new_callable=AsyncMock) as analyze:
                response = client.post("/api/analyze/text", json={"input": {"kind": "text", "message": "입력"}})
                self.assertEqual(response.status_code, 503)
                analyze.assert_not_called()
            response = client.get("/api/context")
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(str(missing), response.text)
        self.assertFalse(missing.exists())

    def test_wrong_schema_is_not_migrated(self):
        empty = self.path.parent / "wrong.db"
        with closing(sqlite3.connect(empty)) as connection, connection:
            connection.execute("CREATE TABLE unrelated (id TEXT)")
        database = SharedDatabase(settings(ai_db_path=empty))
        self.assertEqual(database.status()["code"], "database_schema_mismatch")
        with self.assertRaises(DatabaseError):
            database.read_context()
        with closing(sqlite3.connect(empty)) as connection, connection:
            self.assertEqual(connection.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(), [("unrelated",)])

    def test_invalid_record_is_not_silently_ignored(self):
        self.add_record(reply={})
        with TestClient(create_app(self.config)) as client:
            response = client.get("/api/context")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "database_context_invalid")

    def test_context_limits_are_reported(self):
        with closing(sqlite3.connect(self.path)) as connection, connection:
            connection.executemany("INSERT INTO activities (id, name) VALUES (?, ?)",
                                   [(f"extra-{index}", f"추가 활동 {index}") for index in range(51)])
        result = self.database.read_context()
        self.assertEqual(result.selection.activitiesTotal, 56)
        self.assertEqual(result.selection.activitiesIncluded, 50)
        self.assertTrue(result.selection.truncated)

    def test_relative_path_is_anchored_to_ai_server(self):
        config = Settings(_env_file=None, ai_db_path="../api-server/data/1line.db")
        expected = BACKEND_DATABASE.parents[1] / "data/1line.db"
        self.assertEqual(config.database_path, expected.resolve())


if __name__ == "__main__":
    unittest.main()
