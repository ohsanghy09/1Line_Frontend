import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import swaggerUi from 'swagger-ui-dist'

const handoffDirectories = [
  'common/handoff', 'common/integration/handoff', 'common/review', 'backend/handoff', 'ai/handoff',
  'growth-journey-update', 'backend-ai-integration',
]

const escapeHtml = value => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character])

// 원문을 이스케이프해 제공하고 문서 묶음 안의 상대 링크를 연결한다.
async function buildHandoffPages(target) {
  const documents = new Map()
  const exampleSources = [
    'growth-journey-update/examples/journey-exchange.json',
    'backend-ai-integration/examples/home-job-exchange.json',
  ]
  for (const source of exampleSources) {
    const exampleTarget = path.join(target, 'handoff', source)
    await mkdir(path.dirname(exampleTarget), { recursive: true })
    await copyFile(new URL('../docs/' + source, import.meta.url), exampleTarget)
  }
  for (const directory of handoffDirectories) {
    const sourceDirectory = new URL('../docs/' + directory + '/', import.meta.url)
    for (const name of (await readdir(sourceDirectory)).filter(name => name.endsWith('.md')).sort()) {
      documents.set(directory + '/' + name, await readFile(new URL(name, sourceDirectory), 'utf8'))
    }
  }
  for (const [source, markdown] of documents) {
    const title = markdown.match(/^# (.+)/m)?.[1] ?? path.posix.basename(source, '.md')
    const content = escapeHtml(markdown.replace(/^# .+\r?\n/, '')).replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      const destination = path.posix.normalize(path.posix.join(path.posix.dirname(source), decodeURIComponent(href)))
      if (exampleSources.includes(destination)) return '<a href="' + href + '">' + label + '</a>'
      if (!documents.has(destination)) return match
      return '<a href="' + href.replace(/\.md$/, '.html') + '">' + label + '</a>'
    })
    const index = path.posix.relative(path.posix.dirname(source), 'common/handoff/README.html')
    const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · Growth AI handoff</title><link rel="icon" type="image/svg+xml" href="/assets/Growth_AI_favicon_round.svg">
<style>body{max-width:1100px;margin:32px auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.7;color:#172033}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px}a{color:#174fa3}h1{font-size:24px}</style></head>
<body><nav><a href="/swagger/">API 명세</a> · <a href="${escapeHtml(index)}">handoff 문서 목록</a></nav>
<h1>${escapeHtml(title)}</h1><pre>${content}</pre></body></html>
`
    const destination = path.join(target, 'handoff', source.replace(/\.md$/, '.html'))
    await mkdir(path.dirname(destination), { recursive: true })
    await writeFile(destination, html)
  }
}

// handoff 기반 명세를 읽어 프론트에서 제공할 정적 문서를 생성한다.
export async function buildSwagger(outputDirectory = fileURLToPath(new URL('../public/swagger/', import.meta.url))) {
  const [backendSpec, aiSpec] = await Promise.all(['backend', 'ai'].map(async name => {
    const source = new URL(`../docs/frontend-integration/openapi/${name}.openapi.json`, import.meta.url)
    return JSON.parse(await readFile(source, 'utf8'))
  }))
  const target = path.resolve(outputDirectory)
  await mkdir(path.join(target, 'openapi'), { recursive: true })
  const assets = swaggerUi.getAbsoluteFSPath()
  for (const name of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'swagger-ui-bundle.js.LICENSE.txt', 'swagger-ui-standalone-preset.js.LICENSE.txt', 'LICENSE', 'NOTICE']) {
    await copyFile(path.join(assets, name), path.join(target, name))
  }
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Growth AI API 명세</title><link rel="icon" type="image/svg+xml" href="/assets/Growth_AI_favicon_round.svg"><link rel="stylesheet" href="./swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="./swagger-ui-bundle.js"></script>
<script src="./swagger-ui-standalone-preset.js"></script><script src="./swagger-init.js"></script></body></html>
`
  const init = `window.ui = SwaggerUIBundle({
  urls: [{url: './openapi/backend.json', name: '백엔드 · 저장·조회'}, {url: './openapi/ai.json', name: 'AI · 홈·서버 분석'}],
  dom_id: '#swagger-ui', presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset], layout: 'StandaloneLayout',
  deepLinking: true, docExpansion: 'list', defaultModelsExpandDepth: 1, defaultModelExpandDepth: 2,
  supportedSubmitMethods: [], validatorUrl: null
});
`
  await writeFile(path.join(target, 'index.html'), html)
  await writeFile(path.join(target, 'swagger-init.js'), init)
  await writeFile(path.join(target, 'openapi/backend.json'), JSON.stringify(backendSpec, null, 2) + '\n')
  await writeFile(path.join(target, 'openapi/ai.json'), JSON.stringify(aiSpec, null, 2) + '\n')
  await buildHandoffPages(target)
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`Swagger static files: ${await buildSwagger()}`)
}
