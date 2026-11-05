import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import swaggerUi from 'swagger-ui-dist'
import { backendSpec, aiSpec } from '../api-server/docs/openapi.js'

// 기존 명세를 빌드 시 정적 파일로 만든다. Express·DB·AI 호출은 실행하지 않는다.
export async function buildSwagger(outputDirectory = fileURLToPath(new URL('../public/swagger/', import.meta.url))) {
  const target = path.resolve(outputDirectory)
  await mkdir(path.join(target, 'openapi'), { recursive: true })
  const assets = swaggerUi.getAbsoluteFSPath()
  for (const name of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js', 'swagger-ui-bundle.js.LICENSE.txt', 'swagger-ui-standalone-preset.js.LICENSE.txt', 'LICENSE', 'NOTICE']) {
    await copyFile(path.join(assets, name), path.join(target, name))
  }
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>1Line API 명세</title><link rel="stylesheet" href="./swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="./swagger-ui-bundle.js"></script>
<script src="./swagger-ui-standalone-preset.js"></script><script src="./swagger-init.js"></script></body></html>
`
  const init = `window.ui = SwaggerUIBundle({
  urls: [{url: './openapi/backend.json', name: '백엔드 · 현재 개발 서버'}, {url: './openapi/ai.json', name: 'AI · 모델 미정 / 입력·출력'}],
  dom_id: '#swagger-ui', presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset], layout: 'StandaloneLayout',
  deepLinking: true, docExpansion: 'list', defaultModelsExpandDepth: 1, defaultModelExpandDepth: 2,
  supportedSubmitMethods: [], validatorUrl: null
});
`
  await writeFile(path.join(target, 'index.html'), html)
  await writeFile(path.join(target, 'swagger-init.js'), init)
  await writeFile(path.join(target, 'openapi/backend.json'), JSON.stringify(backendSpec, null, 2) + '\n')
  await writeFile(path.join(target, 'openapi/ai.json'), JSON.stringify(aiSpec, null, 2) + '\n')
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  console.log(`Swagger static files: ${await buildSwagger()}`)
}
