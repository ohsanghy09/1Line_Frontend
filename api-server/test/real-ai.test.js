import assert from 'node:assert/strict'
import test from 'node:test'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../src/app.js'
import { createMockReply } from '../test-support/mock-reply.js'

test('실제 개발 모드는 목 분석 접수를 막고 AI 작업 완료 후에만 기록을 저장한다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    assert.equal((await fetch(`${base}/chat`, post({ message: '입력' }))).status, 410)
    assert.equal((await fetch(`${base}/chat/links`, post({ url: 'https://example.com' }))).status, 410)
    const now = new Date().toISOString()
    // 저장 계약 검사만을 위한 합성 결과다. 실제 모델 호출은 check-live-ai에서 검증한다.
    const reply = createMockReply('검증 입력', [], 'no-change')
    db.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?)').run('real-analysis', 'test', '검증 입력', JSON.stringify(reply), now)
    db.prepare("INSERT INTO ai_chat_jobs VALUES (?, ?, ?, ?, ?, 'running', 'analyzing', NULL, ?, ?, ?)")
      .run('ai-job', 'request-1', 'fingerprint', 'real-analysis', 'chat', '{}', now, now)
    const input = { analysisId: 'real-analysis', activityId: 'line1-hackathon' }
    assert.equal((await fetch(`${base}/records`, post(input))).status, 409)
    assert.deepEqual(await (await fetch(`${base}/conversations/test/messages`)).json(), [])
    db.prepare("UPDATE ai_chat_jobs SET status = 'completed' WHERE id = 'ai-job'").run()
    assert.equal((await fetch(`${base}/records`, post(input))).status, 201)
    assert.equal((await fetch(`${base}/records`, post(input))).status, 409)
    assert.equal((await (await fetch(`${base}/activities/line1-hackathon/records`)).json()).length, 1)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})

test('실제 신규 활동 초안은 승인 후 생성되며 충돌·중복·일반 대화 저장은 거절한다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const candidate = { name: '북클럽봄', category: '독서 모임', status: null, role: null, period: null, summary: null }
  const post = async body => {
    const response = await fetch(base + '/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  try {
    const reply = createMockReply('검증 입력', [], 'no-change')
    reply.analysis.activity = { ...candidate, match: 'new', id: null, confidence: 'high' }
    const now = new Date().toISOString()
    for (const id of ['new-draft', 'conflict-draft', 'general-draft']) {
      const output = id === 'general-draft' ? { id: 'general', role: 'assistant', kind: 'general', content: '안녕하세요!', analysis: null } : reply
      db.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?)').run(id, 'approval', '입력', JSON.stringify(output), now)
      db.prepare("INSERT INTO ai_chat_jobs VALUES (?, ?, ?, ?, 'chat', 'completed', 'completed', NULL, '{}', ?, ?)").run('job-' + id, id, id, id, now, now)
    }
    db.prepare("INSERT INTO files VALUES ('original', 'new-draft', '자료.txt', 'text/plain', 4, X'74657374')").run()
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 5)
    assert.equal((await post({ analysisId: 'new-draft' })).status, 400)
    const saved = await post({ analysisId: 'new-draft', newActivity: candidate })
    assert.equal(saved.status, 201)
    assert.equal(saved.data.reply.analysis.activity.match, 'existing')
    assert.equal(saved.data.reply.activityCreated, true)
    assert.equal(saved.data.reply.analysis.activity.category, '독서 모임')
    assert.equal(db.prepare('SELECT analysis_id FROM records WHERE id = ?').get(saved.data.id).analysis_id, 'new-draft')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 6)
    assert.equal((await post({ analysisId: 'new-draft', newActivity: candidate })).status, 409)
    assert.equal((await post({ analysisId: 'conflict-draft', newActivity: candidate })).status, 409)
    assert.equal((await post({ analysisId: 'general-draft', newActivity: { ...candidate, name: '만들면 안 됨' } })).status, 400)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 6)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1)
    const attached = await fetch(base + '/files/original')
    assert.equal(await attached.text(), 'test')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { await new Promise(resolve => server.close(resolve)); db.close() }
})
