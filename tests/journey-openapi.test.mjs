import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { loadFrontend } from './support/frontend.mjs'

const read = async file => JSON.parse(await readFile(new URL('../' + file, import.meta.url), 'utf8'))
const backend = await read('docs/frontend-integration/openapi/backend.openapi.json')
const ai = await read('docs/frontend-integration/openapi/ai.openapi.json')
const { isGrowthJourney } = await loadFrontend('src/services/journey.ts')

test('두 명세의 성장 판단 스키마·필수 비교·전이 규칙이 같다', () => {
    const names = ['JourneyEvidence', 'JourneyOption', 'JourneyComparison', 'JourneyTransfer',
        'JourneyBasicAssessment', 'JourneyComparisonAssessment', 'JourneyTransferAssessment',
        'JourneyAssessment', 'JourneyEvent', 'JourneySummary', 'JourneyBadge']
    for (const name of names) assert.deepEqual(backend.components.schemas[name], ai.components.schemas[name], name)
    const schemas = backend.components.schemas
    assert.ok(schemas.JourneyComparisonAssessment.required.includes('comparison'))
    assert.ok(schemas.JourneyTransferAssessment.required.includes('transfer'))
    assert.ok(!schemas.JourneyBasicAssessment.required.includes('comparison'))
    assert.ok(schemas.JourneyEvent.required.includes('growthAssessments'))
    assert.equal(schemas.JourneyEvent.properties.type, undefined)
    assert.equal(schemas.JourneyEvent.additionalProperties, false)
    assert.equal(schemas.JourneyComparison.properties.beforeEvidence.minItems, 1)
    assert.equal(schemas.JourneyTransfer.properties.sourceActivity.properties.id.anyOf[1].type, 'null')
})
test('Swagger 공개 응답 예시 네 상태가 실제 프론트 검증을 통과한다', () => {
    for (const route of ['/journey', '/journey/analyze']) {
        const operation = backend.paths[route][route === '/journey' ? 'get' : 'post']
        const examples = operation.responses['200'].content['application/json'].examples
        assert.deepEqual(Object.keys(examples), ['analyzed', 'unanalyzed', 'insufficient', 'deleted'])
        for (const [name, example] of Object.entries(examples)) assert.equal(isGrowthJourney(example.value), true, route + ' ' + name)
    }
})
test('AI 요청·응답 버전과 Spring이 추가하는 필드를 구분한다', () => {
    const op = ai.paths['/analyze/journey'].post
    const input = op.requestBody.content['application/json'].example
    const output = op.responses['200'].content['application/json'].examples.analyzed.value
    for (const field of ['schemaVersion', 'criteriaVersion']) {
        assert.ok(ai.components.schemas.JourneyInput.required.includes(field))
        assert.ok(ai.components.schemas.JourneyResult.required.includes(field))
        assert.equal(output[field], input[field])
    }
    assert.equal(output.promptVersion, 'journey-v6')
    assert.equal(output.sourceFingerprint, input.sourceFingerprint)
    assert.equal(output.recordCount, input.records.length)
    assert.equal(output.result.analysis, undefined)
    assert.equal(output.result.evidenceSources, undefined)
    assert.equal(ai.components.schemas.SavedJourney.additionalProperties, false)
    assert.ok(backend.components.schemas.GrowthJourney.required.includes('evidenceSources'))
})
