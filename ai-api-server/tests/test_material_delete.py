from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.analysis import AnalysisError
from app.database import SharedDatabase
from app.home_schemas import HomeResponse
from app.main import create_app
from app.material_delete import remaining_files
from test_server import settings


class MaterialDeleteTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'delete.db'
        module = Path(__file__).resolve().parents[2] / 'api-server/test-support/database.js'
        subprocess.run(['node', '--input-type=module', '-e',
                        f'import {{openDatabase}} from {json.dumps(module.as_uri())}; openDatabase(process.argv[1]).close();', str(self.path)], check=True, capture_output=True)
        self.config = settings(ai_db_path=self.path, openai_api_key='test', openai_model='test')
        self.database = SharedDatabase(self.config)
        self.reply = json.dumps({'id': 'reply1', 'analysis': {'summary': '삭제할 이전 요약'}})
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('INSERT INTO analyses VALUES (?, ?, ?, ?, ?)', ('a1', 'c1', '이전 입력', self.reply, '2026-11-06'))
            db.execute('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)', ('r1', 'line1-hackathon', 'a1', '', self.reply, '2026-11-06', '2026-11-06'))
            for file_id, text in [('f1', b'deleted'), ('f2', b'remaining')]:
                db.execute('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)', (file_id, 'a1', file_id + '.txt', 'text/plain', len(text), text))
            db.commit()

    def test_only_remaining_originals_and_no_old_summary_or_chat_in_context(self):
        previous, files, context = remaining_files(self.database, 'r1', 'f1')
        self.assertEqual(previous, self.reply)
        self.assertEqual([(file.id, file.content) for file in files], [('f2', b'remaining')])
        self.assertEqual(context.records, [])
        self.assertIsNone(context.activities[0].summary)
        for record_id, file_id in [('missing', 'f1'), ('r1', 'foreign')]:
            with self.assertRaises(AnalysisError):
                remaining_files(self.database, record_id, file_id)

    def test_endpoint_reanalyzes_once_without_writing_database(self):
        async def analyze(**values):
            self.assertEqual([file.id for file in values['files']], ['f2'])
            self.assertEqual(values['context'].records, [])
            return HomeResponse.model_validate({'kind': 'analysis', 'content': '남은 자료를 정리했어요.', 'analysis': {
                'activity': {'match': 'existing', 'id': 'line1-hackathon', 'name': '1호선톤', 'confidence': 'high'},
                'materialType': '회의록', 'stage': None, 'summary': '남은 원본 요약', 'changes': [],
                'files': [{'id': 'f2', 'materialType': '회의록'}],
            }})
        with patch('app.material_delete.analyze_home', side_effect=analyze) as model, TestClient(create_app(self.config)) as client:
            response = client.post('/api/analyze/records/r1/exclude-file', json={'fileId': 'f1'})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.json()['fileIds'], ['f2'])
            self.assertEqual(response.json()['reply']['analysis']['summary'], '남은 원본 요약')
            self.assertEqual(response.json()['recordReply'], self.reply)
            self.assertEqual(model.call_count, 1)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM files').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT reply FROM records').fetchone()[0], self.reply)

    def test_model_error_keeps_originals_and_record(self):
        with patch('app.material_delete.analyze_home', side_effect=AnalysisError(502, 'test', '분석 실패')), TestClient(create_app(self.config)) as client:
            self.assertEqual(client.post('/api/analyze/records/r1/exclude-file', json={'fileId': 'f1'}).status_code, 502)
        with closing(sqlite3.connect(self.path)) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM files').fetchone()[0], 2)
            self.assertEqual(db.execute('SELECT reply FROM records').fetchone()[0], self.reply)
