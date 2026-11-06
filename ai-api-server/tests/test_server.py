"""외부 호출 없이 설정 상태·비밀값 비노출·API 문서·CORS를 검증한다."""

import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def settings(**values: object) -> Settings:
    # 사용자 .env나 OS의 실제 키를 테스트에 사용하지 않는다.
    defaults = dict(openai_api_key=None, openai_model=None,
                    ai_cors_origins="http://localhost:5173",
                    ai_db_path=Path(__file__).parent / "unittest-missing.db")
    return Settings(_env_file=None, **(defaults | values))


class ServerTests(unittest.TestCase):
    def test_missing_configuration_keeps_server_available(self):
        with TestClient(create_app(settings())) as client:
            response = client.get("/api/health")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["status"], "ok")
            self.assertEqual(response.json()["openai"], {
                "apiKeyConfigured": False,
                "modelConfigured": False,
                "connectionStatus": "not_checked",
            })

    def test_configured_values_do_not_claim_connectivity_or_expose_key(self):
        with TestClient(create_app(settings(openai_api_key="test-secret", openai_model="test-model"))) as client:
            response = client.get("/api/health")
            self.assertTrue(response.json()["openai"]["apiKeyConfigured"])
            self.assertTrue(response.json()["openai"]["modelConfigured"])
            self.assertEqual(response.json()["openai"]["connectionStatus"], "not_checked")
            self.assertNotIn("test-secret", response.text)
            self.assertNotIn("test-secret", client.get("/openapi.json").text)

    def test_blank_configuration_is_missing(self):
        config = settings(openai_api_key="  ", openai_model=" ")
        self.assertIsNone(config.openai_api_key)
        self.assertIsNone(config.openai_model)

    def test_documentation_and_schema(self):
        with TestClient(create_app(settings())) as client:
            self.assertEqual(client.get("/docs").status_code, 200)
            schema = client.get("/openapi.json").json()
            self.assertIn("/api/health", schema["paths"])
            self.assertIn("/api/chat", schema["paths"])

    def test_cors_allows_only_configured_origin(self):
        with TestClient(create_app(settings())) as client:
            allowed = client.options("/api/health", headers={
                "Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET",
            })
            self.assertEqual(allowed.status_code, 200)
            self.assertEqual(allowed.headers["access-control-allow-origin"], "http://localhost:5173")
            denied = client.options("/api/health", headers={
                "Origin": "https://unconfigured.example", "Access-Control-Request-Method": "GET",
            })
            self.assertEqual(denied.status_code, 400)


if __name__ == "__main__":
    unittest.main()
