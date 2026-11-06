import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { transaction } from './database.js'
import { saveSchema, editSchema, replySchema, archiveQuerySchema } from './validation.js'
import { readArchive, readArchiveFile } from './archive.js'
import { activityInformation, analysisContext, resolveActivity, touchActivities } from './activities.js'
import { readHomeRecent } from './home.js'
import { searchArchive } from './archive-search.js'
import { readJourney, generateJourney } from './journey.js'
import { createActivityMetadataQueue, readActivityAnalysis } from './activity-metadata.js'
import { applyActivityChatUpdate, chatUpdateRequest } from './activity-chat-update.js'

export function createApp(db, { origin = 'http://localhost:5173', aiBaseUrl, autoActivityAnalysis = false, activityAnalysisOptions = {} } = {}) {
  const app = express()
  const activityMetadata = createActivityMetadataQueue(db, { aiBaseUrl, ...activityAnalysisOptions })
  app.locals.activityMetadata = activityMetadata
  app.use(cors({ origin }))
  app.use(express.json({ limit: '1mb' }))
  const fail = (status, message) => Object.assign(new Error(message), { status })
  const activity = id => {
    const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(id)
    if (!row) throw fail(404, '활동을 찾을 수 없습니다.')
    return row
  }
  const record = id => {
    const row = db.prepare('SELECT * FROM records WHERE id = ?').get(id)
    if (!row) throw fail(404, '기록을 찾을 수 없습니다.')
    return { id: row.id, activityId: row.activity_id, analysisId: row.analysis_id, message: row.message, reply: JSON.parse(row.reply), createdAt: row.created_at, updatedAt: row.updated_at }
  }
  const syncEvents = (id, reply, now) => {
    db.prepare('DELETE FROM timeline_events WHERE record_id = ?').run(id)
    // 주요 변화와 Turning Point는 구분한다. 목 응답만으로 전환점을 확정하지 않는다.
    for (const change of reply.analysis.changes) db.prepare('INSERT INTO timeline_events VALUES (?, ?, ?, 0, ?)').run(randomUUID(), id, JSON.stringify(change), now)
  }

  app.get('/api/health', (_req, res) => res.json({ status: 'ready', label: '기록 저장·조회 준비됨', analysisProvider: 'external' }))
  // 홈 분석 접수와 진행 조회는 FastAPI에서만 처리한다.
  app.post('/api/chat', (_req, res) => {
    res.status(410).json({ error: '분석 요청은 FastAPI AI 서버로 전송해 주세요.' })
  })
  app.post('/api/chat/links', (_req, res) => {
    res.status(410).json({ error: '분석 요청은 FastAPI AI 서버로 전송해 주세요.' })
  })
  app.get('/api/chat/jobs/:id', (_req, res) => res.status(410).json({ error: '분석 진행은 FastAPI AI 서버에서 조회해 주세요.' }))
  app.get('/api/activities', (_req, res) => res.json(analysisContext(db).activities))
  app.post('/api/activities/apply-chat-update', (req, res) => {
    const input = chatUpdateRequest.parse(req.body)
    const { changed, ...result } = applyActivityChatUpdate(db, input.analysisId)
    if (changed) activityMetadata.cancelPending(result.reply.updatedActivityId)
    res.json(result)
  })
  app.get('/api/home/recent', (_req, res) => res.json(readHomeRecent(db)))
  // 조회는 저장 결과만 반환한다. 실제 모델은 사용자의 분석 요청에서만 호출한다.
  let journeyRunning = false
  // 진행 중 분석의 결과가 삭제 직후 다시 저장되지 않도록 같은 트랜잭션에서 검사한다.
  app.post('/api/settings/reset-data', (req, res) => {
    if (req.body?.confirmation !== '전체 삭제') throw fail(400, '확인 문구를 정확히 입력해 주세요.')
    transaction(db, () => {
      if (journeyRunning || activityMetadata.hasActive() || db.prepare("SELECT id FROM ai_chat_jobs WHERE status IN ('queued', 'running') LIMIT 1").get()) {
        throw fail(409, 'AI 분석이 진행 중이에요. 분석이 끝난 뒤 다시 삭제해 주세요.')
      }
      for (const table of ['timeline_events', 'records', 'files', 'analysis_jobs', 'ai_chat_jobs', 'journey_analyses', 'analyses', 'activities']) {
        db.exec(`DELETE FROM ${table}`)
      }
    })
    res.json({ deleted: true })
  })
  app.get('/api/journey', (_req, res) => res.json(readJourney(db)))
  app.get('/api/activities/:id/analysis', (req, res) => {
    activity(req.params.id)
    res.json(readActivityAnalysis(db, req.params.id))
  })
  app.post('/api/activities/:id/analyze', (req, res) => {
    activity(req.params.id)
    if (!db.prepare('SELECT id FROM records WHERE activity_id = ? LIMIT 1').get(req.params.id)) throw fail(422, '저장된 자료가 있는 활동만 분석할 수 있어요.')
    const state = readActivityAnalysis(db, req.params.id)
    if (!['queued', 'running'].includes(state.status) && !activityMetadata.schedule(req.params.id)) throw fail(503, '활동 정보 분석을 접수하지 못했어요. 잠시 후 다시 시도해 주세요.')
    res.status(202).json(readActivityAnalysis(db, req.params.id))
  })
  app.post('/api/journey/analyze', async (_req, res) => {
    if (journeyRunning) throw fail(409, '성장 분석이 진행 중이에요. 잠시 후 다시 조회해 주세요.')
    if (!db.prepare('SELECT id FROM records LIMIT 1').get()) throw fail(422, '홈에서 기록을 저장한 뒤 성장 분석을 실행해 주세요.')
    journeyRunning = true
    try { res.json(await generateJourney(db, { aiBaseUrl })) }
    finally { journeyRunning = false }
  })

  // 기존 활동 선택 API와 분리해 아카이브 화면에 필요한 DB 조회 계약을 제공한다.
  app.get('/api/archive/activities', (req, res) => res.json(searchArchive(db, archiveQuerySchema.parse(req.query))))
  app.get('/api/archive/activities/:id', (req, res) => {
    const result = readArchive(db, req.params.id)
    if (!result) throw fail(404, '활동을 찾을 수 없습니다.')
    res.json(result)
  })
  app.get('/api/archive/activities/:id/materials/:fileId', (req, res) => {
    const result = readArchiveFile(db, req.params.id, req.params.fileId)
    if (!result) throw fail(404, '이 활동에서 자료를 찾을 수 없습니다.')
    res.json(result)
  })

  app.get('/api/conversations/:id/messages', (req, res) => {
    const rows = db.prepare(`SELECT * FROM analyses WHERE conversation_id = ? AND NOT EXISTS
      (SELECT 1 FROM ai_chat_jobs WHERE analysis_id = analyses.id AND status != 'completed') ORDER BY created_at, rowid`).all(req.params.id)
    res.json(rows.map(row => ({ analysisId: row.id, message: row.message, reply: JSON.parse(row.reply), createdAt: row.created_at, attachments: db.prepare('SELECT id, name, size FROM files WHERE analysis_id = ?').all(row.id) })))
  })
  app.get('/api/files/:id', (req, res) => {
    const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id)
    if (!file) throw fail(404, '파일을 찾을 수 없습니다.')
    res.set('Content-Type', 'application/octet-stream')
    res.set('Content-Disposition', `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    res.send(Buffer.from(file.content))
  })

  // 확정 단계: 분석 초안 또는 외부 카드 JSON을 활동 기록으로 저장한다.
  app.post('/api/records', (req, res) => {
    const input = saveSchema.parse(req.body)
    let reply = input.reply, message = input.message
    if (input.analysisId) {
      const draft = db.prepare('SELECT * FROM analyses WHERE id = ?').get(input.analysisId)
      if (!draft) throw fail(404, '분석 초안을 찾을 수 없습니다.')
      const aiJob = db.prepare('SELECT status FROM ai_chat_jobs WHERE analysis_id = ?').get(input.analysisId)
      if (aiJob && aiJob.status !== 'completed') throw fail(409, '실제 AI 분석이 완료된 뒤 기록해 주세요.')
      const job = db.prepare('SELECT * FROM analysis_jobs WHERE analysis_id = ?').get(input.analysisId)
      // 이전 DB의 작업도 기존 완료 대기 시간 전에는 확정 저장하지 않는다.
      if (job && (job.error || Date.now() < job.started_at + 2800)) throw fail(409, '분석이 완료된 뒤 기록해 주세요.')
      if (db.prepare('SELECT id FROM records WHERE analysis_id = ?').get(input.analysisId)) throw fail(409, '이미 기록한 분석입니다.')
      reply = replySchema.parse(JSON.parse(draft.reply))
      message = draft.message
    }
    if (input.classification && input.classification.materialType !== reply.analysis.materialType) {
      reply.analysis.materialType = input.classification.materialType
      reply.analysis.files.forEach(file => { file.materialType = input.classification.materialType })
      if (reply.analysis.groups.length) reply.analysis.groups = [{ materialType: input.classification.materialType, count: reply.analysis.files.length }]
    }
    const id = randomUUID(), now = new Date().toISOString()
    transaction(db, () => {
      const target = resolveActivity(db, input, activity, fail)
      reply.content = reply.content.replaceAll(reply.analysis.activity.name, target.name)
      reply.activityCreated = Boolean(input.newActivity)
      if (input.newActivity) reply.content = `${target.name} 활동에 자료를 기록했어요.`
      reply.analysis.activity = { ...activityInformation(target), match: 'existing', confidence: reply.analysis.activity.confidence }
      db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, target.id, input.analysisId ?? null, message, JSON.stringify(reply), now, now)
      syncEvents(id, reply, now)
      touchActivities(db, [target.id], now)
    })
    const saved = record(id)
    if (autoActivityAnalysis) activityMetadata.schedule(saved.activityId)
    res.status(201).json(saved)
  })
  app.get('/api/records/:id', (req, res) => res.json(record(req.params.id)))
  app.get('/api/activities/:id/records', (req, res) => {
    activity(req.params.id)
    res.json(db.prepare('SELECT id FROM records WHERE activity_id = ? ORDER BY created_at, rowid').all(req.params.id).map(row => record(row.id)))
  })
  app.patch('/api/records/:id', (req, res) => {
    const input = editSchema.parse(req.body), current = record(req.params.id)
    const reply = current.reply
    if (input.materialType !== undefined) {
      reply.analysis.materialType = input.materialType
      reply.analysis.files.forEach(file => { file.materialType = input.materialType })
      if (reply.analysis.groups.length) reply.analysis.groups = [{ materialType: input.materialType, count: reply.analysis.files.length }]
    }
    if (input.summary !== undefined) reply.analysis.summary = input.summary
    if (input.content !== undefined) reply.content = input.content
    if (input.changes !== undefined) {
      reply.analysis.changes = input.changes
      reply.analysis.suggestedSaveMode = input.changes.length ? 'record-change' : 'archive'
    }
    const now = new Date().toISOString()
    transaction(db, () => {
      const target = resolveActivity(db, { activityId: input.activityId ?? current.activityId, activityUpdates: input.activityUpdates }, activity, fail)
      reply.content = reply.content.replaceAll(reply.analysis.activity.name, target.name)
      if (target.id !== current.activityId) reply.activityCreated = false
      reply.analysis.activity = { ...activityInformation(target), match: 'existing', confidence: reply.analysis.activity.confidence }
      db.prepare('UPDATE records SET activity_id = ?, reply = ?, updated_at = ? WHERE id = ?').run(target.id, JSON.stringify(reply), now, current.id)
      if (input.changes !== undefined) syncEvents(current.id, reply, now)
      touchActivities(db, [current.activityId, target.id], now)
    })
    const saved = record(current.id)
    if (autoActivityAnalysis) for (const id of new Set([current.activityId, saved.activityId])) activityMetadata.schedule(id)
    res.json(saved)
  })
  app.get('/api/activities/:id/timeline', (req, res) => {
    activity(req.params.id)
    res.json(db.prepare('SELECT e.* FROM timeline_events e JOIN records r ON e.record_id = r.id WHERE r.activity_id = ? ORDER BY e.created_at, e.rowid').all(req.params.id).map(row => ({ id: row.id, recordId: row.record_id, change: JSON.parse(row.change_json), isTurningPoint: Boolean(row.is_turning_point), createdAt: row.created_at })))
  })
  app.use((_req, res) => res.status(404).json({ error: 'API를 찾을 수 없습니다.' }))
  app.use((error, _req, res, _next) => {
    const status = error.name === 'ZodError' ? 400 : error instanceof multer.MulterError ? 400 : error.status ?? 500
    if (status >= 500) console.error(error)
    res.status(status).json({ error: status >= 500 && !error.publicMessage ? '서버 처리 중 오류가 발생했습니다.' : error.message })
  })
  return app
}
