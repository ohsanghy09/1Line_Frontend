import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const root = new URL('../../', import.meta.url)
const modules = new Map()

// 실제 프론트 모듈을 읽는다. 타입 import는 제거하고 상대 경로 의존성도 함께 변환한다.
function moduleUrl(file) {
    if (modules.has(file.href)) return modules.get(file.href)
    const code = stripTypeScriptTypes(readFileSync(file, 'utf8')).replace(
        /from ['"](\.[^'"]+)['"]/g,
        (_match, path) => `from '${moduleUrl(new URL(`${path}.ts`, file))}'`,
    )
    const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    modules.set(file.href, url)
    return url
}

export const loadFrontend = path => import(moduleUrl(new URL(path, root)))

// 지정하지 않은 호출과 호출 누락을 모두 실패시킨다. 서버 저장·검색 로직은 구현하지 않는다.
export function expectRequests(t, steps) {
    const originalFetch = globalThis.fetch
    let index = 0
    globalThis.fetch = async (url, init = {}) => {
        init.signal?.throwIfAborted()
        const step = steps[index++]
        assert.ok(step, `예상하지 않은 요청: ${url}`)
        assert.equal(String(url), step.path)
        assert.equal(init.method ?? 'GET', step.method ?? 'GET')
        await step.check?.(init)
        if (step.error) throw step.error
        return Response.json(step.data, { status: step.status ?? 200 })
    }
    t.after(() => {
        globalThis.fetch = originalFetch
        assert.equal(index, steps.length, '예정된 API 요청을 모두 실행해야 한다')
    })
}
