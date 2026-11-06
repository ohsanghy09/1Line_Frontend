import assert from 'node:assert/strict'
import test from 'node:test'
import { openDatabase } from '../src/database.js'
import { createApp } from '../src/app.js'
import { createMockJourney } from '../src/mock-journey.js'
import { journeySchema } from '../src/journey.js'

test('Journey HTTP 조회는 독립된 목 응답을 반환하고 기존 DB를 변경하지 않는다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db, { testMockAnalysis: true }).listen(0, '127.0.0.1')
  try {
    await new Promise(resolve => server.once('listening', resolve))
    const snapshot = () => ['activities', 'analyses', 'records', 'files', 'timeline_events', 'analysis_jobs']
      .map(table => db.prepare(`SELECT * FROM ${table}`).all())
    const before = snapshot()
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/journey`)
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.deepEqual(data, createMockJourney())
    assert.equal(data.source, 'mock')
    assert.equal(data.events.length, 5)
    data.events[0].title = '응답 수정'
    const again = await (await fetch(`http://127.0.0.1:${server.address().port}/api/journey`)).json()
    assert.notEqual(again.events[0].title, data.events[0].title)
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
