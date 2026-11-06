import { randomUUID } from 'node:crypto'
import { transaction } from './database.js'
import { readArchiveFile } from './archive.js'
import { replySchema } from './validation.js'
import { activitySnapshot } from './activity-metadata.js'

const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: true })

// 대화는 남기되 삭제된 자료를 다시 저장하거나 활동 링크를 여는 카드로 복원하지 않는다.
function retireDraft(db, analysisId, content = '이 기록의 자료는 삭제했어요.') {
  if (!analysisId) return
  const row = db.prepare('SELECT reply FROM analyses WHERE id = ?').get(analysisId)
  if (!row) return
  const reply = JSON.parse(row.reply)
  db.prepare('UPDATE analyses SET reply = ? WHERE id = ?').run(JSON.stringify({
    id: reply.id, role: 'assistant', kind: 'general', analysis: null,
    content: `${reply.content}\n\n${content}`,
  }), analysisId)
}

function clearMetadata(db, id) {
  db.prepare(`UPDATE activities SET summary = NULL, role = NULL, status = NULL,
    start_date = NULL, end_date = NULL, period = NULL, metadata_status = 'idle',
    metadata_fingerprint = NULL, metadata_error = NULL, metadata_model = NULL, metadata_updated_at = NULL,
    updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id)
}

// 삭제된 근거를 포함한 전체 요약/배지를 부분적으로 신뢰할 수 없으므로 스냅샷 전체를 비운다.
function invalidateJourney(db) {
  for (const row of db.prepare('SELECT id, result_json FROM journey_analyses').all()) {
    const result = JSON.parse(row.result_json)
    result.summary = { title: '기록이 삭제됐어요.', description: '남은 기록으로 성장 분석을 갱신해 주세요.' }
    result.badges = []; result.events = []
    result.typeOptions = [{ value: 'all', label: '전체' }]
    result.axisOptions = [{ value: 'all', label: '전체 분야' }]
    db.prepare('UPDATE journey_analyses SET source_fingerprint = ?, result_json = ? WHERE id = ?')
      .run('deleted:' + randomUUID(), JSON.stringify(result), row.id)
  }
}

export function deleteActivity(db, id, confirmation) {
  transaction(db, () => {
    const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(id)
    if (!activity) throw fail(404, '활동을 찾을 수 없어요.')
    if (confirmation !== activity.name) throw fail(400, '활동명을 정확히 입력해 주세요.')
    for (const record of db.prepare('SELECT analysis_id FROM records WHERE activity_id = ?').all(id)) {
      if (record.analysis_id) db.prepare('DELETE FROM files WHERE analysis_id = ?').run(record.analysis_id)
      retireDraft(db, record.analysis_id, '이 기록의 활동은 삭제했어요.')
    }
    db.prepare('DELETE FROM records WHERE activity_id = ?').run(id)
    // 미확정 제안/직접 수정 응답도 삭제한 활동으로 연결하지 않는다.
    for (const row of db.prepare('SELECT id, reply FROM analyses').all()) {
      const reply = JSON.parse(row.reply)
      if (reply.analysis?.activity?.id === id || reply.updatedActivityId === id || reply.update?.activityId === id) {
        retireDraft(db, row.id, '연결된 활동은 삭제했어요.')
      }
    }
    db.prepare('DELETE FROM activities WHERE id = ?').run(id)
    invalidateJourney(db)
  })
}

export async function deleteMaterial(db, activityId, fileId, { aiBaseUrl, request = fetch, syncEvents }) {
  const detail = readArchiveFile(db, activityId, fileId)
  if (!detail) throw fail(404, '이 활동에서 자료를 찾을 수 없어요.')
  const original = db.prepare('SELECT * FROM records WHERE id = ?').get(detail.file.recordId)
  const snapshot = activitySnapshot(db, activityId)
  const remaining = original.analysis_id ? db.prepare('SELECT id, name FROM files WHERE analysis_id = ? AND id != ? ORDER BY rowid').all(original.analysis_id, fileId) : []
  let nextReply
  if (detail.file.kind === 'file' && remaining.length) {
    let response
    try {
      const base = (aiBaseUrl ?? process.env.AI_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
      response = await request(`${base}/api/analyze/records/${encodeURIComponent(original.id)}/exclude-file`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileId }), signal: AbortSignal.timeout(150000),
      })
    } catch { throw fail(502, '남은 파일을 재분석하지 못해 삭제하지 않았어요. AI 서버를 확인하고 다시 시도해 주세요.') }
    const body = await response.json().catch(() => null)
    const parsed = replySchema.safeParse(body?.reply)
    if (!response.ok || !parsed.success || body.recordReply !== original.reply
      || JSON.stringify(body.fileIds) !== JSON.stringify(remaining.map(file => file.id))) {
      throw fail(502, '남은 파일의 분석 결과를 확인하지 못해 삭제하지 않았어요. 다시 시도해 주세요.')
    }
    nextReply = parsed.data
    if (nextReply.sourceUrl || nextReply.analysis.changes.length || JSON.stringify(nextReply.analysis.files.map(file => file.name)) !== JSON.stringify(remaining.map(file => file.name))) {
      throw fail(502, '남은 파일의 분석 대상이 일치하지 않아 삭제하지 않았어요. 다시 시도해 주세요.')
    }
    const oldReply = JSON.parse(original.reply)
    nextReply.analysis.activity = oldReply.analysis.activity
    nextReply.activityCreated = oldReply.activityCreated
  }
  transaction(db, () => {
    if (activitySnapshot(db, activityId)?.fingerprint !== snapshot.fingerprint) throw fail(409, '삭제 중 활동 기록이 변경됐어요. 새로고침 후 다시 시도해 주세요.')
    if (detail.file.kind === 'file') db.prepare('DELETE FROM files WHERE id = ?').run(fileId)
    retireDraft(db, original.analysis_id)
    if (nextReply) {
      db.prepare("UPDATE records SET message = '', reply = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(nextReply), new Date().toISOString(), original.id)
      syncEvents(original.id, nextReply, new Date().toISOString())
    } else db.prepare('DELETE FROM records WHERE id = ?').run(original.id)
    clearMetadata(db, activityId)
    invalidateJourney(db)
  })
}
