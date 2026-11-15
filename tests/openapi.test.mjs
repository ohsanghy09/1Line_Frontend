import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

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
            ? ['GET /internal/chat-jobs/{jobId}', 'GET /internal/home-context', 'POST /internal/file-duplicates/check', 'PUT /internal/chat-jobs/{jobId}']
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
    const publication = backend.components.schemas.JobPublication
    const rule = (schema, status) => schema.allOf.find(item => item.if.properties.status.const === status).then.properties
    assert.equal(publication.properties.reply.anyOf, undefined)
    assert.equal(rule(publication, 'failed').reply.type, undefined)
    assert.equal(rule(publication, 'failed').error.$ref, '#/components/schemas/ServiceError')
    assert.equal(rule(publication, 'completed').reply.$ref, '#/components/schemas/CompletedReply')
    assert.equal(publication.allOf.find(item => item.if.properties.status.enum).then.properties.reply.type, 'null')
    assert.equal(rule(backend.components.schemas.JobSnapshot, 'failed').reply.type, 'null')
})
