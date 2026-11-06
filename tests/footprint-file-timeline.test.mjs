import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createServer } from 'vite'
import { openDatabase } from '../api-server/test-support/database.js'
import { createApp } from '../api-server/test-support/app.js'

test('프론트 아카이브 서비스 → Vite 프록시 → REST API → SQLite', async t => {
    const db = openDatabase(':memory:')
    const api = createApp(db).listen(0, '127.0.0.1')
    await new Promise(resolve => api.once('listening', resolve))
    const vite = await createServer({ server: { host: '127.0.0.1', port: 0, proxy: {
        '/api': `http://127.0.0.1:${api.address().port}`,
        '/ai-api': { target: `http://127.0.0.1:${api.address().port}`, rewrite: path => path.replace(/^\/ai-api/, '/api') },
    } } })
    const originalFetch = globalThis.fetch
    try {
        await vite.listen()
        const base = `http://127.0.0.1:${vite.httpServer.address().port}`
        const proxyFetch = (url, init) => originalFetch(new URL(url, base), init)
        globalThis.fetch = proxyFetch
        const moduleUrl = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
        const chatUrl = moduleUrl(stripTypeScriptTypes(readFileSync(new URL('../src/services/chat.ts', import.meta.url), 'utf8')))
        const chat = await import(chatUrl)
        const recordsSource = stripTypeScriptTypes(readFileSync(new URL('../src/services/records.ts', import.meta.url), 'utf8')).replace("from './chat'", `from '${chatUrl}'`)
        const records = await import(moduleUrl(recordsSource))
        const activityAnalysisUrl = moduleUrl(stripTypeScriptTypes(readFileSync(new URL('../src/services/activityAnalysis.ts', import.meta.url), 'utf8')).replace("from './chat'", `from '${chatUrl}'`))
        const source = stripTypeScriptTypes(readFileSync(new URL('../src/services/footprints.ts', import.meta.url), 'utf8')).replace("from './chat'", `from '${chatUrl}'`).replace("from './activityAnalysis'", `from '${activityAnalysisUrl}'`)
        const archiveUrl = moduleUrl(source)
        const service = await import(archiveUrl)
        const homeSource = stripTypeScriptTypes(readFileSync(new URL('../src/services/home.ts', import.meta.url), 'utf8'))
            .replace("from './chat'", `from '${chatUrl}'`).replace("from './footprints'", `from '${archiveUrl}'`)
        const home = await import(moduleUrl(homeSource))
        const post = async (path, body, method = 'POST') => {
            const response = await proxyFetch('/api' + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            assert.ok(response.ok)
            return response.json()
        }
        let saved, fileId

        await t.test('기존 DB 활동을 조회하고 빈 활동에 예시 자료를 채우지 않는다', async () => {
            const activities = await service.getFootprintActivities()
            assert.equal(activities.length, 5)
            assert.ok(activities.every(activity => activity.materialsCount === 0 && activity.updatedAt === '' && activity.updatedAtLabel === '기록 없음'))
            assert.equal(activities[0].status, '미설정')
            assert.equal(activities[0].role, '미설정')
            assert.deepEqual((await service.getFootprintActivity('line1-hackathon')).folders, [])
            assert.deepEqual(await home.getHomeRecent(), { activities: [], records: [] })
        })

        await t.test('실제 파일 입력·저장 후 자료 수·요약·날짜·변화가 조회된다', async () => {
            const body = new FormData()
            body.set('message', '사용자가 입력한 파일 설명')
            body.set('mode', 'change')
            body.append('files', new Blob(['real bytes']), '내 자료.txt')
            const draft = await (await proxyFetch('/api/chat', { method: 'POST', body })).json()
            fileId = draft.attachments[0].id
            assert.equal((await service.getFootprintActivity('line1-hackathon')).materialsCount, 0)
            saved = await post('/records', { analysisId: draft.analysisId, activityId: 'line1-hackathon' })
            const activity = await service.getFootprintActivity('line1-hackathon')
            assert.equal(activity.materialsCount, 1)
            assert.equal(activity.updatedAt, saved.updatedAt)
            assert.notEqual(activity.updatedAtLabel, '기록 없음')
            assert.equal(activity.timeline.length, 1)
            assert.equal(activity.timeline[0].isTurningPoint, false)
            const detail = await service.getFootprintFile(activity.id, fileId)
            assert.equal(detail.file.name, '내 자료.txt')
            assert.equal(Object.hasOwn(detail.file, 'content'), false)
            assert.equal(detail.file.summary, draft.reply.analysis.summary)
            assert.equal(detail.file.summaryScope, 'record')
            assert.equal(detail.events[0].id, activity.timeline[0].id)
            assert.deepEqual(detail.events[0].evidenceFileIds, [fileId])
            assert.deepEqual(detail.versionHistory, [])
            // 이름/내용에서 맞은 활동은 프론트에서 활동 제목만으로 다시 걸러내지 않는다.
            const matches = await service.searchFootprintActivities({ search: '내 자료.txt', category: 'all', status: 'all', sort: 'recent' })
            assert.equal(matches.total, 5)
            assert.deepEqual(matches.items.map(item => item.id), [activity.id])
            assert.equal(matches.items[0].materialsCount, 1)
            const content = await service.searchFootprintActivities({ search: '사용자가 입력한 파일 설명', category: 'all', status: 'all', sort: 'recent' })
            assert.deepEqual(content.items, [])
            const noMatches = await service.searchFootprintActivities({ search: '없는 자료', category: 'all', status: 'all', sort: 'materials' })
            assert.deepEqual(noMatches.items, [])
            assert.equal(noMatches.total, 5)
            const aborted = new AbortController()
            aborted.abort()
            await assert.rejects(service.searchFootprintActivities({ search: '', category: 'all', status: 'all', sort: 'recent' }, aborted.signal))
            const recent = await home.getHomeRecent()
            assert.equal(recent.activities[0].id, activity.id)
            assert.equal(recent.activities[0].updatedAtLabel, activity.updatedAtLabel)
            assert.equal(recent.records[0].id, fileId)
            assert.equal(recent.records[0].activityId, activity.id)
            assert.equal(recent.records[0].savedAt, saved.createdAt)
            assert.ok(recent.records[0].savedAtLabel)
        })

        await t.test('저장 후 활동·분류·요약 수정 및 변화 제거가 재조회에 반영된다', async () => {
            await post(`/records/${saved.id}`, { activityId: 'computer-vision', materialType: '회의록', summary: '수정된 요약', changes: [] }, 'PATCH')
            assert.equal((await service.getFootprintActivity('line1-hackathon')).materialsCount, 0)
            assert.equal(await service.getFootprintFile('line1-hackathon', fileId), null)
            const moved = await service.getFootprintActivity('computer-vision')
            assert.equal(moved.materialsCount, 1)
            assert.equal(moved.folders[0].name, '회의록')
            const file = await service.getFootprintFile('computer-vision', fileId)
            assert.equal(file.file.summary, '수정된 요약')
            assert.deepEqual(file.events, [])
            assert.deepEqual(moved.timeline, [])
            const recent = await home.getHomeRecent()
            assert.equal(recent.records[0].activityId, moved.id)
            assert.equal(recent.records[0].materialType, '회의록')
            assert.equal(recent.records[0].savedAt, saved.createdAt)
        })

        await t.test('404는 없음으로 표시하고 다른 활동 자료와 잘못된 ID를 대체하지 않는다', async () => {
            assert.equal(await service.getFootprintActivity('unknown'), null)
            assert.equal(await service.getFootprintActivity(''), null)
            assert.equal(await service.getFootprintFile('line1-hackathon', fileId), null)
            assert.equal(await service.getFootprintFile('computer-vision', 'unknown'), null)
        })

        await t.test('확장 응답을 검증하고 확인한 새 활동 생성과 저장 후 메타정보 조회를 연결한다', async () => {
            const reply = await chat.getChatReply('새 활동에서 경험한 실제 입력')
            const metadata = { name: '새 연구 활동', category: '프로젝트', status: '진행 중', role: '연구', period: { start: '2026-09', end: null }, summary: '모델 연구 활동' }
            reply.analysis.activity = { ...metadata, match: 'new', id: null, confidence: 'medium' }
            assert.equal(chat.isReply(reply), true)
            assert.equal(chat.isReply({ ...reply, analysis: { ...reply.analysis, activity: { ...reply.analysis.activity, id: 'existing-id' } } }), false)
            assert.equal(chat.isReply({ ...reply, analysis: { ...reply.analysis, activity: { ...reply.analysis.activity, period: { start: '2026-02-30', end: null } } } }), false)
            const created = await records.saveRecord(reply, { newActivity: metadata })
            assert.equal(created.reply.analysis.activity.match, 'existing')
            const choice = (await records.getActivities()).find(activity => activity.id === created.activityId)
            assert.equal(choice.name, metadata.name)
            assert.deepEqual(choice.period, metadata.period)
            const archive = await service.getFootprintActivity(created.activityId)
            assert.equal(archive.materialsCount, 0)
            assert.equal(archive.recordsCount, 1)
            assert.equal(archive.role, '연구')
            const { name: _name, ...updates } = metadata
            await records.updateRecord(created.id, created.activityId, '연구 기록', { ...updates, role: null, status: '완료' })
            const updated = await service.getFootprintActivity(created.activityId)
            assert.equal(updated.status, '완료')
            assert.equal(updated.role, '연구')
            assert.deepEqual(updated.folders, [])
        })

        await t.test('서버 오류·연결 실패·잘못된 응답은 목 데이터로 대체하지 않는다', async () => {
            try {
                globalThis.fetch = async () => new Response(JSON.stringify({ error: '서버 오류' }), { status: 500 })
                await assert.rejects(service.getFootprintActivity('line1-hackathon'), /서버 오류/)
                globalThis.fetch = async () => { throw new TypeError('offline') }
                await assert.rejects(service.getFootprintActivities(), /연결하지 못했어요/)
                await assert.rejects(home.getHomeRecent(), /연결하지 못했어요/)
                globalThis.fetch = async () => new Response(JSON.stringify([{ id: 'invalid' }]))
                await assert.rejects(service.getFootprintActivities(), /응답 형식/)
                globalThis.fetch = async () => new Response(JSON.stringify({ id: 'invalid' }))
                await assert.rejects(service.getFootprintFile('computer-vision', fileId), /응답 형식/)
                await assert.rejects(home.getHomeRecent(), /응답 형식/)
            } finally { globalThis.fetch = proxyFetch }
        })
    } finally {
        globalThis.fetch = originalFetch
        await vite.close()
        await new Promise(resolve => api.close(resolve))
        db.close()
    }
})
