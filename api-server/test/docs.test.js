import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { z } from 'zod'
import { backendSpec, aiSpec } from '../docs/openapi.js'
import { createDocsApp } from '../docs/server.js'
import { replySchema } from '../src/validation.js'
import { journeySchema } from '../src/journey.js'

test('백엔드 명세는 현재 API의 모든 경로·메서드를 포함한다', async () => {
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8')
  const actual = [...source.matchAll(/app\.(get|post|patch)\('([^']+)'/g)]
    .map(([, method, path]) => `${method} ${path.replace(/:([\w]+)/g, '{$1}')}`).sort()
  const documented = Object.entries(backendSpec.paths)
    .flatMap(([path, methods]) => Object.keys(methods).map(method => `${method} ${path}`)).sort()
  assert.deepEqual(documented, actual)
})

test('각 명세의 참조·필수 경로값이 유효하고 AI 실행 경로는 확정하지 않는다', () => {
  for (const spec of [backendSpec, aiSpec]) {
    function visit(value) {
      if (!value || typeof value !== 'object') return
      if (value.$ref) {
        assert.match(value.$ref, /^#\//)
        const target = value.$ref.slice(2).split('/').reduce((node, key) => node?.[key], spec)
        assert.ok(target, value.$ref)
      }
      for (const child of Object.values(value)) visit(child)
    }
    visit(spec)
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const operation of Object.values(methods)) {
        for (const [, name] of path.matchAll(/\{([^}]+)\}/g)) {
          assert.ok(operation.parameters.some(item => item.name === name && item.in === 'path' && item.required))
        }
      }
    }
  }
  assert.deepEqual(aiSpec.paths, {})
  assert.equal(aiSpec.servers, undefined)
})

test('문서 예시는 기존 분석·Journey 검증과 생성 JSON Schema를 만족한다', () => {
  for (const [name, schema] of [['ChatReply', replySchema], ['Journey', journeySchema]]) {
    const documented = backendSpec.components.schemas[name]
    const generated = z.fromJSONSchema(documented)
    for (const example of documented.examples) {
      assert.equal(schema.safeParse(example).success, true)
      assert.equal(generated.safeParse(example).success, true)
    }
    assert.deepEqual(aiSpec.components.schemas[name], documented)
  }
})

test('독립 문서 서버는 Swagger·로컬 자산·명세만 제공하고 API를 실행하지 않는다', async () => {
  const server = createDocsApp().listen(0, '127.0.0.1')
  try {
    await new Promise(resolve => server.once('listening', resolve))
    const base = `http://127.0.0.1:${server.address().port}`
    const page = await fetch(`${base}/swagger`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /swagger-ui-bundle.js/)
    for (const name of ['backend', 'ai']) {
      const result = await fetch(`${base}/openapi/${name}.json`)
      assert.equal(result.status, 200)
      assert.equal((await result.json()).openapi, '3.1.0')
    }
    for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js']) {
      assert.equal((await fetch(`${base}/swagger-assets/${asset}`)).status, 200)
    }
    const config = await (await fetch(`${base}/swagger-init.js`)).text()
    assert.match(config, /supportedSubmitMethods: \[\]/)
    assert.match(config, /validatorUrl: null/)
    assert.equal((await fetch(`${base}/`)).status, 404)
    assert.equal((await fetch(`${base}/api/health`)).status, 404)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
