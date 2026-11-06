"""파일 하나를 제외한 원본만 재분석한다. 삭제/확정 DB 쓰기는 백엔드가 맡는다."""
import json

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from .analysis import AnalysisError
from .home_analysis import analyze_home, build_reply
from .home_schemas import UploadedFile
from .schemas import AnalysisContext, ActivityContext, Identifier, StrictModel


class ExcludeFile(StrictModel):
    fileId: Identifier


def remaining_files(database, record_id, file_id):
    with database.connect() as connection:
        connection.execute('BEGIN')
        record = connection.execute('SELECT * FROM records WHERE id = ?', (record_id,)).fetchone()
        if not record:
            raise AnalysisError(404, 'record_missing', '기록을 찾을 수 없어요.')
        rows = connection.execute('SELECT * FROM files WHERE analysis_id = ? ORDER BY rowid', (record['analysis_id'],)).fetchall()
        if not any(row['id'] == file_id for row in rows) or len(rows) < 2:
            raise AnalysisError(409, 'remaining_files_missing', '남은 파일 목록이 변경됐어요. 다시 확인해 주세요.')
        activity = connection.execute('SELECT id, name, category FROM activities WHERE id = ?', (record['activity_id'],)).fetchone()
        files = [UploadedFile(id=row['id'], name=row['name'], mime_type=row['mime_type'], content=row['content'])
                 for row in rows if row['id'] != file_id]
        # 삭제 파일의 내용이 섞인 기존 요약/대화/분석 결과는 문맥에 포함하지 않는다.
        context = AnalysisContext(activities=[ActivityContext(**dict(activity))])
        return record['reply'], files, context


def material_delete_router(database, config):
    router = APIRouter()

    @router.post('/api/analyze/records/{record_id}/exclude-file')
    async def analyze(record_id: str, payload: ExcludeFile):
        previous, files, context = await run_in_threadpool(remaining_files, database, record_id, payload.fileId)
        result = await analyze_home(message='첨부된 남은 파일만으로 기록을 새로 요약해 주세요. 이전 자료와의 변화는 추정하지 마세요.',
                                    files=files, source_url=None, link_content=None, context=context, config=config)
        # 이전 자료와의 비교 근거가 없으므로 삭제 전 변화 이벤트는 복원하지 않는다.
        result.analysis.changes = []
        reply = build_reply(result, files, None, json.loads(previous)['id'])
        return {'reply': reply, 'recordReply': previous, 'fileIds': [file.id for file in files]}

    return router
