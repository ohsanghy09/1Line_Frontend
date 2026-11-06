from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError

from app.activity_metadata import ActivityMetadata, DateFact, activity_context, analyze_activity, validate_metadata
from app.analysis import AnalysisError
from app.database import SharedDatabase
from test_server import settings


class ActivityMetadataTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'metadata.db'
        module = Path(__file__).resolve().parents[2] / 'api-server/test-support/database.js'
        subprocess.run(['node', '--input-type=module', '-e',
                        f'import {{openDatabase}} from {json.dumps(module.as_uri())}; openDatabase(process.argv[1]).close();', str(self.path)],
                       check=True, capture_output=True)
        self.database = SharedDatabase(settings(ai_db_path=self.path))
        message = '2026년 1월부터 개발을 담당하며 진행 중이에요.'
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)',
                       ('r1', 'line1-hackathon', None, message, json.dumps({'analysis': {'summary': message, 'changes': []}}), '2026-11-06', '2026-11-06'))
            db.commit()

    def output(self):
        ref = [{'recordId': 'r1', 'quote': '개발을 담당하며 진행 중이에요.'}]
        return ActivityMetadata.model_validate({'summary': {'value': '개발을 담당하는 활동이에요.', 'evidence': ref},
            'status': {'value': '진행 중', 'evidence': ref}, 'role': {'value': '개발', 'evidence': ref},
            'period': {'start': None, 'end': None}})

    async def test_uses_confirmed_records_and_matches_node_hash(self):
        context = activity_context(self.database, 'line1-hackathon')
        module = Path(__file__).resolve().parents[2] / 'api-server/src/activity-metadata.js'
        script = f'import {{DatabaseSync}} from "node:sqlite"; import {{activitySnapshot}} from {json.dumps(module.as_uri())}; console.log(activitySnapshot(new DatabaseSync(process.argv[1]), "line1-hackathon").fingerprint)'
        result = subprocess.run(['node', '--input-type=module', '-e', script, str(self.path)], check=True, capture_output=True, text=True)
        self.assertEqual(context['sourceFingerprint'], result.stdout.strip())
        with patch('app.activity_metadata.structured_response', new_callable=AsyncMock, return_value=self.output()) as model:
            result = await analyze_activity(self.database, settings(openai_model='test'), 'line1-hackathon')
            self.assertEqual(result['recordCount'], 1)
            self.assertEqual(result['metadata']['role']['value'], '개발')
            model.assert_awaited_once()
        with closing(sqlite3.connect(self.path)) as db:
            self.assertIsNone(db.execute("SELECT summary FROM activities WHERE id='line1-hackathon'").fetchone()[0])

    async def test_empty_activity_does_not_call_model(self):
        with patch('app.activity_metadata.structured_response', new_callable=AsyncMock) as model:
            with self.assertRaises(AnalysisError):
                await analyze_activity(self.database, settings(), 'computer-vision')
            model.assert_not_called()

    def test_rejects_fake_evidence_and_invalid_dates(self):
        result = self.output()
        result.role.evidence[0].quote = '없는 원문'
        with self.assertRaises(AnalysisError):
            validate_metadata(result, activity_context(self.database, 'line1-hackathon'))
        for value in ['2026-02-30', '2026-13', '어제']:
            with self.assertRaises(ValidationError):
                DateFact(value=value, evidence=[{'recordId': 'r1', 'quote': '개발'}])

    def test_rejects_reversed_period_with_preserved_previous_value(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute("UPDATE activities SET end_date = '2025-01' WHERE id = 'line1-hackathon'")
            db.commit()
        result = self.output()
        result.period.start = DateFact(value='2026-01', evidence=[{'recordId': 'r1', 'quote': '2026년 1월'}])
        with self.assertRaises(AnalysisError):
            validate_metadata(result, activity_context(self.database, 'line1-hackathon'))
