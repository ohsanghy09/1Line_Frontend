import { fileURLToPath } from 'node:url'
import { openDatabase } from './database.js'
import { createApp } from './app.js'

const port = Number(process.env.PORT ?? 3001)
const db = openDatabase(process.env.DB_PATH ?? fileURLToPath(new URL('../data/1line.db', import.meta.url)))
// 개인 개발용 서버는 기본적으로 이 컴퓨터에서만 접속한다.
const app = createApp(db, { origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173', autoActivityAnalysis: true })
const server = app
  .listen(port, '127.0.0.1', () => console.log(`1Line API: http://127.0.0.1:${port}`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => {
  await app.locals.activityMetadata.close()
  db.close(); process.exit(0)
}))
