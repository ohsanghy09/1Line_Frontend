import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFrontend, expectRequests } from './support/frontend.mjs'
import { activity } from './fixtures/archive.mjs'

const service = await loadFrontend('src/services/footprints.ts')
const defaultFilters = { search: '', category: 'all', status: 'all', sort: 'recent' }

test('검색·유형·상태·정렬을 인코딩해 전달하며 서버 결과 순서와 총계를 보존한다', async t => {
    const filters = { search: ' AI 기획 & 자료/이름 ', category: '해커톤', status: '진행 중', sort: 'materials' }
    const query = new URLSearchParams({ q: filters.search, category: filters.category, status: filters.status, sort: filters.sort })
    const items = [activity({ id: 'second', title: '검색어가 제목에 없는 활동' }), activity({ id: 'first', materialsCount: 8 })]
    expectRequests(t, [{ path: `/api/archive/activities?${query}`, data: { items, total: 10, categories: ['해커톤', '연구'] } }])
    const result = await service.searchFootprintActivities(filters)
    assert.deepEqual(result.items.map(item => item.id), ['second', 'first'])
    assert.equal(result.total, 10)
    assert.deepEqual(result.categories, ['해커톤', '연구'])
    assert.equal(result.items[0].updatedAtLabel, '기록 없음')
})

test('기본 목록 요청과 빈 결과를 예시 자료로 채우지 않는다', async t => {
    expectRequests(t, [{ path: '/api/archive/activities?q=&category=all&status=all&sort=recent', data: { items: [], total: 0, categories: [] } }])
    assert.deepEqual(await service.searchFootprintActivities(defaultFilters), { items: [], total: 0, categories: [] })
})

test('잘못된 목록·총계·유형 응답을 거절한다', async t => {
    const valid = { items: [activity()], total: 1, categories: ['프로젝트'] }
    const invalid = [null, [], { ...valid, total: 0 }, { ...valid, items: [{ id: 'broken' }] },
        { ...valid, categories: ['all'] }, { ...valid, categories: ['중복', '중복'] }, { ...valid, categories: [' '] }]
    const path = '/api/archive/activities?q=&category=all&status=all&sort=recent'
    expectRequests(t, invalid.map(data => ({ path, data })))
    for (const _data of invalid) await assert.rejects(service.searchFootprintActivities(defaultFilters), /응답 형식/)
})

test('검색 중 취소를 요청 signal에 전달한다', async t => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
    const controller = new AbortController()
    const pending = service.searchFootprintActivities({ search: '', category: 'all', status: 'all', sort: 'recent' }, controller.signal)
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
})
