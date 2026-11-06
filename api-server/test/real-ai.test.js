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
