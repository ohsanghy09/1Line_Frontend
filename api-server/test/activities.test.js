import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../test-support/app.js'
import { createMockReply } from '../test-support/mock-reply.js'
import { replySchema } from '../src/validation.js'

const unknown = { category: null, status: null, role: null, period: null, summary: null }
const proposed = { name: '새로운 컴퓨터비전 연구', category: '프로젝트', status: '진행 중', role: null,
  period: { start: '2026-09', end: null }, summary: '영상 분류 모델을 연구하는 활동' }

async function withServer(work) {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const send = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  try { await work({ db, send, base }) } finally { await new Promise(resolve => server.close(resolve)); db.close() }
}

test('활동 제안 계약은 기존/신규/미확인·null·기간을 검사하고 이전 응답도 읽는다', () => {
  const reply = createMockReply('실제 입력', [], 'no-change')
  const candidate = { ...proposed, id: null, match: 'new', confidence: null }
  const parse = activity => replySchema.safeParse({ ...reply, analysis: { ...reply.analysis, activity } }).success
  assert.equal(parse(candidate), true)
  assert.equal(parse({ name: '이전 응답', confidence: null }), true)
  assert.equal(parse({ ...candidate, match: 'existing' }), false)
  assert.equal(parse({ ...candidate, id: 'existing-id' }), false)
  assert.equal(parse({ ...candidate, status: '시작함' }), false)
  assert.equal(parse({ ...candidate, period: { start: '2026-02-30', end: null } }), false)
  assert.equal(parse({ ...candidate, period: { start: '2026-11', end: '2026-09' } }), false)
  assert.equal(parse({ ...candidate, period: { start: '2026-11-12', end: '2026-11-10' } }), false)
})

test('초안 후보는 활동을 만들지 않으며 확인한 새 활동과 기록만 함께 저장한다', () => withServer(async ({ db, send, base }) => {
  const form = new FormData()
  form.set('message', '영상 분류 모델을 연구하고 있다.')
  const draft = await (await fetch(base + '/chat', { method: 'POST', body: form })).json()
  assert.equal(draft.reply.analysis.activity.match, 'existing')
  assert.equal(draft.reply.analysis.activity.id, 'line1-hackathon')
  assert.equal(draft.reply.analysis.activity.role, null)
  // 미래 공급자의 응답을 저장한 상황을 재현한다. AI 호출이나 입력 파싱을 수행한 것은 아니다.
  const reply = replySchema.parse({ ...draft.reply, analysis: { ...draft.reply.analysis,
    activity: { ...proposed, match: 'new', id: null, confidence: 'medium' } } })
  db.prepare('UPDATE analyses SET reply = ? WHERE id = ?').run(JSON.stringify(reply), draft.analysisId)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 5)
  assert.equal((await send('/records', { analysisId: draft.analysisId })).status, 400)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0)

  const result = await send('/records', { analysisId: draft.analysisId, newActivity: { ...proposed, role: '모델 개발' } })
  assert.equal(result.status, 201)
  assert.equal(result.data.reply.analysis.activity.match, 'existing')
  assert.equal(result.data.reply.analysis.activity.id, result.data.activityId)
  assert.equal(result.data.reply.analysis.activity.role, '모델 개발')
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(result.data.activityId)
  assert.equal(row.start_date, '2026-09')
  assert.equal(row.end_date, null)
  const archive = await (await fetch(base + `/archive/activities/${row.id}`)).json()
  assert.equal(archive.materialsCount, 1)
  assert.equal(archive.role, '모델 개발')
  assert.equal(archive.period, '2026-09 ~ ')
  assert.deepEqual(archive.timeline, [])
  assert.equal((await send('/records', { analysisId: draft.analysisId, newActivity: proposed })).status, 409)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 6)
  assert.equal((await send('/records', { reply, newActivity: proposed })).status, 409)
}))

test('기존 활동은 제안만으로 변경하지 않으며 확인한 값만 적용하고 null은 보존한다', () => withServer(async ({ db, send }) => {
  db.prepare('UPDATE activities SET role = ?, status = ?, start_date = ?, end_date = ?, period = ? WHERE id = ?')
    .run('기존 역할', '완료', '2026-01', '2026-10', '2026-01 ~ 2026-10', 'line1-hackathon')
  const reply = createMockReply('기록', [], 'no-change')
  reply.analysis.activity = { ...proposed, name: '1호선톤', id: 'line1-hackathon', match: 'existing', confidence: null }
  const saved = await send('/records', { activityId: 'line1-hackathon', reply })
  assert.equal(saved.status, 201)
  assert.equal(saved.data.reply.analysis.activity.role, '기존 역할')
  assert.equal(saved.data.reply.analysis.activity.status, '완료')
  assert.equal(saved.data.reply.analysis.activity.category, null)

  const updated = await send(`/records/${saved.data.id}`, { activityUpdates: { ...unknown, category: '연구', period: { start: '2026-02', end: null } } }, 'PATCH')
  assert.equal(updated.status, 200)
  assert.equal(updated.data.reply.analysis.activity.category, '연구')
  assert.equal(updated.data.reply.analysis.activity.role, '기존 역할')
  assert.deepEqual(updated.data.reply.analysis.activity.period, { start: '2026-02', end: '2026-10' })
  // 기존 종료일과 충돌하는 부분 제안은 전체 트랜잭션을 취소한다.
  const invalid = await send(`/records/${saved.data.id}`, { activityUpdates: { ...unknown, category: '덮어쓰면 안 됨', period: { start: '2027-01', end: null } } }, 'PATCH')
  assert.equal(invalid.status, 400)
  assert.equal(db.prepare('SELECT category FROM activities WHERE id = ?').get('line1-hackathon').category, '연구')
}))

test('기록 저장 실패 시 새 활동 생성도 롤백하고 잘못된 선택은 거절한다', () => withServer(async ({ db, send }) => {
  const reply = createMockReply('기록', [], 'no-change')
  assert.equal((await send('/records', { activityId: 'line1-hackathon', newActivity: proposed, reply })).status, 400)
  assert.equal((await send('/records', { newActivity: { ...proposed, period: { start: '2026-12', end: '2026-01' } }, reply })).status, 400)
  // DB 실패를 강제로 발생시켜 새 활동만 남는 부분 저장을 막는지 확인한다.
  db.exec("CREATE TRIGGER reject_record BEFORE INSERT ON records BEGIN SELECT RAISE(ABORT, 'test failure'); END")
  const originalError = console.error
  console.error = () => {}
  try {
    assert.equal((await send('/records', { newActivity: proposed, reply })).status, 500)
  } finally { console.error = originalError }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 5)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0)
}))
