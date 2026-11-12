import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockJourney } from './fixtures/journey.mjs'
import { loadFrontend } from './support/frontend.mjs'

const { filterJourneyEvents, groupJourneyEvidence } = await loadFrontend('src/utils/journey.ts')
const ids = items => items.map(item => item.id)

test('복수 유형 카드는 각 유형 필터에서 한 번씩 보이고 다른 판단도 유지한다', () => {
    const events = createMockJourney().events
    assert.deepEqual(ids(filterJourneyEvents(events, 'all', 'all')), ids(events))
    for (const type of ['efficiency_improvement', 'experience_transfer']) {
        const filtered = filterJourneyEvents(events, type, 'all')
        assert.deepEqual(ids(filtered), ['deployment'])
        assert.equal(filtered[0].growthAssessments.length, 2)
    }
    assert.deepEqual(ids(filterJourneyEvents(events, 'capability_expansion', 'all')), ['interview'])
})
test('성장 분야와 유형을 AND 적용하고 일치하지 않으면 빈 목록이다', () => {
    const events = createMockJourney().events
    assert.deepEqual(ids(filterJourneyEvents(events, 'performance_improvement', 'backend')), ['performance'])
    assert.deepEqual(filterJourneyEvents(events, 'efficiency_improvement', 'planning'), [])
    assert.deepEqual(filterJourneyEvents(events, 'unknown', 'all'), [])
    assert.deepEqual(filterJourneyEvents([], 'all', 'all'), [])
})
test('필터·원문 통합은 원본·정렬·각 역할의 근거를 변경하지 않는다', () => {
    const data = createMockJourney()
    const original = JSON.stringify(data)
    const event = data.events[0]
    const grouped = groupJourneyEvidence(event)
    assert.equal(grouped.length, 1)
    assert.equal(grouped[0].quote, event.growthAssessments[0].evidence[0].quote)
    assert.deepEqual(grouped[0].roles, ['효율성', '효율성 · 이전', '효율성 · 이후', '경험 전이', '경험 전이 · 출발 경험', '경험 전이 · 실제 적용'])
    filterJourneyEvents(data.events, 'experience_transfer', 'backend')
    assert.equal(JSON.stringify(data), original)
})
test('같은 인용문이어도 기록 ID가 다르면 별도 출처로 표시한다', () => {
    const event = createMockJourney().events[0]
    event.growthAssessments[0].evidence.push({ ...event.growthAssessments[0].evidence[0], recordId: 'different-record' })
    assert.equal(groupJourneyEvidence(event).length, 2)
})
