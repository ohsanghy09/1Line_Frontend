import express from 'express'
import swaggerUi from 'swagger-ui-dist'
import { backendSpec, aiSpec } from './openapi.js'

// 문서만 제공하는 독립 서버다. 사용자 DB·프론트 라우터·기존 API 앱을 실행하지 않는다.
export function createDocsApp() {
  const app = express()
  app.get('/openapi/backend.json', (_req, res) => res.json(backendSpec))
  app.get('/openapi/ai.json', (_req, res) => res.json(aiSpec))
  app.use('/swagger-assets', express.static(swaggerUi.getAbsoluteFSPath()))
  app.get(['/swagger', '/swagger/'], (_req, res) => res.type('html').send(`<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>1Line API 명세</title>
<link rel="stylesheet" href="/swagger-assets/swagger-ui.css"></head>
<body><div id="swagger-ui"></div><script src="/swagger-assets/swagger-ui-bundle.js"></script><script src="/swagger-assets/swagger-ui-standalone-preset.js"></script><script src="/swagger-init.js"></script></body></html>`))
  app.get('/swagger-init.js', (_req, res) => res.type('js').send(`window.ui = SwaggerUIBundle({
    urls: [{url: '/openapi/backend.json', name: '백엔드 · 현재 개발 서버'}, {url: '/openapi/ai.json', name: 'AI · 모델 미정 / 입력·출력'}],
    dom_id: '#swagger-ui', presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset], layout: 'StandaloneLayout',
    deepLinking: true, docExpansion: 'list', defaultModelsExpandDepth: 1, defaultModelExpandDepth: 2,
    supportedSubmitMethods: [], validatorUrl: null
  });`))
  app.use((_req, res) => res.status(404).type('text').send('문서 주소: /swagger'))
  return app
}
