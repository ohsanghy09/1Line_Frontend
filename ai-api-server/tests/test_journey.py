"""임시 실제 스키마에서 확정 기록 조회·근거 검증·AI 라우트를 검사한다."""

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch
import unittest
from pydantic import ValidationError

from fastapi.testclient import TestClient

from app.analysis import AnalysisError
from app.journey import (JourneyAnalysis, JourneyModelAnalysis, journey_context,
                         prepare_journey_input, resolve_journey_evidence,
                         normalize_journey_options, validate_journey)
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

    def model_result(self, result=None):
        data = (result or self.result()).model_dump()
        catalog = prepare_journey_input(journey_context(self.database))["evidenceCatalog"]
        ids = {(item['recordId'], item['quote']): item['id'] for item in catalog}
        for group in [data['summary'], *data['badges'], *data['events']]:
            group['evidence'] = [{'evidenceId': ids[(ref['recordId'], ref['quote'])]} for ref in group['evidence']]
        return JourneyModelAnalysis.model_validate(data)

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
        with patch("app.journey.structured_response", new_callable=AsyncMock, return_value=self.model_result()) as provider, TestClient(create_app(config)) as client:
            before = self.node("const db = openDatabase(process.argv[1]); console.log(db.prepare('SELECT COUNT(*) AS n FROM journey_analyses').get().n); db.close();")
            response = client.post("/api/analyze/journey")
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()["recordCount"], 1)
            self.assertEqual(response.json()["result"]["events"], [])
            self.assertEqual(response.json()["result"]["axisOptions"], [{"value": "all", "label": "전체 분야"}])
            self.assertEqual(response.json()["promptVersion"], "journey-v5")
            arguments = provider.await_args.kwargs
            self.assertIn("record-1", arguments["input"])
            self.assertIn("comparison=null", arguments["instructions"])
            self.assertNotIn("Scent Orbit", arguments["input"])
            self.assertIs(arguments['schema'], JourneyModelAnalysis)
            payload = json.loads(arguments['input'])
            self.assertIn('evidenceCatalog', payload)
            self.assertNotIn('message', payload['records'][0])
            self.assertEqual(response.json()['result']['summary']['evidence'], self.result().summary.model_dump()['evidence'])
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
        with patch("app.journey.structured_response", new_callable=AsyncMock, return_value=self.model_result(JourneyAnalysis.model_validate(data))), TestClient(create_app(config)) as client:
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

    def classification_result(self):
        data = self.result().model_dump()
        event = {"activityId": "line1-hackathon", "type": "learning", "axis": "education", "title": "학습", "description": "기록 기반",
                 "comparison": None, "evidence": [{"recordId": "record-1", "quote": "기능 6개를 기획했습니다."}]}
        data.update(events=[event, {**event, "type": "applied", "axis": "teaching"}],
                    typeOptions=[{"value": "learning", "label": "학습 적용", "icon": "📚"},
                                 {"value": "learning", "label": "학습 적용", "icon": "📚"},
                                 {"value": "applied", "label": " 학습　 적용 ", "icon": "🧩"},
                                 {"value": "unused", "label": "성과", "icon": "🏆"}],
                    axisOptions=[{"value": "education", "label": "교육"}, {"value": "teaching", "label": " 교육 "},
                                 {"value": "unused", "label": "문학"}])
        return JourneyAnalysis.model_validate(data)

    def test_normalization_merges_exact_labels_and_removes_unused_without_changing_evidence(self):
        self.add_record()
        original = self.classification_result()
        result = normalize_journey_options(original)
        validate_journey(result, journey_context(self.database))
        self.assertEqual([option.value for option in result.typeOptions], ['learning'])
        self.assertEqual([option.value for option in result.axisOptions], ['education'])
        self.assertEqual([event.type for event in result.events], ['learning', 'learning'])
        self.assertEqual([event.axis for event in result.events], ['education', 'education'])
        self.assertEqual([event.evidence for event in result.events], [event.evidence for event in original.events])
        self.assertEqual(original.events[1].type, 'applied')
        result = self.result()
        result.typeOptions = original.typeOptions
        result.axisOptions = original.axisOptions
        empty = normalize_journey_options(result)
        self.assertEqual(empty.typeOptions, [])
        self.assertEqual(empty.axisOptions, [])

    def test_normalization_rejects_unknown_references_and_conflicting_ids_without_guessing(self):
        for field in ['type', 'axis']:
            result = self.classification_result()
            setattr(result.events[0], field, 'unknown')
            with self.assertRaisesRegex(AnalysisError, 'invalid_journey'):
                normalize_journey_options(result)
            result = self.classification_result()
            options = result.typeOptions if field == 'type' else result.axisOptions
            conflicting = options[0].model_copy(update={'label': '전혀 다른 분류'})
            options.append(conflicting)
            with self.assertRaisesRegex(AnalysisError, 'invalid_journey'):
                normalize_journey_options(result)

    def test_route_normalizes_classifications_in_one_model_call_and_still_checks_evidence(self):
        self.add_record()
        result = self.model_result(self.classification_result())
        config = self.config.model_copy(update={'openai_model': 'test-provider'})
        with patch('app.journey.structured_response', new_callable=AsyncMock, return_value=result) as provider, TestClient(create_app(config)) as client:
            response = client.post('/api/analyze/journey')
            self.assertEqual(response.status_code, 200, response.text)
            data = response.json()['result']
            self.assertEqual(len(data['typeOptions']), 2)  # 전체 + 학습 적용
            self.assertEqual(len(data['axisOptions']), 2)
            self.assertEqual(len(data['events']), 2)
            provider.assert_awaited_once()
        result.summary.evidence[0].evidenceId = 'missing-evidence'
        with patch('app.journey.structured_response', new_callable=AsyncMock, return_value=result) as provider, TestClient(create_app(config)) as client:
            with self.assertLogs('app.journey', level='WARNING') as logs:
                response = client.post('/api/analyze/journey')
            self.assertEqual(response.status_code, 502)
            self.assertEqual(response.json()['code'], 'journey_evidence_invalid')
            self.assertIn('unknown_evidence_id', logs.output[0])
            self.assertIn('summary.evidence[0]', logs.output[0])
            self.assertNotIn('missing-evidence', logs.output[0])
            provider.assert_awaited_once()

    def test_catalog_preserves_exact_unicode_whitespace_and_long_passages(self):
        self.add_record()
        context = journey_context(self.database)
        original = '  원문은  두 칸입니다.\n가와 가는 다릅니다. ' + '긴' * 1800
        context['records'][0]['message'] = original
        before = json.dumps(context, ensure_ascii=False)
        payload = prepare_journey_input(context)
        self.assertEqual(json.dumps(context, ensure_ascii=False), before)
        for item in payload['evidenceCatalog']:
            source = context['records'][0][item['source']]
            self.assertIn(item['quote'], source)
            self.assertLessEqual(len(item['quote']), 800)
        self.assertTrue(any('  ' in item['quote'] for item in payload['evidenceCatalog']))
        selected = self.model_result()
        selected.summary.evidence[0].evidenceId = payload['evidenceCatalog'][0]['id']
        resolved = resolve_journey_evidence(selected, payload['evidenceCatalog'])
        self.assertEqual(resolved.summary.evidence[0].quote, payload['evidenceCatalog'][0]['quote'])
        validate_journey(resolved, context)

    def test_empty_message_uses_summary_and_free_quotes_are_not_model_fields(self):
        self.add_record()
        self.node("const db = openDatabase(process.argv[1]); db.prepare('UPDATE records SET message = ?').run(''); db.close();")
        context = journey_context(self.database)
        payload = prepare_journey_input(context)
        selected = self.result().model_dump()
        with self.assertRaises(ValidationError):
            JourneyModelAnalysis.model_validate(selected)
        selected['summary']['evidence'] = [{'evidenceId': payload['evidenceCatalog'][0]['id']}]
        selected = JourneyModelAnalysis.model_validate(selected)
        config = self.config.model_copy(update={'openai_model': 'test-provider'})
        with patch('app.journey.structured_response', new_callable=AsyncMock, return_value=selected) as provider, TestClient(create_app(config)) as client:
            response = client.post('/api/analyze/journey')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['result']['summary']['evidence'],
                         [{'recordId': 'record-1', 'quote': context['records'][0]['summary']}])
        provider.assert_awaited_once()

    def test_catalog_keeps_same_quote_in_distinct_records_and_comparison_validates(self):
        self.add_record()
        context = journey_context(self.database)
        other = {**context['records'][0], 'id': 'record-2'}
        context['records'].append(other)
        context['recordCount'] = 2
        payload = prepare_journey_input(context)
        refs = [item for item in payload['evidenceCatalog'] if item['quote'] == self.result().summary.evidence[0].quote]
        self.assertEqual({item['recordId'] for item in refs}, {'record-1', 'record-2'})
        data = self.model_result(self.classification_result()).model_dump()
        data['events'][0]['comparison'] = {'before': '이전', 'after': '이후'}
        data['events'][0]['evidence'] = [{'evidenceId': item['id']} for item in refs]
        resolved = resolve_journey_evidence(JourneyModelAnalysis.model_validate(data), payload['evidenceCatalog'])
        validate_journey(normalize_journey_options(resolved), context)
        data['events'][0]['evidence'] = [data['events'][0]['evidence'][0]] * 2
        resolved = resolve_journey_evidence(JourneyModelAnalysis.model_validate(data), payload['evidenceCatalog'])
        with self.assertRaises(AnalysisError):
            validate_journey(normalize_journey_options(resolved), context)
        data['events'][0]['comparison'] = None
        data['events'][0]['activityId'] = 'wrong-activity'
        resolved = resolve_journey_evidence(JourneyModelAnalysis.model_validate(data), payload['evidenceCatalog'])
        with self.assertRaises(AnalysisError):
            validate_journey(normalize_journey_options(resolved), context)

    def test_catalog_limits_fail_before_model_call(self):
        self.add_record()
        context = journey_context(self.database)
        cases = [
            ('\n'.join(f'{i}.' for i in range(2001)), 'summary'),
            ('\n'.join(str(i) + 'x' * 795 + '.' for i in range(300)), 'summary'),
            ('', ''),
        ]
        for message, summary in cases:
            oversized = json.loads(json.dumps(context))
            oversized['records'][0].update(message=message, summary=summary)
            with patch('app.journey.journey_context', return_value=oversized), patch('app.journey.structured_response', new_callable=AsyncMock) as provider, TestClient(create_app(self.config)) as client:
                response = client.post('/api/analyze/journey')
            self.assertEqual(response.status_code, 422, response.text)
            provider.assert_not_awaited()

    def test_v5_route_output_saves_in_existing_backend_and_passes_frontend_guard(self):
        self.add_record()
        config = self.config.model_copy(update={'openai_model': 'test-provider'})
        selected = self.model_result(self.classification_result())
        with patch('app.journey.structured_response', new_callable=AsyncMock, return_value=selected), TestClient(create_app(config)) as client:
            response = client.post('/api/analyze/journey')
        self.assertEqual(response.status_code, 200, response.text)
        root = Path(__file__).resolve().parents[2]
        script = """
const {generateJourney} = await import(BACKEND);
const {readFileSync} = await import('node:fs');
const {stripTypeScriptTypes} = await import('node:module');
const asUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const chat = asUrl(stripTypeScriptTypes(readFileSync(CHAT, 'utf8')));
const source = stripTypeScriptTypes(readFileSync(FRONTEND, 'utf8')).replace("from './chat'", `from '${chat}'`);
const {isGrowthJourney} = await import(asUrl(source));
const output = OUTPUT;
globalThis.fetch = async () => Response.json(output);
const db = openDatabase(process.argv[1]);
try {
  const before = db.prepare('SELECT message, reply FROM records ORDER BY id').all();
  const saved = await generateJourney(db);
  const legacy = {...output, promptVersion: 'journey-v4'};
  globalThis.fetch = async () => Response.json(legacy);
  const old = await generateJourney(db);
  console.log(JSON.stringify({valid: isGrowthJourney(saved), version: saved.analysis.promptVersion,
    stale: saved.analysis.stale, evidence: saved.events[0].evidence,
    recordsUnchanged: JSON.stringify(before) === JSON.stringify(db.prepare('SELECT message, reply FROM records ORDER BY id').all()),
    legacyValid: isGrowthJourney(old), legacyVersion: old.analysis.promptVersion}));
} finally { db.close(); }
"""
        script = (script.replace('BACKEND', json.dumps((root / 'api-server/src/journey.js').as_uri()))
                  .replace('CHAT', json.dumps(str(root / 'src/services/chat.ts')))
                  .replace('FRONTEND', json.dumps(str(root / 'src/services/journey.ts')))
                  .replace('OUTPUT', json.dumps(response.json(), ensure_ascii=True)))
        saved = json.loads(self.node(script))
        self.assertTrue(saved['valid'])
        self.assertEqual(saved['version'], 'journey-v5')
        self.assertFalse(saved['stale'])
        self.assertTrue(saved['recordsUnchanged'])
        self.assertTrue(saved['legacyValid'])
        self.assertEqual(saved['legacyVersion'], 'journey-v4')
        self.assertEqual(saved['evidence'], self.result().summary.model_dump()['evidence'])
