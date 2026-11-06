import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../src/app.js'
import { journeySnapshot } from '../src/journey-context.js'
import { createMockReply } from '../test-support/mock-reply.js'

test('실제 성장 분석 경계: 확정 기록·저장·오래된 결과·근거 검증·실패 보존·중복 실행', async t => {
  const db = openDatabase(':memory:')
  let calls = 0, behavior = () => ({ status: 200, body: output() })
  const provider = createServer(async (_req, res) => {
    calls++
    const { status, body } = await behavior()
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }).listen(0, '127.0.0.1')
  await new Promise(resolve => provider.once('listening', resolve))
  const api = createApp(db, { aiBaseUrl: `http://127.0.0.1:${provider.address().port}` }).listen(0, '127.0.0.1')
  await new Promise(resolve => api.once('listening', resolve))
  const base = `http://127.0.0.1:${api.address().port}/api/journey`
  const post = () => fetch(`${base}/analyze`, { method: 'POST' })
  const get = async () => (await fetch(base)).json()
  const refs = [{ recordId: 'record-1', quote: '기능 6개를 기획했습니다.' }]
  function output() {
    return {
      sourceFingerprint: journeySnapshot(db).fingerprint, recordCount: 1, model: 'test-provider', promptVersion: 'journey-v3',
      result: { source: 'api', summary: { title: '기획 기록', description: '성장 판단 근거가 부족합니다.', evidence: refs }, badges: [],
        typeOptions: [{ value: 'all', label: '전체' }, { value: 'scope-design', label: '기획 범위 설계', icon: '🧭' }],
        axisOptions: [{ value: 'all', label: '전체 분야' }, { value: 'product-design', label: '서비스 디자인' }],
        events: [{ id: 'model-id', occurredAt: '2026-11', activity: { id: 'line1-hackathon', name: '모델이 바꾼 이름' },
          type: 'scope-design', axis: 'product-design', title: '기획 경험', description: '기획을 수행함.', evidence: refs }],
      },
    }
  }
  try {
    await t.test('기록 없는 기본 활동은 분석 대상이 아니며 유료 요청을 보내지 않는다', async () => {
      assert.equal((await post()).status, 422)
      assert.equal(calls, 0)
      assert.deepEqual((await get()).events, [])
    })
    const now = '2026-11-06T00:00:00.000Z'
    const reply = createMockReply('기능 6개를 기획했습니다.', [], 'no-change')
    db.prepare('INSERT INTO records VALUES (?, ?, NULL, ?, ?, ?, ?)').run(
      'record-1', 'line1-hackathon', '기능 6개를 기획했습니다.', JSON.stringify(reply), now, now)
    await t.test('분석 결과만 별도 저장하고 GET은 재호출하지 않으며 ID·활동명을 서버가 확정한다', async () => {
      const response = await post()
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.analysis.stale, false)
      assert.equal(result.analysis.recordCount, 1)
      assert.equal(result.events[0].axis, 'product-design')
      assert.equal(result.axisOptions[1].label, '서비스 디자인')
      assert.equal(result.events[0].activity.name, '1호선톤')
      assert.notEqual(result.events[0].id, 'model-id')
      assert.equal(result.events[0].type, 'scope-design')
      assert.equal(result.typeOptions[1].icon, '🧭')
      assert.equal(calls, 1)
      assert.deepEqual(await get(), result)
      assert.equal(calls, 1)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 1)
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM timeline_events').get().n, 0)
    })
    const savedId = (await get()).analysis.id
    await t.test('기록이 없던 활동을 추가해도 분석은 오래되지 않는다', async () => {
      db.prepare('INSERT INTO activities (id, name) VALUES (?, ?)').run('empty', '기록 없는 활동')
      assert.equal((await get()).analysis.stale, false)
    })
    await t.test('근거 위조·없는 활동·날짜 위조를 거절하고 기존 결과를 보존한다', async () => {
      for (const mutate of [
        data => { data.result.events[0].evidence = [{ recordId: 'missing', quote: '없는 기록' }] },
        data => { data.result.summary.evidence = [{ recordId: 'record-1', quote: '없는 인용문' }] },
        data => { data.result.events[0].activity.id = 'computer-vision' },
        data => { data.result.events[0].occurredAt = '2020-01' },
        data => { delete data.result.typeOptions[1].icon },
        data => { data.result.typeOptions.push({ value: 'unused', label: '사용하지 않는 분류', icon: '📝' }) },
        data => { data.result.events[0].axis = 'missing' },
        data => { data.result.axisOptions.push({ value: 'unused', label: '사용하지 않는 분야' }) },
        data => { data.result.axisOptions[1].label = '전체 분야' },
        data => {
          data.result.axisOptions.push({ value: 'duplicate-label', label: ' 서비스 디자인 ' })
          data.result.events.push({ ...data.result.events[0], id: 'different-id', axis: 'duplicate-label' })
        },
        data => { data.result.events[0].comparison = { before: '기획', after: 'PM', evidence: [] } },
      ]) {
        behavior = () => { const body = output(); mutate(body); return { status: 200, body } }
        assert.equal((await post()).status, 502)
        assert.equal((await get()).analysis.id, savedId)
      }
    })
    await t.test('분석 중 기록 수정 시 저장하지 않으며 이전 결과에 갱신 필요를 표시한다', async () => {
      behavior = () => {
        const body = output()
        db.prepare("UPDATE records SET updated_at = '2026-11-07T00:00:00Z' WHERE id = 'record-1'").run()
        return { status: 200, body }
      }
      assert.equal((await post()).status, 409)
      assert.equal((await get()).analysis.id, savedId)
      assert.equal((await get()).analysis.stale, true)
    })
    await t.test('같은 서버의 동시 분석은 하나만 접수하고 실패 후 다시 실행할 수 있다', async () => {
      let release, started
      const notified = new Promise(resolve => { started = resolve })
      behavior = () => new Promise(resolve => { release = () => resolve({ status: 503, body: { error: '설정 확인 필요' } }); started() })
      const pending = post()
      await notified
      assert.equal((await post()).status, 409)
      release()
      assert.equal((await pending).status, 503)
      assert.equal((await get()).analysis.id, savedId)
      behavior = () => { const body = output(); body.result.events = []; body.result.typeOptions = [{ value: 'all', label: '전체' }]; body.result.axisOptions = [{ value: 'all', label: '전체 분야' }]; return { status: 200, body } }
      assert.equal((await post()).status, 200)
      assert.deepEqual((await get()).events, [])
      assert.equal((await get()).analysis.stale, false)
    })
  } finally {
    await new Promise(resolve => api.close(resolve))
    await new Promise(resolve => provider.close(resolve))
    db.close()
  }
})
