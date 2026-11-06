"""임시 실제 스키마에서 확정 기록 조회·근거 검증·AI 라우트를 검사한다."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch
import unittest

from fastapi.testclient import TestClient

from app.analysis import AnalysisError
from app.journey import JourneyAnalysis, journey_context, validate_journey
from app.main import create_app
import test_database


class JourneyTests(unittest.TestCase):
    setUp = test_database.DatabaseTests.setUp
    node = test_database.DatabaseTests.node
    add_record = test_database.DatabaseTests.add_record

    def result(self):
        return JourneyAnalysis.model_validate({
            "summary": {"title": "기획 기록", "description": "성장 판단에는 추가 기록이 필요합니다.",
                        "evidence": [{"recordId": "record-1", "quote": "기능 6개를 기획했습니다."}]},
            "typeOptions": [], "axisOptions": [], "badges": [], "events": [],
        })

    def test_context_excludes_empty_activities_and_unsaved_drafts(self):
        self.assertEqual(journey_context(self.database)["records"], [])
        self.add_record()
        context = journey_context(self.database)
        self.assertEqual(context["recordCount"], 1)
        self.assertEqual(context["records"][0]["files"], [{"id": "file-1", "name": "기획.txt"}])
        self.assertEqual(context["records"][0]["activityName"], "1호선톤")
        # JS 저장 검증과 Python 분석 문맥의 스냅샷 해시가 일치해야 한다.
        module = (Path(__file__).resolve().parents[2] / "api-server/src/journey-context.js").as_uri()
        fingerprint = self.node(f"const {{journeySnapshot}} = await import({json.dumps(module)}); const db = openDatabase(process.argv[1]); console.log(journeySnapshot(db).fingerprint); db.close();")
        self.assertEqual(fingerprint, context["sourceFingerprint"])

    def test_no_records_does_not_call_model(self):
        with patch("app.journey.structured_response", new_callable=AsyncMock) as provider, TestClient(create_app(self.config)) as client:
            response = client.post("/api/analyze/journey")
            self.assertEqual(response.status_code, 422)
            provider.assert_not_awaited()

    def test_actual_route_uses_db_context_and_does_not_write_results(self):
        self.add_record()
        config = self.config.model_copy(update={"openai_model": "test-provider"})
        with patch("app.journey.structured_response", new_callable=AsyncMock, return_value=self.result()) as provider, TestClient(create_app(config)) as client:
            before = self.node("const db = openDatabase(process.argv[1]); console.log(db.prepare('SELECT COUNT(*) AS n FROM journey_analyses').get().n); db.close();")
            response = client.post("/api/analyze/journey")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["recordCount"], 1)
            self.assertEqual(response.json()["result"]["events"], [])
            self.assertEqual(response.json()["result"]["axisOptions"], [{"value": "all", "label": "전체 분야"}])
            self.assertEqual(response.json()["promptVersion"], "journey-v3")
            arguments = provider.await_args.kwargs
            self.assertIn("record-1", arguments["input"])
            self.assertIn("comparison=null", arguments["instructions"])
            self.assertNotIn("Scent Orbit", arguments["input"])
            after = self.node("const db = openDatabase(process.argv[1]); console.log(db.prepare('SELECT COUNT(*) AS n FROM journey_analyses').get().n); db.close();")
            self.assertEqual(before, after)

    def test_invalid_record_quote_activity_and_comparison_are_rejected(self):
        self.add_record()
        context = journey_context(self.database)
        for key, value in [("recordId", "missing"), ("quote", "기록에 없는 문장")]:
            result = self.result()
            setattr(result.summary.evidence[0], key, value)
            with self.assertRaises(AnalysisError):
                validate_journey(result, context)
        event = {"activityId": "computer-vision", "type": "ability", "axis": "technology", "title": "성장", "description": "변화",
                 "comparison": None, "evidence": [{"recordId": "record-1", "quote": "기능 6개를 기획했습니다."}]}
        for bad in [event, {**event, "activityId": "line1-hackathon", "comparison": {"before": "기획", "after": "PM"}}]:
            data = self.result().model_dump(); data["events"] = [bad]
            data["typeOptions"] = [{"value": "ability", "label": "문제 해결", "icon": "🧩"}]
            data["axisOptions"] = [{"value": "technology", "label": "기술"}]
            with self.assertRaises(AnalysisError):
                validate_journey(JourneyAnalysis.model_validate(data), context)

    def test_context_limits_are_explicit_and_do_not_call_model(self):
        self.add_record()
        self.node("const db = openDatabase(process.argv[1]); db.prepare('UPDATE records SET message = ?').run('x'.repeat(250001)); db.close();")
        with patch("app.journey.structured_response", new_callable=AsyncMock) as provider, TestClient(create_app(self.config)) as client:
            self.assertEqual(client.post("/api/analyze/journey").status_code, 422)
            provider.assert_not_awaited()

    def test_event_response_uses_saved_activity_month_and_verified_quotes(self):
        self.add_record()
        data = self.result().model_dump()
        data["events"] = [{
            "activityId": "line1-hackathon", "type": "scope-design", "axis": "product-design",
            "title": "기획 기록", "description": "기획을 수행했습니다.", "comparison": None,
            "evidence": [{"recordId": "record-1", "quote": "기능 6개를 기획했습니다."}],
        }]
        data["typeOptions"] = [{"value": "scope-design", "label": "기획 범위 설계", "icon": "🧭"}]
        data["axisOptions"] = [{"value": "product-design", "label": "서비스 디자인"}]
        data["badges"] = [{"label": "기록상 첫 기획", "icon": "🌱", "evidence": data["events"][0]["evidence"]}]
        config = self.config.model_copy(update={"openai_model": "test-provider"})
        with patch("app.journey.structured_response", new_callable=AsyncMock, return_value=JourneyAnalysis.model_validate(data)), TestClient(create_app(config)) as client:
            response = client.post("/api/analyze/journey")
            self.assertEqual(response.status_code, 200, response.text)
            event = response.json()["result"]["events"][0]
            self.assertEqual(event["activity"], {"id": "line1-hackathon", "name": "1호선톤"})
            self.assertEqual(event["occurredAt"], "2026-11")
            self.assertNotIn("comparison", event)
            result = response.json()["result"]
            self.assertEqual(event["type"], "scope-design")
            self.assertEqual(result["typeOptions"][1], data["typeOptions"][0])
            self.assertEqual(result["badges"][0]["icon"], "🌱")
            self.assertEqual(event["axis"], "product-design")
            self.assertEqual(result["axisOptions"][1], data["axisOptions"][0])

    def test_dynamic_categories_reject_unknown_duplicate_reserved_or_unused_types(self):
        self.add_record()
        context = journey_context(self.database)
        option = {"value": "learning", "label": "학습 적용", "icon": "📚"}
        event = {"activityId": "line1-hackathon", "type": "learning", "axis": "planning", "title": "기획 학습", "description": "기록 기반",
                 "comparison": None, "evidence": [{"recordId": "record-1", "quote": "기능 6개를 기획했습니다."}]}
        for options, events in [
            ([], [event]), ([option, option], [event]),
            ([option, {**option, "value": "other"}], [event]),
            ([{**option, "value": "all"}], [{**event, "type": "all"}]),
            ([option], []), ([{**option, "icon": " "}], [event]),
        ]:
            data = self.result().model_dump(); data.update(typeOptions=options, events=events)
            data["axisOptions"] = [{"value": "planning", "label": "기획"}] if events else []
            with self.assertRaises(AnalysisError):
                validate_journey(JourneyAnalysis.model_validate(data), context)

    def test_dynamic_axes_reject_unknown_duplicate_reserved_and_unused_options(self):
        self.add_record()
        context = journey_context(self.database)
        option = {"value": "education", "label": "교육"}
        event = {"activityId": "line1-hackathon", "type": "learning", "axis": "education", "title": "경험", "description": "기록 기반",
                 "comparison": None, "evidence": [{"recordId": "record-1", "quote": "기능 6개를 기획했습니다."}]}
        for axes, events in [
            ([], [event]), ([option, option], [event]),
            ([option, {"value": "teaching", "label": " 교육 "}], [event, {**event, "axis": "teaching"}]),
            ([option, {"value": "literature", "label": "문학"}], [event]),
            ([{**option, "value": "all"}], [{**event, "axis": "all"}]),
            ([{**option, "label": "전체 분야"}], [event]), ([{**option, "label": " "}], [event]),
            ([option], []), ([option], [{**event, "axis": "missing"}]),
        ]:
            data = self.result().model_dump()
            data.update(axisOptions=axes, events=events, typeOptions=[{"value": "learning", "label": "학습", "icon": "📚"}] if events else [])
            with self.assertRaises(AnalysisError):
                validate_journey(JourneyAnalysis.model_validate(data), context)
