import express from 'express'
import cors from 'cors'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { transaction } from './database.js'
import { createMockReply, createMockLinkReply } from './mock-reply.js'
import { saveSchema, editSchema, linkSchema, replySchema, archiveQuerySchema } from './validation.js'
import { jobProgress } from './progress.js'
import { readArchive, readArchiveFile } from './archive.js'
import { activityInformation, analysisContext, resolveActivity, touchActivities } from './activities.js'
import { readHomeRecent } from './home.js'
import { searchArchive } from './archive-search.js'
import { readJourney } from './journey.js'

export function createApp(db, { origin = 'http://localhost:5173', testMockAnalysis = false } = {}) {
  const app = express()
  app.use(cors({ origin }))
  app.use(express.json({ limit: '1mb' }))
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 3, fieldSize: 20000 } })
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

  app.get('/api/health', (_req, res) => res.json({ status: 'ready', label: '기록 저장·조회 준비됨', analysisProvider: testMockAnalysis ? 'mock' : 'external' }))
  // 기존 저장 회귀 검사의 합성 입력 전용이다. 실제 개발 서버에는 목 분석 접수를 열지 않는다.
  app.post(['/api/chat', '/api/chat/links'], (_req, res, next) => {
    if (testMockAnalysis) return next()
    res.status(410).json({ error: '분석 요청은 FastAPI AI 서버로 전송해 주세요.' })
  })
  app.get('/api/activities', (_req, res) => res.json(analysisContext(db).activities))
  app.get('/api/home/recent', (_req, res) => res.json(readHomeRecent(db)))
  // HTTP 연결을 위한 목 분석 조회. 실제 AI·DB 성장 분석은 후속 단계다.
  app.get('/api/journey', (_req, res) => res.json(readJourney()))

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

  // 전송 단계: 채팅 내용·원본 파일·목 응답을 분석 초안으로 보관한다.
  app.post('/api/chat', upload.array('files', 10), (req, res) => {
    const { message = '', mode = 'no-change', conversationId = randomUUID() } = req.body ?? {}
    const files = req.files ?? []
    // 브라우저가 multipart 파일명에 보낸 UTF-8을 Multer의 기본 Latin-1 해석에서 복원한다.
    for (const file of files) {
      if ([...file.originalname].every(char => char.codePointAt(0) <= 255)) {
        try { file.originalname = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(file.originalname, 'latin1')) } catch { /* UTF-8이 아닌 이름은 원본을 유지한다. */ }
      }
    }
    if (typeof message !== 'string' || message.length > 20000 || (!message.trim() && !files.length)) throw fail(400, '텍스트 또는 파일을 보내주세요. 텍스트는 최대 20000자입니다.')
    if (!['change', 'no-change'].includes(mode) || typeof conversationId !== 'string' || !conversationId.trim() || conversationId.length > 200) throw fail(400, 'mode 또는 conversationId가 올바르지 않습니다.')
    const id = randomUUID(), now = new Date().toISOString()
    const reply = replySchema.parse(createMockReply(message, files, mode, analysisContext(db)))
    // 파일 요청은 Prefer 헤더로 비동기 진행 조회를 선택한다. 기존 동기 클라이언트는 유지한다.
    const jobId = files.length && req.get('Prefer') === 'respond-async' ? randomUUID() : null
    const attachments = transaction(db, () => {
      db.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?)').run(id, conversationId, message, JSON.stringify(reply), now)
      if (jobId) db.prepare('INSERT INTO analysis_jobs VALUES (?, ?, ?, NULL)').run(jobId, id, Date.now())
      return files.map(file => {
        const fileId = randomUUID()
        db.prepare('INSERT INTO files VALUES (?, ?, ?, ?, ?, ?)').run(fileId, id, file.originalname, file.mimetype, file.size, file.buffer)
        return { id: fileId, name: file.originalname, size: file.size }
      })
    })
    if (jobId) return res.status(202).json({ jobId, ...jobProgress(Date.now()), pollAfterMs: 400, analysisProvider: 'mock' })
    res.status(201).json({ analysisId: id, conversationId, message, attachments, reply, createdAt: now, analysisProvider: 'mock' })
  })
  // 링크도 파일과 같은 작업 ID·진행 조회·확정 저장 경계를 사용한다.
  app.post('/api/chat/links', (req, res) => {
    const input = linkSchema.parse(req.body)
    const id = randomUUID(), jobId = randomUUID(), now = new Date().toISOString()
    const reply = replySchema.parse(createMockLinkReply(input.url, analysisContext(db)))
    transaction(db, () => {
      db.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?)').run(id, input.conversationId ?? randomUUID(), input.url, JSON.stringify(reply), now)
      db.prepare('INSERT INTO analysis_jobs VALUES (?, ?, ?, NULL)').run(jobId, id, Date.now())
    })
    res.status(202).json({ jobId, ...jobProgress(Date.now(), Date.now(), 'link-analysis'), pollAfterMs: 400, analysisProvider: 'mock' })
  })
  app.get('/api/chat/jobs/:id', (req, res) => {
    const job = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(req.params.id)
    if (!job) throw fail(404, '분석 작업을 찾을 수 없습니다.')
    if (job.error) return res.json({ jobId: job.id, status: 'failed', error: job.error, analysisProvider: 'mock' })
    const draft = db.prepare('SELECT * FROM analyses WHERE id = ?').get(job.analysis_id)
    const state = jobProgress(job.started_at, Date.now(), JSON.parse(draft.reply).kind)
    if (state.status !== 'completed') return res.json({ jobId: job.id, ...state, pollAfterMs: 400, analysisProvider: 'mock' })
    res.json({ jobId: job.id, ...state, analysisProvider: 'mock', result: {
      analysisId: draft.id, conversationId: draft.conversation_id, message: draft.message,
      attachments: db.prepare('SELECT id, name, size FROM files WHERE analysis_id = ?').all(draft.id),
      reply: JSON.parse(draft.reply), createdAt: draft.created_at,
    } })
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

  // 확정 단계: 채팅 초안 또는 /example의 카드 JSON을 활동 기록으로 저장한다.
  app.post('/api/records', (req, res) => {
    const input = saveSchema.parse(req.body)
    let reply = input.reply, message = input.message
    if (input.analysisId) {
      const draft = db.prepare('SELECT * FROM analyses WHERE id = ?').get(input.analysisId)
      if (!draft) throw fail(404, '분석 초안을 찾을 수 없습니다.')
      const aiJob = db.prepare('SELECT status FROM ai_chat_jobs WHERE analysis_id = ?').get(input.analysisId)
      if (aiJob && aiJob.status !== 'completed') throw fail(409, '실제 AI 분석이 완료된 뒤 기록해 주세요.')
      const job = db.prepare('SELECT * FROM analysis_jobs WHERE analysis_id = ?').get(input.analysisId)
      if (job && (job.error || jobProgress(job.started_at).status !== 'completed')) throw fail(409, '분석이 완료된 뒤 기록해 주세요.')
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
      reply.analysis.activity = { ...activityInformation(target), match: 'existing', confidence: reply.analysis.activity.confidence }
      db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, target.id, input.analysisId ?? null, message, JSON.stringify(reply), now, now)
      syncEvents(id, reply, now)
      touchActivities(db, [target.id], now)
    })
    res.status(201).json(record(id))
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
      reply.analysis.activity = { ...activityInformation(target), match: 'existing', confidence: reply.analysis.activity.confidence }
      db.prepare('UPDATE records SET activity_id = ?, reply = ?, updated_at = ? WHERE id = ?').run(target.id, JSON.stringify(reply), now, current.id)
      if (input.changes !== undefined) syncEvents(current.id, reply, now)
      touchActivities(db, [current.activityId, target.id], now)
    })
    res.json(record(current.id))
  })
  app.get('/api/activities/:id/timeline', (req, res) => {
    activity(req.params.id)
    res.json(db.prepare('SELECT e.* FROM timeline_events e JOIN records r ON e.record_id = r.id WHERE r.activity_id = ? ORDER BY e.created_at, e.rowid').all(req.params.id).map(row => ({ id: row.id, recordId: row.record_id, change: JSON.parse(row.change_json), isTurningPoint: Boolean(row.is_turning_point), createdAt: row.created_at })))
  })
  app.use((_req, res) => res.status(404).json({ error: 'API를 찾을 수 없습니다.' }))
  app.use((error, _req, res, _next) => {
    const status = error.name === 'ZodError' ? 400 : error instanceof multer.MulterError ? 400 : error.status ?? 500
    if (status >= 500) console.error(error)
    res.status(status).json({ error: status >= 500 ? '서버 처리 중 오류가 발생했습니다.' : error.message })
  })
  return app
}
