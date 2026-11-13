import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { buildSwagger } from '../scripts/build-swagger.mjs'

const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
const methods = new Set(['get', 'post', 'put', 'patch', 'delete'])

for (const name of ['backend', 'ai']) {
    test(name + ' 명세의 공개 API가 handoff와 일치하고 내부 API에는 인증이 적용된다', async () => {
        const document = JSON.parse(await read('docs/frontend-integration/openapi/' + name + '.openapi.json'))
        const handoff = await read('docs/' + name + '/handoff/API_정의서.md')
        const publicSection = name === 'backend'
            ? handoff.split('## 현재 프론트 요청 전체 목록')[1].split('### 저장 입력')[0]
            : handoff.split('## 공개 홈 API')[1].split('multipart의')[0]
        const documented = [...publicSection.matchAll(/^\| (GET|POST|PATCH|DELETE) (\/\S+) \|/gm)]
            .map(([, method, path]) => method + ' ' + path.replace(/:([A-Za-z]+)/g, '{$1}')).sort()
        const actual = []
        const internal = []
        const operationIds = new Set()
        for (const [path, operations] of Object.entries(document.paths)) {
            for (const [method, operation] of Object.entries(operations)) {
                assert.ok(methods.has(method))
                assert.ok(!operationIds.has(operation.operationId))
                operationIds.add(operation.operationId)
                const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort()
                const parameters = (operation.parameters ?? []).filter(parameter => parameter.in === 'path')
                assert.deepEqual(parameters.map(parameter => parameter.name).sort(), placeholders)
                assert.ok(parameters.every(parameter => parameter.required === true))
                assert.ok(Object.keys(operation.responses).some(status => /^2\d\d$/.test(status)))
                if (operation['x-audience'] === 'frontend') {
                    actual.push(method.toUpperCase() + ' ' + path)
                    assert.deepEqual(operation.security ?? document.security, [])
                } else {
                    assert.equal(operation['x-audience'], 'server')
                    internal.push(method.toUpperCase() + ' ' + path)
                    assert.deepEqual(operation.security, [{ InternalServiceToken: [] }])
                    assert.ok(operation.responses['401'])
                    assert.ok(operation.responses['403'])
                    assert.ok(operation.servers.every(server => server.url.includes('-internal.example.org/api')))
                }
            }
        }
        assert.equal(documented.length, name === 'backend' ? 16 : 4)
        assert.deepEqual(actual.sort(), documented)
        assert.deepEqual(internal.sort(), name === 'backend'
            ? ['GET /internal/chat-jobs/{jobId}', 'GET /internal/home-context', 'PUT /internal/chat-jobs/{jobId}']
            : ['POST /analyze/activities/{activityId}', 'POST /analyze/journey', 'POST /analyze/records/{recordId}/exclude-file'])

        function checkReferences(value) {
            if (!value || typeof value !== 'object') return
            if (value.$ref) {
                assert.ok(value.$ref.startsWith('#/components/schemas/'))
                assert.ok(document.components.schemas[value.$ref.split('/').at(-1)], value.$ref)
            }
            for (const child of Object.values(value)) checkReferences(child)
        }
        checkReferences(document)
        for (const source of document['x-handoff-sources']) await read(source)
        assert.equal(document.openapi, '3.1.0')
        assert.ok(document.servers.every(server => server.url.startsWith('https://') && server.url.endsWith('/api')))
    })
}

test('저장·분석 필수 필드와 상태별 생략 규칙을 명시한다', async () => {
    const backend = JSON.parse(await read('docs/frontend-integration/openapi/backend.openapi.json'))
    const ai = JSON.parse(await read('docs/frontend-integration/openapi/ai.openapi.json'))
    assert.ok(backend.components.schemas.SaveInput.required.includes('analysisId'))
    assert.equal(backend.components.schemas.SaveInput.additionalProperties, false)
    assert.equal(backend.components.schemas.SaveInput.properties.reply, undefined)
    assert.ok(backend.components.schemas.SaveInput.oneOf)
    assert.deepEqual(backend.components.schemas.EditInput.required, ['activityId', 'materialType'])
    assert.deepEqual(backend.components.schemas.Analysis.properties.stage.anyOf.at(-1), { type: 'null' })
    assert.ok(backend.components.schemas.Material.required.includes('recordId'))
    assert.ok(backend.components.schemas.ActivitySummary.required.includes('metadataAnalysis'))
    assert.ok(backend.components.schemas.GrowthJourney.required.includes('analysis'))
    assert.deepEqual(ai.components.schemas.JobResponse.oneOf.map(item => item.$ref.split('/').at(-1)),
        ['JobRunning', 'JobCompleted', 'JobFailed'])
    for (const name of ['JobRunning', 'JobCompleted', 'JobFailed']) {
        assert.equal(ai.components.schemas[name].additionalProperties, false)
    }
    assert.ok(ai.components.schemas.JobCompleted.required.includes('result'))
    assert.ok(ai.components.schemas.JobFailed.required.includes('code'))
    assert.equal(ai.components.schemas.JobFailed.properties.result, undefined)
    assert.equal(ai.components.schemas.ChatInput.properties.files.maxItems, 10)
    assert.ok(ai.components.schemas.ChatInput.anyOf)
    assert.ok(ai.paths['/chat'].post.requestBody.content['multipart/form-data'])
    assert.ok(ai.paths['/chat'].post.responses['200'])
    assert.ok(ai.paths['/chat'].post.responses['202'])
    assert.equal(ai.components.schemas.ActivityAnalysisResult.properties.promptVersion.const, 'activity-metadata-analysis')
})

test('Swagger에서 연결한 handoff 원문과 문서 사이 링크를 정적 파일로 제공한다', async t => {
    const directory = await mkdtemp(path.join(tmpdir(), '1line-swagger-test-'))
    t.after(async () => {
        assert.equal(path.dirname(directory), path.resolve(tmpdir()))
        assert.ok(path.basename(directory).startsWith('1line-swagger-test-'))
        await rm(directory, { recursive: true, force: true })
    })
    await buildSwagger(directory)
    const init = await readFile(path.join(directory, 'swagger-init.js'), 'utf8')
    assert.ok(init.includes('AI · 홈·서버 분석'))
    const visited = new Set()
    async function checkPage(url) {
        const parsed = new URL(url, 'https://docs.example.org/swagger/')
        if (!parsed.pathname.startsWith('/swagger/handoff/') || visited.has(parsed.pathname)) return
        const relative = decodeURIComponent(parsed.pathname.slice('/swagger/'.length))
        const html = await readFile(path.join(directory, relative), 'utf8')
        if (relative.endsWith('.json')) {
            const example = JSON.parse(html)
            assert.ok(example.publicResponse || example.completedResponse)
            return
        }
        visited.add(parsed.pathname)
        assert.ok(html.includes('<html lang="ko">'))
        for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
            await checkPage(new URL(href, parsed).href)
        }
    }
    for (const name of ['backend', 'ai']) {
        const document = JSON.parse(await readFile(path.join(directory, 'openapi', name + '.json'), 'utf8'))
        assert.deepEqual(document, JSON.parse(await read('docs/frontend-integration/openapi/' + name + '.openapi.json')))
        assert.ok(document.info.description.includes('analysisId'))
        assert.ok(document.info.description.includes('사용자가 분석 카드의 저장 버튼을 누르면'))
        for (const [, href] of document.info.description.matchAll(/\]\(([^)]+)\)/g)) await checkPage(href)
        for (const operations of Object.values(document.paths)) {
            for (const operation of Object.values(operations)) {
                const provider = name === 'backend' ? '백엔드' : 'AI'
                const caller = operation['x-audience'] === 'frontend' ? '프론트' : name === 'backend' ? 'AI' : '백엔드'
                assert.ok(operation.summary.startsWith('[' + caller + ' → ' + provider + ']'))
            }
        }
    }
    assert.equal(visited.size, 27)
    assert.ok(visited.has('/swagger/handoff/backend-ai-integration/README.html'))
    const homeExample = JSON.parse(await readFile(path.join(directory, 'handoff/backend-ai-integration/examples/home-job-exchange.json'), 'utf8'))
    assert.equal(homeExample.queuedPublication.expectedRevision, 0)
    assert.equal(homeExample.completedResponse.job.revision, 2)
    assert.ok(visited.has(encodeURI('/swagger/handoff/growth-journey-update/공통_JSON_계약.html')))
    const example = JSON.parse(await readFile(path.join(directory, 'handoff/growth-journey-update/examples/journey-exchange.json'), 'utf8'))
    assert.equal(example.publicResponse.schemaVersion, 'journey-result-v2')
    const contract = await readFile(path.join(directory, 'handoff/growth-journey-update/공통_JSON_계약.html'), 'utf8')
    assert.ok(contract.includes('href="examples/journey-exchange.json"'))
})
