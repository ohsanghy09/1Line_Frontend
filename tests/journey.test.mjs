import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import { createMockJourney } from '../api-server/src/mock-journey.js'

const load = async path => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))).toString('base64')}`)
const { filterJourneyEvents } = await load('../src/utils/journey.ts')
const mockGrowthJourney = createMockJourney()
const events = mockGrowthJourney.events
const ids = result => result.map(event => event.id)

test('전체·성장 유형·성장 분야 조건을 실제 예시 응답에 적용한다', () => {
    assert.deepEqual(ids(filterJourneyEvents(events, 'all', 'all')), ids(events))
    assert.deepEqual(ids(filterJourneyEvents(events, 'ability', 'all')), ['user-centered-planning', 'pm-expansion'])
    assert.deepEqual(ids(filterJourneyEvents(events, 'all', 'technology')), ['data-modeling'])
})

test('유형·분야는 AND이며 일치하지 않는 조합과 빈 자료는 빈 결과다', () => {
    assert.deepEqual(ids(filterJourneyEvents(events, 'achievement', 'technology')), ['data-modeling'])
    assert.deepEqual(filterJourneyEvents(events, 'ability', 'technology'), [])
    assert.deepEqual(filterJourneyEvents(events, 'efficiency', 'all'), [])
    assert.deepEqual(filterJourneyEvents([], 'all', 'all'), [])
})

test('필터 전환은 시간순·이벤트 ID·비교 근거와 원본을 보존한다', () => {
    const before = JSON.stringify(mockGrowthJourney)
    const frozen = Object.freeze(events.map(event => Object.freeze({ ...event })))
    const abilities = filterJourneyEvents(frozen, 'ability', 'planning')
    assert.deepEqual(ids(abilities), ['user-centered-planning', 'pm-expansion'])
    assert.deepEqual(abilities[1].comparison.evidence, ['회의록', '역할분담표'])
    filterJourneyEvents(frozen, 'all', 'technology')
    assert.deepEqual(ids(filterJourneyEvents(frozen, 'all', 'all')), ids(events))
    assert.equal(JSON.stringify(mockGrowthJourney), before)
})
