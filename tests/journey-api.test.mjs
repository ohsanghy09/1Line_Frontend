import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockJourney } from './fixtures/journey.mjs'
import { loadFrontend } from './support/frontend.mjs'

test('Journey 프론트 서비스의 HTTP 계약·오류·취소', async t => {
    const originalFetch = globalThis.fetch
    const empty = createMockJourney()
    empty.events = []; empty.badges = []
    empty.analysis = { id: null, generatedAt: null, stale: false, recordCount: 0, currentRecordCount: 0, model: null, promptVersion: null }
    const emptyResponse = async (url, init) => {
        assert.equal(url, '/api/journey')
        init.signal.throwIfAborted()
        return Response.json(empty)
    }
    globalThis.fetch = emptyResponse
    try {
        const service = await loadFrontend('src/services/journey.ts')
        const { filterJourneyEvents } = await loadFrontend('src/utils/journey.ts')
        await t.test('미분석 응답의 빈 목록을 유지하며 예시를 채우지 않는다', async () => {
            const data = await service.getGrowthJourney()
            assert.equal(data.source, 'api')
            assert.deepEqual(data.events, [])
            assert.equal(data.analysis.id, null)
            assert.equal(data.analysis.currentRecordCount, 0)
            assert.equal(filterJourneyEvents(data.events, 'ability', 'planning').length, 0)
        })
        await t.test('빈 응답 허용·안정 정렬·원본 배열 보존', async () => {
            const raw = createMockJourney()
            raw.events.reverse()
            raw.events[1].occurredAt = raw.events[0].occurredAt
            const order = raw.events.map(event => event.id)
            globalThis.fetch = async () => ({ ok: true, json: async () => raw })
            const sorted = await service.getGrowthJourney()
            assert.deepEqual(sorted.events.slice(-2).map(event => event.id), order.slice(0, 2))
            assert.deepEqual(raw.events.map(event => event.id), order)
            const empty = createMockJourney(); empty.events = []; empty.badges = []
            globalThis.fetch = async () => Response.json(empty)
            assert.deepEqual((await service.getGrowthJourney()).events, [])
        })
        await t.test('손상된 응답·잘못된 월·중복 ID·선택지와 비교를 거절한다', async () => {
            for (const mutate of [
                data => { data.source = 'unknown' },
                data => { data.events[0].occurredAt = '2026-00' },
                data => { data.events[0].activity.id = 1 },
                data => { data.events[1].id = data.events[0].id },
                data => { data.events[0].type = 'unknown' },
                data => { data.typeOptions[1].icon = 123 },
                data => { data.badges[0].icon = '' },
                data => { data.axisOptions.shift() },
                data => { data.events[0].comparison = null },
                data => { data.events[0].comparison = { before: '', after: 'PM', evidence: [] } },
            ]) {
                const raw = createMockJourney(); mutate(raw)
                globalThis.fetch = async () => Response.json(raw)
                await assert.rejects(service.getGrowthJourney(), /응답 형식/)
            }
            globalThis.fetch = async () => Response.json(null)
            await assert.rejects(service.getGrowthJourney(), /응답 형식/)
        })
        await t.test('고정 목록 밖의 성장 유형·분야로 AND 필터링하고 이전 무아이콘 응답도 읽는다', async () => {
            const raw = createMockJourney()
            raw.typeOptions = [{ value: 'all', label: '전체' }, { value: 'scope-design', label: '기획 범위 설계', icon: '🧭' }]
            raw.axisOptions = [{ value: 'all', label: '전체 분야' }, { value: 'education', label: '교육' }]
            raw.events = [{ ...raw.events[0], type: 'scope-design', axis: 'education' }]
            raw.badges[0] = { ...raw.badges[0], label: '기록상 첫 기획', icon: '🌱' }
            globalThis.fetch = async () => Response.json(raw)
            const data = await service.getGrowthJourney()
            assert.equal(data.typeOptions[1].icon, '🧭')
            assert.equal(data.badges[0].icon, '🌱')
            assert.equal(filterJourneyEvents(data.events, 'scope-design', 'all').length, 1)
            assert.equal(data.axisOptions[1].label, '교육')
            assert.equal(filterJourneyEvents(data.events, 'scope-design', 'education').length, 1)
            assert.equal(filterJourneyEvents(data.events, 'scope-design', 'planning').length, 0)
            delete raw.typeOptions[1].icon
            globalThis.fetch = async () => Response.json(raw)
            assert.equal((await service.getGrowthJourney()).events[0].type, 'scope-design')
        })
        await t.test('서버 오류·연결 실패를 목 성공으로 숨기지 않고 재호출로 회복한다', async () => {
            globalThis.fetch = async () => Response.json({ error: '조회 실패' }, { status: 500 })
            await assert.rejects(service.getGrowthJourney(), /조회 실패/)
            globalThis.fetch = async () => { throw new TypeError('offline') }
            await assert.rejects(service.getGrowthJourney(), /연결하지 못했어요/)
            globalThis.fetch = emptyResponse
            assert.equal((await service.getGrowthJourney()).events.length, 0)
        })
        await t.test('이미 취소됐거나 진행 중 취소된 요청을 거절한다', async () => {
            await assert.rejects(service.getGrowthJourney(AbortSignal.abort()), { name: 'AbortError' })
            const controller = new AbortController()
            globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
                init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
            })
            const pending = service.getGrowthJourney(controller.signal)
            controller.abort()
            await assert.rejects(pending, { name: 'AbortError' })
        })
        await t.test('명시적 재분석만 POST로 보내고 응답 형식을 검증한다', async () => {
            globalThis.fetch = async (url, init) => {
                assert.equal(url, '/api/journey/analyze')
                assert.equal(init.method, 'POST')
                return Response.json(createMockJourney())
            }
            assert.equal((await service.generateGrowthJourney()).events.length, 5)
            globalThis.fetch = async () => Response.json({})
            await assert.rejects(service.generateGrowthJourney(), /응답 형식/)
        })
    } finally { globalThis.fetch = originalFetch }
})
