import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

// 정적 문서 주소가 React SPA로 넘어가지 않도록 처리한다.
function swaggerDocumentRoute(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const [pathname, query] = (req.url ?? '').split('?')
  if (pathname === '/swagger') {
    res.writeHead(307, { Location: `/swagger/${query ? `?${query}` : ''}` })
    res.end()
    return
  }
  if (pathname === '/swagger/') req.url = `/swagger/index.html${query ? `?${query}` : ''}`
  next()
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'swagger-document-route',
    configureServer(server) { server.middlewares.use(swaggerDocumentRoute) },
    configurePreviewServer(server) { server.middlewares.use(swaggerDocumentRoute) },
  }],
})
