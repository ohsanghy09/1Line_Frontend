import { createDocsApp } from './server.js'

const port = Number(process.env.DOCS_PORT ?? 3002)
const server = createDocsApp().listen(port, '127.0.0.1', () => console.log(`1Line Swagger: http://127.0.0.1:${port}/swagger`))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
