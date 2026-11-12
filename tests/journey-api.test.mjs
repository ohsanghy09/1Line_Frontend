import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createMockJourney, createEmptyJourney } from './fixtures/journey.mjs'
import { loadFrontend } from './support/frontend.mjs'

test('Journey v2 프론트 HTTP 계약·오류·취소', async t => {
    const originalFetch = globalThis.fetch
    const service = await loadFrontend('src/services/journey.ts')
    const emptyResponse = async (url, init) => {
        assert.equal(url, '/api/journey')
        init.signal.throwIfAborted()
        return Response.json(createEmptyJourney())
    }
    globalThis.fetch = emptyResponse
    try {
        await t.test('미분석·근거 부족·삭제 상태를 새 고정 선택지와 함께 허용한다', async () => {
            for (const state of ['unanalyzed', 'insufficient', 'deleted']) {
                globalThis.fetch = async () => Response.json(createEmptyJourney(state))
                const data = await service.getGrowthJourney()
                assert.deepEqual(data.events, [])
                assert.equal(data.typeOptions.length, 6)
                assert.equal(data.axisOptions.length, 1)
            }
        })
        await t.test('공통 계약의 공개 예시는 허용하고 AI 공급자 응답 자체는 거절한다', () => {
            const example = JSON.parse(readFileSync(new URL('../docs/growth-journey-update/examples/journey-exchange.json', import.meta.url), 'utf8'))
            assert.equal(service.isGrowthJourney(example.publicResponse), true)
            assert.equal(service.isGrowthJourney(example.providerResponse), false)
            assert.equal(service.isGrowthJourney(example.providerResponse.result), false)
        })
        await t.test('동일 월은 안정 정렬하고 원본 배열을 변경하지 않는다', async () => {
            const raw = createMockJourney()
            raw.events.reverse()
            raw.events.forEach(event => { event.occurredAt = '2026-11' })
            const order = raw.events.map(event => event.id)
            globalThis.fetch = async () => ({ ok: true, json: async () => raw })
            const data = await service.getGrowthJourney()
            assert.deepEqual(data.events.map(event => event.id), order)
            assert.deepEqual(raw.events.map(event => event.id), order)
            assert.notEqual(data.events, raw.events)
        })
        await t.test('구형·손상된 버전·유형·근거·비교·전이·출처 응답을 거절한다', async () => {
            const mutations = [
                d => { delete d.schemaVersion },
                d => { d.schemaVersion = 'old' },
                d => { d.criteriaVersion = 'old' },
                d => { delete d.analysis },
                d => { d.analysis.generatedAt = '2026-11-12' },
                d => { d.analysis.generatedAt = '2026-11-12Z' },
                d => { d.analysis.recordCount = -1 },
                d => { d.analysis.promptVersion = 'journey-v5' },
                d => { d.analysis.id = null },
                d => { d.events[0].occurredAt = '2026-00' },
                d => { d.events[0].activity.id = null },
                d => { d.events[1].id = d.events[0].id },
                d => { d.events[0].type = 'legacy' },
                d => { d.events[0].growthAssessments = [] },
                d => { d.events[0].growthAssessments[0].type = 'unknown' },
                d => { d.events[0].growthAssessments.push(structuredClone(d.events[0].growthAssessments[0])) },
                d => { d.events[0].growthAssessments[0].reason = ' ' },
                d => { d.events[0].growthAssessments[0].reason = '😀'.repeat(501) },
                d => { delete d.events[0].growthAssessments[0].comparison },
                d => { d.events[0].growthAssessments[0].comparison = null },
                d => { d.events[0].growthAssessments[0].comparison.beforeEvidence = [] },
                d => { d.events[0].growthAssessments[0].comparison.afterEvidence[0].quote = '전체 근거에 없는 문장' },
                d => { delete d.events[0].growthAssessments[1].transfer },
                d => { d.events[0].growthAssessments[1].transfer.targetActivityId = 'other' },
                d => { d.events[0].growthAssessments[1].transfer.sourceActivity.id = 'activity-01' },
                d => { d.events[0].growthAssessments[1].transfer.sourceActivity.id = 'missing' },
                d => { d.events[0].growthAssessments[0].transfer = structuredClone(d.events[0].growthAssessments[1].transfer) },
                d => { delete d.summary.evidence },
                d => { d.badges[0].icon = '' },
                d => { d.typeOptions[1].label = '잘못된 라벨' },
                d => { d.typeOptions.reverse() },
                d => { d.axisOptions[0].label = '다른 이름' },
                d => { d.axisOptions.push({ value: 'unused', label: '미사용' }) },
                d => { d.axisOptions[1].label = '전체 분야' },
                d => { d.events[0].axis = 'missing' },
                d => { d.evidenceSources.shift() },
                d => { d.evidenceSources.push(structuredClone(d.evidenceSources[0])) },
                d => { d.evidenceSources.push({ recordId: 'unused', activityId: 'unused', activityName: '미사용' }) },
                d => { d.evidenceSources[0].activityId = 'wrong' },
            ]
            for (const [i, mutate] of mutations.entries()) {
                const raw = createMockJourney()
                mutate(raw)
                assert.equal(service.isGrowthJourney(raw), false, 'case ' + i)
                globalThis.fetch = async () => Response.json(raw)
                await assert.rejects(service.getGrowthJourney(), /응답 형식/)
            }
            assert.equal(service.isGrowthJourney(null), false)
            assert.equal(service.isGrowthJourney([]), false)
        })
        await t.test('원문 공백·같은 문장의 양쪽 근거와 코드 포인트 경계를 유지한다', async () => {
            const raw = createMockJourney()
            raw.events[0].growthAssessments[0].reason = '😀'.repeat(500)
            // 원문 검증은 서버 책임이며 프론트는 인용문을 trim하지 않는다.
            raw.events[1].growthAssessments.forEach(a => { a.evidence[0].quote = '  원문 공백  ' })
            raw.badges[0].evidence[0].quote = '  원문 공백  '
            globalThis.fetch = async () => Response.json(raw)
            const data = await service.getGrowthJourney()
            const event = data.events.find(e => e.id === 'interview')
            assert.equal(event.growthAssessments[0].evidence[0].quote, '  원문 공백  ')
        })
        await t.test('등록된 출발 활동은 실제 출처와 맞을 때 허용한다', () => {
            const raw = createMockJourney()
            const assessment = raw.events[0].growthAssessments[1]
            const source = structuredClone(raw.events[1].growthAssessments[0].evidence)
            assessment.transfer.sourceActivity = { id: 'activity-02', name: '사용자 조사' }
            assessment.transfer.sourceEvidence = source
            assessment.evidence.push(...source)
            assert.equal(service.isGrowthJourney(raw), true)
            assessment.transfer.sourceActivity.name = '원문 출처와 다른 활동'
            assert.equal(service.isGrowthJourney(raw), false)
        })
        await t.test('실패를 목 성공으로 숨기지 않고 GET 재조회로 회복한다', async () => {
            globalThis.fetch = async () => Response.json({ error: '조회 실패' }, { status: 500 })
            await assert.rejects(service.getGrowthJourney(), /조회 실패/)
            globalThis.fetch = async () => { throw new TypeError('offline') }
            await assert.rejects(service.getGrowthJourney(), /연결하지 못했어요/)
            globalThis.fetch = emptyResponse
            assert.equal((await service.getGrowthJourney()).analysis.id, null)
        })
        await t.test('취소된 요청과 진행 중 취소를 거절한다', async () => {
            await assert.rejects(service.getGrowthJourney(AbortSignal.abort()), { name: 'AbortError' })
            const controller = new AbortController()
            globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
            })
            const pending = service.getGrowthJourney(controller.signal)
            controller.abort()
            await assert.rejects(pending, { name: 'AbortError' })
        })
        await t.test('사용자의 명시적 분석만 본문 없는 POST로 보낸다', async () => {
            globalThis.fetch = async (url, init) => {
                assert.equal(url, '/api/journey/analyze')
                assert.equal(init.method, 'POST')
                assert.equal(init.body, undefined)
                return Response.json(createMockJourney())
            }
            assert.equal((await service.generateGrowthJourney()).events.length, 3)
            globalThis.fetch = async () => Response.json({})
            await assert.rejects(service.generateGrowthJourney(), /응답 형식/)
        })
    } finally { globalThis.fetch = originalFetch }
})
