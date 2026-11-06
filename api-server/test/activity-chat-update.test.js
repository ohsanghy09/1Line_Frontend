import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../src/app.js'
import { createMockReply } from '../test-support/mock-reply.js'
import { activitySnapshot, readActivityAnalysis } from '../src/activity-metadata.js'

const activityId = 'line1-hackathon'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let n = 0; n < 200; n++) { if (check()) return; await sleep(10) }
  assert.fail('작업 대기 초과')
}
async function withApi(work, options = {}) {
  const db = openDatabase(':memory:')
  const app = createApp(db, options)
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const send = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  const command = (id, updates, target = activityId) => {
    const now = new Date().toISOString()
    const reply = { id: 'reply-' + id, role: 'assistant', kind: 'activity-update', analysis: null,
      content: '활동 정보를 수정하고 있어요.', update: { activityId: target, activityName: '잘못된 모델 표시명', updates } }
    db.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?)').run(id, 'chat-edit', '역할을 팀장으로 바꿔줘', JSON.stringify(reply), now)
    db.prepare("INSERT INTO ai_chat_jobs VALUES (?, ?, ?, ?, 'chat', 'completed', 'completed', NULL, '{}', ?, ?)").run('job-' + id, id, id, id, now, now)
  }
  try { await work({ db, app, send, base, command }) }
  finally { await app.locals.activityMetadata.close(); await new Promise(resolve => server.close(resolve)); db.close() }
}

test('대화 수정은 최근 활동 시각·정렬을 갱신하고 자료를 추가하거나 중복 시각 갱신을 하지 않는다', () => withApi(async ({ db, send, command, base }) => {
  db.prepare('UPDATE activities SET role = ?, summary = ?, status = ?, start_date = ?, updated_at = ? WHERE id = ?')
    .run('개발', '기존 활동 요약', '진행 중', '2026-01', '2026-01-01', activityId)
  command('role-edit', [{ field: 'role', value: '팀장' }])
  db.prepare('UPDATE activities SET updated_at = ? WHERE id = ?').run('2026-02-01T00:00:00.000Z', 'computer-vision')
  assert.equal((await (await fetch(base + '/home/recent')).json()).activities[0].id, 'computer-vision')
  const beforeUpdate = Date.now()
  const result = await send('/activities/apply-chat-update', { analysisId: 'role-edit' })
  assert.equal(result.status, 200)
  assert.equal(result.data.reply.kind, 'general')
  assert.match(result.data.reply.content, /1호선톤/)
  assert.match(result.data.reply.content, /팀장/)
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId)
  assert.equal(row.role, '팀장')
  assert.equal(row.summary, '기존 활동 요약')
  assert.equal(row.status, '진행 중')
  assert.equal(row.start_date, '2026-01')
  assert.ok(Date.parse(row.updated_at) >= beforeUpdate && Date.parse(row.updated_at) <= Date.now())
  const recent = await (await fetch(base + '/home/recent')).json()
  assert.equal(recent.activities[0].id, activityId)
  assert.equal(recent.activities[0].updatedAt, row.updated_at)
  assert.deepEqual(recent.records, [])
  const footprints = await (await fetch(base + '/archive/activities?sort=recent')).json()
  assert.equal(footprints.items[0].id, activityId)
  assert.equal(footprints.items[0].updatedAt, row.updated_at)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM timeline_events').get().n, 0)
  db.prepare('UPDATE activities SET role = ?, updated_at = ? WHERE id = ?').run('이후 AI 갱신값', '2026-03-01T00:00:00.000Z', activityId)
  assert.deepEqual((await send('/activities/apply-chat-update', { analysisId: 'role-edit' })).data, result.data)
  assert.equal(db.prepare('SELECT role FROM activities WHERE id = ?').get(activityId).role, '이후 AI 갱신값')
  assert.equal(db.prepare('SELECT updated_at FROM activities WHERE id = ?').get(activityId).updated_at, '2026-03-01T00:00:00.000Z')
}))

test('기간·상태·요약 수정과 명시적 비우기를 지원하고 잘못된 요청은 원자적으로 거절한다', () => withApi(async ({ db, send, command }) => {
  command('period', [{ field: 'startDate', value: '2026-03' }, { field: 'endDate', value: '2026-06' }, { field: 'status', value: '완료' }])
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'period' })).status, 200)
  command('bad-period', [{ field: 'role', value: '반영되면 안 됨' }, { field: 'startDate', value: '2027-01' }])
  const beforeRejected = db.prepare('SELECT updated_at FROM activities WHERE id = ?').get(activityId).updated_at
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'bad-period' })).status, 400)
  assert.equal(db.prepare('SELECT role FROM activities WHERE id = ?').get(activityId).role, null)
  assert.equal(db.prepare('SELECT updated_at FROM activities WHERE id = ?').get(activityId).updated_at, beforeRejected)
  command('clear', [{ field: 'endDate', value: null }, { field: 'summary', value: '사용자가 요청한 요약' }])
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'clear' })).status, 200)
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(activityId)
  assert.equal(row.end_date, null)
  assert.equal(row.summary, '사용자가 요청한 요약')
  assert.equal(row.status, '완료')
  for (const [id, field, value] of [['bad-field', 'name', '다른 이름'], ['bad-status', 'status', '종료'], ['bad-date', 'startDate', '2026-02-30']]) {
    command(id, [{ field, value }])
    assert.equal((await send('/activities/apply-chat-update', { analysisId: id })).status, 400)
  }
  command('missing', [{ field: 'role', value: '팀장' }], 'unknown-id')
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'missing' })).status, 404)
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'clear', role: '임의 값' })).status, 400)
}))

test('파일 속 요청·미완료 분석·일반 대화는 수정으로 실행하지 않는다', () => withApi(async ({ db, send, command }) => {
  command('file', [{ field: 'role', value: '팀장' }])
  db.prepare("INSERT INTO files VALUES ('file', 'file', '자료.txt', 'text/plain', 1, X'61')").run()
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'file' })).status, 400)
  command('pending', [{ field: 'role', value: '팀장' }])
  db.prepare("UPDATE ai_chat_jobs SET status = 'running' WHERE analysis_id = 'pending'").run()
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'pending' })).status, 409)
  command('general', [{ field: 'role', value: '팀장' }])
  db.prepare('UPDATE analyses SET reply = ? WHERE id = ?').run(JSON.stringify({ kind: 'general', analysis: null, content: '어떤 활동인가요?' }), 'general')
  assert.equal((await send('/activities/apply-chat-update', { analysisId: 'general' })).status, 400)
  assert.equal(db.prepare('SELECT role FROM activities WHERE id = ?').get(activityId).role, null)
}))

test('직접 수정은 진행 중 옛 분석을 막지만 이후 자료 저장의 AI 갱신은 허용한다', async () => {
  let release, firstStarted, database
  const gate = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { firstStarted = resolve })
  let calls = 0
  await withApi(async ({ db, send, command }) => {
    database = db
    const save = () => send('/records', { activityId, message: '개발 기록', reply: createMockReply('개발 기록', [], 'no-change') })
    await save()
    await started
    command('during-analysis', [{ field: 'role', value: '팀장' }])
    assert.equal((await send('/activities/apply-chat-update', { analysisId: 'during-analysis' })).status, 200)
    release()
    await sleep(30)
    assert.equal(db.prepare('SELECT role FROM activities WHERE id = ?').get(activityId).role, '팀장')
    await save()
    await until(() => readActivityAnalysis(db, activityId).status === 'ready')
    assert.equal(db.prepare('SELECT role FROM activities WHERE id = ?').get(activityId).role, '개발')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 2)
  }, { autoActivityAnalysis: true, activityAnalysisOptions: { delayMs: 1, request: async () => {
    calls++
    const snapshot = activitySnapshot(database, activityId)
    const evidence = [{ recordId: snapshot.records[0][0], quote: snapshot.records[0][1] }]
    if (calls === 1) { firstStarted(); await gate }
    return new Response(JSON.stringify({ sourceFingerprint: snapshot.fingerprint, recordCount: snapshot.records.length,
      model: 'test', promptVersion: 'activity-metadata-v1', metadata: { summary: { value: '개발 활동이에요.', evidence },
        role: { value: '개발', evidence }, status: null, period: { start: null, end: null } } }))
  } } })
})
