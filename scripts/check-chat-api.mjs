import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { createServer } from 'vite'
import { openDatabase } from '../api-server/test-support/database.js'
import { createApp } from '../api-server/test-support/app.js'

// 프론트 서비스를 그대로 변환해 Vite 프록시 → 실제 API → SQLite까지 확인한다.
const db = openDatabase(':memory:')
const api = createApp(db).listen(0, '127.0.0.1')
await new Promise(resolve => api.once('listening', resolve))
const vite = await createServer({ server: { host: '127.0.0.1', port: 0, proxy: { '/api': `http://127.0.0.1:${api.address().port}`, '/ai-api': { target: `http://127.0.0.1:${api.address().port}`, rewrite: path => path.replace(/^\/ai-api/, '/api').replace('/chat/health', '/health') } } } })
const originalFetch = globalThis.fetch
try {
    await vite.listen()
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`
    globalThis.fetch = (url, init) => originalFetch(new URL(url, base), init)
    const source = readFileSync(new URL('../src/services/chat.ts', import.meta.url), 'utf8')
    const outputText = stripTypeScriptTypes(source)
    const serviceUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
    const service = await import(serviceUrl)
    const recordsSource = stripTypeScriptTypes(readFileSync(new URL('../src/services/records.ts', import.meta.url), 'utf8')).replace("from './chat'", `from '${serviceUrl}'`)
    const records = await import(`data:text/javascript;base64,${Buffer.from(recordsSource).toString('base64')}`)
    assert.equal((await service.getChatServiceStatus()).status, 'ready')
    const reply = await service.getChatReply('실제 전송 확인', [], { conversationId: 'frontend-test' })
    assert.equal(reply.kind, 'text-analysis')
    assert.ok(reply.analysisId)
    assert.equal(reply.conversationId, 'frontend-test')
    const progressUpdates = []
    const fileReply = await service.getChatReply('', [new File(['file bytes'], '회의록.txt')], { conversationId: 'frontend-test', onProgress: progress => progressUpdates.push(progress) })
    assert.ok(progressUpdates.some(progress => progress.steps.length === 1))
    // 폴링 사이에 단계가 지나갈 수 있다. 정확한 시간 경계는 백엔드 progress 검사에서 검증한다.
    assert.ok(progressUpdates.every(progress => progress.steps.length >= 1 && progress.steps.length <= 4))
    assert.ok(progressUpdates.every((progress, index) => index === 0 || progress.steps.length >= progressUpdates[index - 1].steps.length))
    assert.equal(fileReply.kind, 'no-change')
    assert.equal(fileReply.analysis.files[0].name, '회의록.txt')
    const batch = await service.getChatReply('자료 두 개', [new File(['a'], 'a.txt'), new File(['b'], 'b.txt')])
    assert.equal(batch.kind, 'batch-analysis')
    assert.equal(batch.analysis.groups[0].count, 2)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analyses WHERE conversation_id = ?').get('frontend-test').n, 2)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 0)
    // 저장 전 분류 변경이 초안 원본 파일 연결을 보존하면서 확정되는지 확인한다.
    const activities = await records.getActivities()
    assert.equal(activities.length, 5)
    fileReply.analysis.materialType = '회의록'
    const saved = await records.saveRecord(fileReply, 'computer-vision')
    assert.equal(saved.reply.analysis.materialType, '회의록')
    assert.equal(saved.activityId, 'computer-vision')
    assert.equal(db.prepare('SELECT analysis_id FROM records WHERE id = ?').get(saved.id).analysis_id, fileReply.analysisId)
    await assert.rejects(records.saveRecord(fileReply, 'computer-vision'), /이미 기록/)
    const edited = await records.updateRecord(saved.id, 'line1-hackathon', '기획안')
    assert.equal(edited.reply.analysis.activity.name, '1호선톤')
    assert.equal(edited.reply.analysis.files[0].materialType, '기획안')
    const mockSource = stripTypeScriptTypes(readFileSync(new URL('../tests/fixtures/chat.ts', import.meta.url), 'utf8'))
    const mocks = await import(`data:text/javascript;base64,${Buffer.from(mockSource).toString('base64')}`)
    for (const card of [mocks.mockTextAnalysisReply, mocks.mockFileAnalysisReply, mocks.mockNoChangeReply, mocks.mockBatchAnalysisReply]) {
        const record = await records.saveRecord(card, 'line1-hackathon')
        assert.deepEqual(record.reply.analysis.changes, card.analysis.changes)
        assert.ok(record.id)
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, 5)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM timeline_events').get().n, 2)
    const linkUpdates = []
    let linkJobId
    const link = await service.getLinkReply(' https://github.com/example/project?tab=readme#intro ', {
        conversationId: 'frontend-test', onProgress: progress => linkUpdates.push(progress), onJobStarted: id => { linkJobId = id },
    })
    assert.equal(link.kind, 'link-analysis')
    assert.equal(link.sourceUrl, 'https://github.com/example/project?tab=readme#intro')
    assert.equal(linkUpdates[0].steps[0].label, '링크 확인 중...')
    assert.equal(linkUpdates.at(-1).steps.length, 4)
    assert.equal((await service.resumeChatReply(linkJobId)).analysisId, link.analysisId)
    const savedLink = await records.saveRecord(link, 'line1-hackathon')
    const editedLink = await records.updateRecord(savedLink.id, 'computer-vision', '참고 링크')
    assert.equal(editedLink.reply.sourceUrl, link.sourceUrl)
    await assert.rejects(service.getLinkReply('javascript:alert(1)'), /HTTP 또는 HTTPS/)
    assert.equal(Buffer.from(db.prepare('SELECT content FROM files WHERE name = ?').get('회의록.txt').content).toString(), 'file bytes')
    await assert.rejects(service.getChatReply('', []), /텍스트 또는 파일/)
    await assert.rejects(service.getChatReply('a'.repeat(20001)), /20000자/)
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(service.getChatReply('취소', [], { signal: controller.signal }))
    const duringProgress = new AbortController()
    let progressCount = 0
    let interruptedJobId
    const beforeInterrupted = db.prepare('SELECT COUNT(*) AS n FROM analyses').get().n
    await assert.rejects(service.getChatReply('', [new File(['cancel'], '취소.txt')], {
        signal: duringProgress.signal,
        onJobStarted: jobId => { interruptedJobId = jobId },
        onProgress: () => { progressCount++; duringProgress.abort() },
    }))
    assert.equal(progressCount, 1)
    assert.ok(interruptedJobId)
    let resumedProgress = 0
    const resumed = await service.resumeChatReply(interruptedJobId, { onProgress: () => { resumedProgress++ } })
    assert.equal(resumed.analysis.files[0].name, '취소.txt')
    assert.ok(resumedProgress > 0)
    // 완료 결과를 다시 조회해도 새로운 업로드가 발생하지 않는다.
    const completedAgain = await service.resumeChatReply(interruptedJobId)
    assert.equal(completedAgain.analysisId, resumed.analysisId)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analyses').get().n, beforeInterrupted + 1)
    await assert.rejects(service.resumeChatReply('missing-job'), /작업을 찾을 수/)
    const general = { id: 'general-response', role: 'assistant', kind: 'general', content: '안녕하세요!', analysis: null }
    let textRequests = 0, textProgress = 0
    globalThis.fetch = async (_url, init) => {
        textRequests++
        assert.equal(init.method, 'POST')
        assert.equal(init.headers.Prefer, 'respond-sync')
        return new Response(JSON.stringify({ jobId: 'ai-general', status: 'completed', result: { analysisId: 'general-draft', conversationId: 'general', reply: general } }))
    }
    assert.equal((await service.getChatReply('안녕', [], { onProgress: () => textProgress++ })).kind, 'general')
    assert.equal(textRequests, 1)
    assert.equal(textProgress, 0)
    assert.equal(service.isReply({ ...general, analysis: fileReply.analysis }), false)
    // 모델이 해석한 수정은 백엔드에서 한 번 적용하고 일반 말풍선만 반환한다.
    const editId = 'chat-edit-service'
    const editReply = { id: 'edit-reply', role: 'assistant', kind: 'activity-update', analysis: null, content: '수정 중',
        update: { activityId: 'computer-vision', activityName: '컴퓨터비전', updates: [{ field: 'role', value: '팀장' }] } }
    const editTime = new Date().toISOString()
    db.prepare('INSERT INTO analyses VALUES (?, ?, ?, ?, ?)').run(editId, 'edit-conversation', '역할을 팀장으로 바꿔줘', JSON.stringify(editReply), editTime)
    db.prepare("INSERT INTO ai_chat_jobs VALUES ('ai-edit', 'edit-key', 'edit-fingerprint', ?, 'chat', 'completed', 'completed', NULL, '{}', ?, ?)").run(editId, editTime, editTime)
    const recordCountBeforeEdit = db.prepare('SELECT COUNT(*) AS n FROM records').get().n
    let editAiRequests = 0, editBackendRequests = 0
    globalThis.fetch = async (url, init) => {
        if (String(url).startsWith('/ai-api/')) {
            editAiRequests++
            const latest = JSON.parse(db.prepare('SELECT reply FROM analyses WHERE id = ?').get(editId).reply)
            return new Response(JSON.stringify({ jobId: 'ai-edit', status: 'completed', result: { analysisId: editId, conversationId: 'edit-conversation', reply: latest } }))
        }
        editBackendRequests++
        return originalFetch(new URL(url, base), init)
    }
    const editedByChat = await service.getChatReply('역할을 팀장으로 바꿔줘')
    assert.equal(editedByChat.kind, 'general')
    assert.equal(editedByChat.analysis, null)
    assert.equal(editedByChat.updatedActivityId, 'computer-vision')
    assert.equal(db.prepare("SELECT role FROM activities WHERE id = 'computer-vision'").get().role, '팀장')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n, recordCountBeforeEdit)
    assert.equal(editAiRequests, 1)
    assert.equal(editBackendRequests, 1)
    db.prepare("UPDATE activities SET role = '이후 변경' WHERE id = 'computer-vision'").run()
    await service.resumeChatReply('ai-edit')
    assert.equal(editBackendRequests, 1)
    assert.equal(db.prepare("SELECT role FROM activities WHERE id = 'computer-vision'").get().role, '이후 변경')
    globalThis.fetch = async url => String(url).startsWith('/ai-api/')
        ? new Response(JSON.stringify({ analysisId: editId, conversationId: 'edit-conversation', reply: editReply }))
        : new Response(JSON.stringify({ error: '수정 요청 거절' }), { status: 400 })
    await assert.rejects(service.getChatReply('잘못된 수정'), error => service.isTerminalChatFailure(error))
    globalThis.fetch = async () => new Response(JSON.stringify({ jobId: 'failed-job', status: 'failed', error: '분석 작업 실패' }))
    await assert.rejects(service.getChatReply('실패 응답'), /분석 작업 실패/)
    globalThis.fetch = async () => new Response(JSON.stringify({ jobId: 'bad-progress', status: 'running', progress: { title: '확인 중', steps: [] } }))
    await assert.rejects(service.getChatReply('잘못된 진행'), /텍스트 응답이 완료되지/)
    globalThis.fetch = async () => new Response(JSON.stringify({ error: '요청 거부' }), { status: 400 })
    await assert.rejects(service.getChatReply('오류'), /요청 거부/)
    globalThis.fetch = async () => new Response('{}')
    await assert.rejects(service.getChatReply('잘못된 응답'), /응답 형식/)
    globalThis.fetch = async () => { throw new TypeError('network failure') }
    await assert.rejects(service.getChatReply('연결 실패'), /API 서버에 연결하지/)
    console.log('PASS: 프론트 서비스·Vite 프록시·파일/텍스트/다중 파일·SQLite·오류/취소 검증')
} finally {
    globalThis.fetch = originalFetch
    await vite.close()
    await new Promise(resolve => api.close(resolve))
    db.close()
}
