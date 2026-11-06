import assert from 'node:assert/strict'
import test from 'node:test'
import { openDatabase } from '../src/database.js'
import { createApp } from '../src/app.js'
import { createMockJourney } from '../test-support/journey-fixture.js'
import { journeySchema, readJourney } from '../src/journey.js'

test('Journey HTTP 조회는 미분석 상태를 반환하고 예시를 채우거나 기존 DB를 변경하지 않는다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  try {
    await new Promise(resolve => server.once('listening', resolve))
    const snapshot = () => ['activities', 'analyses', 'records', 'files', 'timeline_events', 'analysis_jobs']
      .map(table => db.prepare(`SELECT * FROM ${table}`).all())
    const before = snapshot()
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/journey`)
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.source, 'api')
    assert.equal(data.events.length, 0)
    assert.equal(data.analysis.id, null)
    assert.equal(data.analysis.currentRecordCount, 0)
    data.summary.title = '응답 수정'
    const again = await (await fetch(`http://127.0.0.1:${server.address().port}/api/journey`)).json()
    assert.notEqual(again.summary.title, data.summary.title)
    assert.deepEqual(snapshot(), before)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})

test('Journey 계약은 빈 결과와 비교 없는 이벤트를 허용한다', () => {
  const data = createMockJourney()
  data.events = []; data.badges = []
  assert.equal(journeySchema.safeParse(data).success, true)
  assert.equal(journeySchema.safeParse(createMockJourney()).success, true)
})

test('이전 고정 분야 저장 결과는 사용하지 않는 분야가 있어도 그대로 조회한다', () => {
  const db = openDatabase(':memory:')
  try {
    const legacy = createMockJourney()
    db.prepare('INSERT INTO journey_analyses VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('legacy', '0'.repeat(64), 5, JSON.stringify(legacy), 'previous-model', 'journey-v2', '2026-11-06T00:00:00Z')
    const result = readJourney(db)
    assert.deepEqual(result.axisOptions, legacy.axisOptions)
    assert.equal(result.events[0].axis, 'planning')
    assert.equal(result.analysis.promptVersion, 'journey-v2')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM journey_analyses').get().n, 1)
  } finally { db.close() }
})

test('Journey 공급자 계약은 잘못된 월·중복 ID·분류·불완전한 비교를 거절한다', () => {
  for (const mutate of [
    data => { data.events[0].occurredAt = '2026-13' },
    data => { data.events[1].id = data.events[0].id },
    data => { data.events[0].type = 'unknown' },
    data => { data.events[0].axis = 'all' },
    data => { data.typeOptions.push(data.typeOptions[0]) },
    data => { data.axisOptions.shift() },
    data => { data.events[0].comparison = { before: '기획', after: '', evidence: [] } },
  ]) {
    const data = createMockJourney(); mutate(data)
    assert.equal(journeySchema.safeParse(data).success, false)
  }
})
