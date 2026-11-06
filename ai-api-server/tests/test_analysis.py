"""실제 비용 없이 입력·외부 호출·오류·근거 검증 경계를 확인한다."""

from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

import httpx2
from fastapi.testclient import TestClient
from openai import APIConnectionError, APITimeoutError, AuthenticationError, RateLimitError

from app.analysis import AnalysisError, analyze_text, validate_analysis
from app.main import create_app
from app.schemas import TextAnalysis, TextAnalysisRequest
from test_server import settings


def payload():
    return TextAnalysisRequest.model_validate({
        "input": {"kind": "text", "message": "1호선톤 회의 내용을 정리했습니다."},
        "context": {"activities": [{"id": "activity-1", "name": "1호선톤"}]},
    })


def result():
    return TextAnalysis.model_validate({
        "activity": {"match": "existing", "id": "activity-1", "name": "다른 표시명", "confidence": "high"},
        "materialType": "회의록", "stage": None, "summary": "회의 내용을 정리함", "changes": [],
    })


class AnalysisTests(unittest.IsolatedAsyncioTestCase):
    async def test_sdk_request_and_result(self):
        client = AsyncMock()
        client.__aenter__.return_value = client
        client.responses.parse.return_value = SimpleNamespace(
            status="completed", output=[], output_parsed=result())
        config = settings(openai_api_key="test-secret", openai_model="gpt-5.6-sol")
        with patch("app.analysis.AsyncOpenAI", return_value=client) as factory:
            response = await analyze_text(payload(), config)
        self.assertEqual(response.activity.name, "1호선톤")
        self.assertEqual(factory.call_args.kwargs["max_retries"], 0)
        request = client.responses.parse.call_args.kwargs
        self.assertEqual(request["model"], "gpt-5.6-sol")
        self.assertFalse(request["store"])
        self.assertNotIn("test-secret", request["input"])
        self.assertIs(request["text_format"], TextAnalysis)

    async def test_provider_failures_are_sanitized(self):
        request = httpx2.Request("POST", "https://api.openai.com/v1/responses")
        failures = [
            (APIConnectionError(message="private-upstream-detail", request=request), 502, "openai_connection"),
            (APITimeoutError(request=request), 504, "openai_timeout"),
            (AuthenticationError("private-upstream-detail", response=httpx2.Response(401, request=request), body=None),
             502, "openai_authentication"),
            (RateLimitError("private-upstream-detail", response=httpx2.Response(429, request=request), body=None),
             429, "openai_rate_limit"),
        ]
        for failure, status, code in failures:
            with self.subTest(code=code):
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.responses.parse.side_effect = failure
                with patch("app.analysis.AsyncOpenAI", return_value=client):
                    with self.assertRaises(AnalysisError) as caught:
                        await analyze_text(payload(), settings(openai_api_key="test-secret", openai_model="test-model"))
                self.assertEqual(caught.exception.status_code, status)
                self.assertEqual(caught.exception.code, code)
                self.assertNotIn("private-upstream-detail", caught.exception.message)

    async def test_incomplete_refusal_and_empty_result(self):
        responses = [
            (SimpleNamespace(status="incomplete", output=[], output_parsed=None), "analysis_incomplete"),
            (SimpleNamespace(status="completed", output=[SimpleNamespace(content=[SimpleNamespace(type="refusal")])],
                             output_parsed=None), "analysis_refused"),
            (SimpleNamespace(status="completed", output=[], output_parsed=None), "invalid_analysis"),
        ]
        for response, code in responses:
            with self.subTest(code=code):
                client = AsyncMock()
                client.__aenter__.return_value = client
                client.responses.parse.return_value = response
                with patch("app.analysis.AsyncOpenAI", return_value=client):
                    with self.assertRaises(AnalysisError) as caught:
                        await analyze_text(payload(), settings(openai_api_key="test-secret", openai_model="test-model"))
                self.assertEqual(caught.exception.code, code)


class AnalysisRouteTests(unittest.TestCase):
    def test_missing_config_does_not_call_openai(self):
        with patch("app.analysis.AsyncOpenAI") as factory, TestClient(create_app(settings())) as client:
            response = client.post("/api/analyze/text", json=payload().model_dump())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "not_configured")
        factory.assert_not_called()

    def test_route_does_not_claim_persistence(self):
        config = settings(openai_api_key="test-secret", openai_model="gpt-5.6-sol")
        with patch("app.main.analyze_text", new_callable=AsyncMock, return_value=result()), TestClient(create_app(config)) as client:
            response = client.post("/api/analyze/text", json=payload().model_dump())
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["activityPersisted"])
        self.assertFalse(response.json()["analysisPersisted"])
        self.assertEqual(response.json()["contextSource"], "request")
        self.assertIsNone(response.json()["contextSelection"])
        self.assertNotIn("analysisId", response.json())
        self.assertNotIn("test-secret", response.text)

    def test_invalid_input_is_rejected_before_model_call(self):
        invalid = [
            {"input": {"kind": "text", "message": "  "}},
            {"input": {"kind": "files", "message": "test"}},
            {"input": {"kind": "text", "message": "x" * 20001}},
            {"input": {"kind": "text", "message": "test"},
             "context": {"records": [{"id": "r1", "activityId": "missing"}]}},
        ]
        with patch("app.main.analyze_text", new_callable=AsyncMock) as analyze, TestClient(create_app(settings())) as client:
            for body in invalid:
                with self.subTest(body_kind=body["input"]["kind"]):
                    self.assertEqual(client.post("/api/analyze/text", json=body).status_code, 422)
        analyze.assert_not_called()

    def test_fake_existing_id_and_ungrounded_evidence_are_rejected(self):
        invalid = result()
        invalid.activity.id = "invented-id"
        with self.assertRaises(AnalysisError):
            validate_analysis(invalid, payload())
        invalid = result()
        invalid.activity.match = "new"
        with self.assertRaises(AnalysisError):
            validate_analysis(invalid, payload())
        data = result().model_dump()
        data["changes"] = [{"before": "이전", "after": "이후", "category": "변화", "evidence": ["없는 근거"]}]
        invalid = TextAnalysis.model_validate(data)
        with self.assertRaises(AnalysisError):
            validate_analysis(invalid, payload())

    def test_grounded_evidence_is_accepted(self):
        request = payload()
        request.input.message = "1호선톤 기능은 이전에는 6개였고 지금은 3개로 줄였습니다."
        data = result().model_dump()
        data["changes"] = [{"before": "기능 6개", "after": "기능 3개", "category": "범위 축소",
                            "evidence": ["기능은 이전에는 6개였고 지금은 3개로 줄였습니다."]}]
        self.assertEqual(len(validate_analysis(TextAnalysis.model_validate(data), request).changes), 1)


if __name__ == "__main__":
    unittest.main()
