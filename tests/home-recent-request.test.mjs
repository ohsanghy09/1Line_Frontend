import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

// 실제 hook의 Effect를 분리 실행해 요청 경쟁·취소를 검사한다. React 렌더링·DOM 검사는 아니다.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/hooks/useHomeRecent.ts', import.meta.url), 'utf8'))
    .replace(/^import .* from .*\r?\n/gm, '').replace('export function useHomeRecent', 'function useHomeRecent')

function harness(t) {
    const window = new EventTarget()
    const requests = [], states = []
    let effect, cleanup, stateSlot = 0
    const useState = initial => {
        const slot = stateSlot++
        return [initial, next => { if (slot === 0) states.push(next) }]
    }
    const getHomeRecent = signal => new Promise((resolve, reject) => requests.push({ signal, resolve, reject }))
    // hook와 서비스 경계만 대역으로 주입하고 요청 관리 코드는 원본 그대로 실행한다.
    const runHook = new Function('useEffect', 'useRef', 'useState', 'getHomeRecent', 'window',
        `${source}; return useHomeRecent`)(setup => { effect = setup }, initial => ({ current: initial }), useState, getHomeRecent, window)
    runHook()
    t.after(() => cleanup?.())
    return {
        requests, states,
        mount: () => { cleanup = effect() },
        unmount: () => { cleanup?.(); cleanup = undefined },
        refresh: () => window.dispatchEvent(new Event('1line:activities-changed')),
    }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('최근 목록은 연속 갱신 시 이전 요청을 취소하고 늦은 성공·실패를 무시한다', async t => {
    const h = harness(t)
    h.mount(); h.refresh(); h.refresh()
    assert.equal(h.requests.length, 3)
    assert.equal(h.requests[0].signal.aborted, true)
    assert.equal(h.requests[1].signal.aborted, true)
    const latest = { activities: [{ id: 'latest' }], records: [] }
    h.requests[2].resolve(latest)
    await settle()
    assert.deepEqual(h.states.at(-1), { data: latest, loading: false, error: '' })
    const count = h.states.length
    // 네트워크 대역이 abort를 무시해도 UI 상태를 변경하면 안 된다.
    h.requests[0].resolve({ activities: [{ id: 'stale' }], records: [] })
    h.requests[1].reject(new Error('늦은 오류'))
    await settle()
    assert.equal(h.states.length, count)
})

test('Effect 해제 후 응답·이벤트를 무시하고 재설정 때 새 요청으로 복원한다', async t => {
    const h = harness(t)
    h.mount(); h.unmount()
    assert.equal(h.requests[0].signal.aborted, true)
    h.refresh()
    assert.equal(h.requests.length, 1)
    const count = h.states.length
    h.requests[0].resolve({ activities: [], records: [] })
    await settle()
    assert.equal(h.states.length, count)
    // StrictMode와 같은 setup → cleanup → setup 수명에서 새 요청이 살아 있어야 한다.
    h.mount()
    assert.equal(h.requests[1].signal.aborted, false)
    h.requests[1].resolve({ activities: [], records: [] })
    await settle()
    assert.deepEqual(h.states.at(-1), { data: { activities: [], records: [] }, loading: false, error: '' })
})

test('현재 요청 오류를 표시한 뒤 갱신으로 오류를 지우고 회복한다', async t => {
    const h = harness(t)
    h.mount()
    h.requests[0].reject(new Error('조회 실패'))
    await settle()
    assert.deepEqual(h.states.at(-1), { data: null, loading: false, error: '조회 실패' })
    h.refresh()
    assert.deepEqual(h.states.at(-1), { data: null, loading: true, error: '' })
    h.requests[1].resolve({ activities: [], records: [] })
    await settle()
    assert.equal(h.states.at(-1).error, '')
    assert.equal(h.states.at(-1).loading, false)
})
