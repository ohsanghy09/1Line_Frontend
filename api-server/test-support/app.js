// Test-only HTTP fixtures; never imported by the development server.
import express from 'express'
import multer from 'multer'
import { randomUUID } from 'node:crypto'
import { createApp as createProductionApp } from '../src/app.js'
import { transaction } from '../src/database.js'
import { analysisContext } from '../src/activities.js'
import { replySchema, linkSchema } from '../src/validation.js'
import { createMockReply, createMockLinkReply } from './mock-reply.js'
import { jobProgress } from './progress.js'
export function createApp(db, options = {}) {
  const app = express()
  app.use(express.json())
  const fail = (status, message) => Object.assign(new Error(message), { status })
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 10, fields: 3, fieldSize: 20000 } })
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
  app.post('/api/records', (req, _res, next) => {
    const job = db.prepare('SELECT * FROM analysis_jobs WHERE analysis_id = ?').get(req.body.analysisId ?? '')
    if (job && (job.error || jobProgress(job.started_at).status !== 'completed')) return next(fail(409, '분석이 완료된 뒤 기록해 주세요.'))
    next()
  })
  app.use(createProductionApp(db, options))
  app.use((error, _req, res, _next) => res.status(error.status ?? 400).json({ error: error.message }))
  return app
}
