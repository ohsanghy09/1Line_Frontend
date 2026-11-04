import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 로컬 REST API는 프론트와 별도 프로세스로 실행한다.
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
})
