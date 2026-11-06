import assert from 'node:assert/strict'
import test from 'node:test'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../src/app.js'
import { createMockReply } from '../test-support/mock-reply.js'
import { activitySnapshot, readActivityAnalysis } from '../src/activity-metadata.js'

const id = 'line1-hackathon'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await sleep(10) }
  assert.fail('활동 분석 대기 시간 초과')
}
function output(db, activityId = id) {
  const snapshot = activitySnapshot(db, activityId)
  const ref = [{ recordId: snapshot.records[0][0], quote: snapshot.records[0][1] }]
  return { sourceFingerprint: snapshot.fingerprint, recordCount: snapshot.records.length,
    model: 'test-model', promptVersion: 'activity-metadata-v1', metadata: {
      summary: { value: `자료 ${snapshot.records.length}개를 종합했어요.`, evidence: ref },
      role: { value: '개발', evidence: ref }, status: { value: '진행 중', evidence: ref },
      period: { start: { value: '2026-01', evidence: ref }, end: null },
    } }
}
async function withApi(work, { delayMs = 5, provider } = {}) {
  const db = openDatabase(':memory:')
  let calls = 0
  const app = createApp(db, { autoActivityAnalysis: true, activityAnalysisOptions: {
    delayMs, request: async url => {
      calls++
      const result = output(db, decodeURIComponent(url.split('/').at(-1)))
      return new Response(JSON.stringify(provider ? await provider(result, calls, db) : result))
    },
  } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const send = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, data: await response.json() }
  }
  const save = async (message = '2026년 1월부터 개발을 담당하며 진행 중이에요.') => send('/records', {
    activityId: id, message, reply: createMockReply(message, [], 'no-change'),
  })
  try { await work({ db, save, send, base, calls: () => calls }) }
  finally { await app.locals.activityMetadata.close(); await new Promise(resolve => server.close(resolve)); db.close() }
}

test('기록 저장 후 활동 정보를 자동 종합하고 조회에서는 재분석하지 않는다', () => withApi(async ({ db, save, send, base, calls }) => {
  const saved = await save()
  assert.equal(saved.status, 201)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1)
  await until(() => readActivityAnalysis(db, id).status === 'ready')
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(id)
  assert.equal(row.summary, '자료 1개를 종합했어요.')
  assert.equal(row.role, '개발')
  assert.equal(row.status, '진행 중')
  assert.equal(row.start_date, '2026-01')
  assert.equal(row.end_date, null)
  assert.equal(readActivityAnalysis(db, id).stale, false)
  const detail = await (await fetch(base + `/archive/activities/${id}`)).json()
  assert.equal(detail.summary, row.summary)
  assert.equal(detail.metadataAnalysis.status, 'ready')
  await fetch(base + `/activities/${id}/analysis`)
  assert.equal(calls(), 1)
  assert.equal((await send(`/activities/missing/analyze`)).status, 404)
}))

test('연속 저장은 묶고 분석 중 추가 기록의 오래된 결과는 버린 뒤 최신 입력만 적용한다', async () => {
  let release
  let firstStarted
  const started = new Promise(resolve => { firstStarted = resolve })
  const gate = new Promise(resolve => { release = resolve })
  await withApi(async ({ db, save, calls, send }) => {
    await save()
    await started
    await save('추가 자료도 개발 작업 기록이에요.')
    assert.equal((await send('/settings/reset-data', { confirmation: '전체 삭제' })).status, 409)
    release()
    await until(() => readActivityAnalysis(db, id).status === 'ready')
    assert.equal(db.prepare('SELECT summary FROM activities WHERE id = ?').get(id).summary, '자료 2개를 종합했어요.')
    assert.equal(calls(), 2)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 2)
  }, { provider: async (result, count) => { if (count === 1) { firstStarted(); await gate } return result } })
  await withApi(async ({ db, save, calls }) => {
    await save(); await save(); await save()
    await until(() => readActivityAnalysis(db, id).status === 'ready')
    assert.equal(calls(), 1)
    assert.equal(db.prepare('SELECT summary FROM activities WHERE id = ?').get(id).summary, '자료 3개를 종합했어요.')
  }, { delayMs: 100 })
})

test('잘못된 근거·날짜 응답은 기존 정보를 보존하고 수동 재시도에서만 복구한다', () => withApi(async ({ db, save, send, calls }) => {
  db.prepare('UPDATE activities SET summary = ?, role = ?, status = ?, start_date = ? WHERE id = ?').run('기존 요약', '기존 역할', '완료', '2025-01', id)
  await save()
  await until(() => readActivityAnalysis(db, id).status === 'failed')
  assert.equal(db.prepare('SELECT summary FROM activities WHERE id = ?').get(id).summary, '기존 요약')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1)
  await sleep(50)
  assert.equal(calls(), 1)
  assert.equal((await send(`/activities/${id}/analyze`)).status, 202)
  await until(() => readActivityAnalysis(db, id).status === 'ready')
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(id)
  assert.equal(row.summary, '자료 1개를 종합했어요.')
  assert.equal(row.role, '기존 역할')
  assert.equal(row.status, '완료')
  assert.equal(row.start_date, '2025-01')
}, { provider: async (result, count) => {
  if (count === 1) result.metadata.summary.evidence[0].quote = '실제 기록에 없는 위조 근거'
  else { result.metadata.role = null; result.metadata.status = null; result.metadata.period.start = null }
  return result
} }))

test('기록 이동은 두 활동을 갱신하고 기록이 없는 활동은 AI를 호출하지 않는다', () => withApi(async ({ db, save, send, calls }) => {
  const saved = await save()
  await until(() => readActivityAnalysis(db, id).status === 'ready')
  await send(`/records/${saved.data.id}`, { activityId: 'computer-vision' }, 'PATCH')
  await until(() => readActivityAnalysis(db, 'computer-vision').status === 'ready' && readActivityAnalysis(db, id).status === 'idle')
  assert.equal(db.prepare('SELECT summary FROM activities WHERE id = ?').get(id).summary, null)
  assert.equal(calls(), 2)
  assert.equal((await send(`/activities/${id}/analyze`)).status, 422)
}))

for (const kind of ['invalid-date', 'fingerprint', 'network']) {
  test(`${kind} 오류에도 확정 기록과 기존 활동 정보는 보존한다`, () => withApi(async ({ db, save, calls }) => {
    db.prepare('UPDATE activities SET summary = ? WHERE id = ?').run('보존할 요약', id)
    await save()
    await until(() => readActivityAnalysis(db, id).status === 'failed')
    assert.equal(db.prepare('SELECT summary FROM activities WHERE id = ?').get(id).summary, '보존할 요약')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1)
    await sleep(25)
    assert.equal(calls(), 1)
  }, { provider: async result => {
    if (kind === 'invalid-date') result.metadata.period.start.value = '2026-02-30'
    if (kind === 'fingerprint') result.sourceFingerprint = 'invalid'
    if (kind === 'network') throw new Error('test network failure')
    return result
  } }))
}

test('서버 재시작은 중단된 분석을 실패로 표시하고 자동 유료 재시도를 하지 않는다', async () => {
  const db = openDatabase(':memory:')
  db.prepare("UPDATE activities SET metadata_status = 'running', summary = '보존할 요약' WHERE id = ?").run(id)
  let called = false
  const app = createApp(db, { activityAnalysisOptions: { request: () => { called = true; throw new Error('must not call') } } })
  assert.equal(readActivityAnalysis(db, id).status, 'failed')
  assert.equal(db.prepare('SELECT summary FROM activities WHERE id = ?').get(id).summary, '보존할 요약')
  assert.equal(called, false)
  await app.locals.activityMetadata.close()
  db.close()
})

test('분석 접수 자체가 실패해도 자료 저장 성공을 반환하고 작업 잠금을 남기지 않는다', () => withApi(async ({ db, save, calls, send }) => {
  db.exec("CREATE TRIGGER fail_queue BEFORE UPDATE OF metadata_status ON activities WHEN NEW.metadata_status = 'queued' BEGIN SELECT RAISE(ABORT, 'test queue failure'); END")
  const saved = await save()
  assert.equal(saved.status, 201)
  assert.equal(readActivityAnalysis(db, id).status, 'failed')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1)
  assert.equal(calls(), 0)
  db.exec('DROP TRIGGER fail_queue')
  assert.equal((await send('/settings/reset-data', { confirmation: '전체 삭제' })).status, 200)
}))
