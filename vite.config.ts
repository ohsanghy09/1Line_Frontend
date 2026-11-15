import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

// 제공 종료한 문서 주소는 앱 화면 대신 404로 응답한다.
function retiredDocumentRoute(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const pathname = (req.url ?? '').split('?')[0]
  if (pathname === '/swagger' || pathname.startsWith('/swagger/')) {
    res.writeHead(404)
    res.end()
    return
  }
  next()
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'retired-document-route',
    configureServer(server) { server.middlewares.use(retiredDocumentRoute) },
    configurePreviewServer(server) { server.middlewares.use(retiredDocumentRoute) },
  }],
})
