import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFrontend, expectRequests } from './support/frontend.mjs'

const chat = await loadFrontend('src/services/chat.ts')
const records = await loadFrontend('src/services/records.ts')
const mocks = await loadFrontend('tests/fixtures/chat.ts')
const result = (reply = mocks.mockTextAnalysisReply) => ({ analysisId: 'analysis-1', conversationId: 'conversation-1', reply })
const progress = { title: '분석 중', steps: [{ label: '파일 확인 중', status: 'working' }] }
const completed = (jobId, reply) => ({ jobId, status: 'completed', result: result(reply) })

test('상태 조회와 텍스트 multipart 요청·동기 응답을 처리한다', async t => {
    expectRequests(t, [
        { path: '/ai-api/chat/health', data: { status: 'ready', label: '준비됨' } },
        { path: '/ai-api/chat', method: 'POST', data: completed('ai-text', mocks.mockTextAnalysisReply), check: init => {
            assert.equal(init.headers.Prefer, 'respond-sync')
            assert.equal(init.headers['Content-Type'], undefined)
            assert.equal(init.body.get('message'), '사용자 입력')
            assert.equal(init.body.get('conversationId'), 'conversation-1')
            assert.ok(init.body.get('requestId'))
            assert.equal(init.body.getAll('files').length, 0)
        } },
        { path: '/ai-api/chat', method: 'POST', data: result(mocks.mockGeneralReply) },
    ])
    assert.equal((await chat.getChatServiceStatus()).status, 'ready')
    let updates = 0
    const reply = await chat.getChatReply('사용자 입력', [], { conversationId: 'conversation-1', onProgress: () => updates++ })
    assert.equal(reply.analysisId, 'analysis-1')
    assert.equal(reply.kind, 'text-analysis')
    assert.equal(updates, 0)
    assert.equal((await chat.getChatReply('안녕')).kind, 'general')
})

test('파일 원본·파일명·다중 첨부와 비동기 진행·완료를 처리한다', async t => {
    const reply = structuredClone(mocks.mockNoChangeReply)
    reply.analysis.files[0].name = '회의록.txt'
    expectRequests(t, [
        { path: '/ai-api/chat', method: 'POST', data: { jobId: 'ai-file', status: 'running', progress }, check: async init => {
            assert.equal(init.headers.Prefer, 'respond-async')
            assert.deepEqual(init.body.getAll('files').map(file => file.name), ['회의록.txt', '추가.txt'])
            assert.equal(await init.body.getAll('files')[0].text(), 'file bytes')
        } },
        { path: '/ai-api/chat/jobs/ai-file', data: completed('ai-file', reply) },
        { path: '/ai-api/chat', method: 'POST', data: result(mocks.mockBatchAnalysisReply) },
    ])
    const updates = [], jobs = []
    const response = await chat.getChatReply('', [new File(['file bytes'], '회의록.txt'), new File(['b'], '추가.txt')], {
        onProgress: value => updates.push(value), onJobStarted: id => jobs.push(id),
    })
    assert.deepEqual(updates, [progress])
    assert.deepEqual(jobs, ['ai-file'])
    assert.equal(response.analysis.files[0].name, '회의록.txt')
    assert.equal((await chat.getChatReply('묶음', [new File(['a'], 'a.txt')])).kind, 'batch-analysis')
})

test('진행 대기 취소 후에는 업로드 없이 AI 작업만 복원한다', async t => {
    expectRequests(t, [
        { path: '/ai-api/chat', method: 'POST', data: { jobId: 'ai-cancel', status: 'running', progress } },
        { path: '/ai-api/chat/jobs/ai-cancel', data: completed('ai-cancel', mocks.mockNoChangeReply) },
        { path: '/ai-api/chat/jobs/ai-cancel', data: completed('ai-cancel', mocks.mockNoChangeReply) },
        { path: '/ai-api/chat/jobs/ai-wrong', data: completed('ai-other', mocks.mockNoChangeReply) },
        { path: '/ai-api/chat/jobs/ai-missing', status: 404, data: { error: '작업을 찾을 수 없어요' } },
    ])
    const controller = new AbortController()
    let jobId
    await assert.rejects(chat.getChatReply('', [new File(['cancel'], '취소.txt')], {
        signal: controller.signal, onJobStarted: id => { jobId = id }, onProgress: () => controller.abort(),
    }), { name: 'AbortError' })
    assert.equal(jobId, 'ai-cancel')
    const resumed = await chat.resumeChatReply(jobId)
    assert.equal((await chat.resumeChatReply(jobId)).analysisId, resumed.analysisId)
    await assert.rejects(chat.resumeChatReply('old-job'), error => chat.isTerminalChatFailure(error))
    await assert.rejects(chat.resumeChatReply('ai-wrong'), /작업 ID/)
    await assert.rejects(chat.resumeChatReply('ai-missing'), /작업을 찾을 수/)
})

test('링크를 정리해 JSON으로 전송하고 URL과 진행 결과를 유지한다', async t => {
    const sourceUrl = 'https://github.com/example/project?tab=readme#intro'
    const reply = { ...mocks.mockLinkAnalysisReply, sourceUrl }
    expectRequests(t, [
        { path: '/ai-api/chat/links', method: 'POST', data: { jobId: 'ai-link', status: 'running', progress }, check: init => {
            const body = JSON.parse(init.body)
            assert.equal(body.url, sourceUrl)
            assert.equal(body.conversationId, 'conversation-1')
            assert.ok(body.requestId)
        } },
        { path: '/ai-api/chat/jobs/ai-link', data: completed('ai-link', reply) },
    ])
    const response = await chat.getLinkReply(` ${sourceUrl} `, { conversationId: 'conversation-1' })
    assert.equal(response.sourceUrl, sourceUrl)
    assert.equal(response.kind, 'link-analysis')
})

test('입력 제한·잘못된 링크·취소·ID 없는 저장은 네트워크 요청 전에 거절한다', async t => {
    expectRequests(t, [])
    await assert.rejects(chat.getChatReply('', []), /텍스트 또는 파일/)
    await assert.rejects(chat.getChatReply('a'.repeat(20001)), /20000자/)
    await assert.rejects(chat.getChatReply('', Array.from({ length: 11 }, () => new File(['a'], 'a.txt'))), /최대 10개/)
    await assert.rejects(chat.getChatReply('', [new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.bin')]), /10MiB/)
    await assert.rejects(chat.getLinkReply('javascript:alert(1)'), /HTTP 또는 HTTPS/)
    await assert.rejects(chat.getChatReply('취소', [], { signal: AbortSignal.abort() }), { name: 'AbortError' })
    for (const card of [mocks.mockTextAnalysisReply, mocks.mockFileAnalysisReply, mocks.mockNoChangeReply, mocks.mockBatchAnalysisReply]) {
        await assert.rejects(records.saveRecord(card, 'activity-1'), /다시 분석/)
    }
    for (const analysisId of [' ', 'a'.repeat(20001)]) await assert.rejects(records.saveRecord({ ...mocks.mockTextAnalysisReply, analysisId }, 'activity-1'), /다시 분석/)
})

test('저장은 초안 ID와 분류·활동 선택만 보내며 중복·잘못된 응답을 거절한다', async t => {
    const card = { ...mocks.mockTextAnalysisReply, analysisId: ' analysis-1 ' }
    const metadata = { name: '새 활동', category: '프로젝트', status: '진행 중', role: '연구', period: { start: '2026-09', end: null }, summary: '설명' }
    expectRequests(t, [
        { path: '/api/activities', data: [{ id: 'activity-1', name: '기존 활동' }] },
        { path: '/api/records', method: 'POST', data: { id: 'record-1', activityId: 'new-1', reply: card }, check: init => {
            assert.deepEqual(JSON.parse(init.body), { newActivity: metadata, analysisId: 'analysis-1', classification: { materialType: card.analysis.materialType } })
            assert.equal(Object.hasOwn(JSON.parse(init.body), 'reply'), false)
        } },
        { path: '/api/records', method: 'POST', status: 409, data: { error: '이미 기록된 분석' } },
        { path: '/api/records', method: 'POST', data: { id: 1 } },
    ])
    assert.equal((await records.getActivities())[0].role, null)
    assert.equal((await records.saveRecord(card, { newActivity: metadata })).activityId, 'new-1')
    await assert.rejects(records.saveRecord(card, 'activity-1'), /이미 기록/)
    await assert.rejects(records.saveRecord(card, 'activity-1'), /기록 응답/)
})

test('활동 수정은 AI 초안 ID만 백엔드에 전달하고 확정 거절을 구분한다', async t => {
    const edit = { id: 'edit', role: 'assistant', kind: 'activity-update', content: '수정 중', analysis: null,
        update: { activityId: 'activity-1', updates: [{ field: 'role', value: '팀장' }] } }
    expectRequests(t, [
        { path: '/ai-api/chat', method: 'POST', data: result(edit) },
        { path: '/api/activities/apply-chat-update', method: 'POST', data: result({ ...mocks.mockGeneralReply, updatedActivityId: 'activity-1' }), check: init => assert.deepEqual(JSON.parse(init.body), { analysisId: 'analysis-1' }) },
        { path: '/ai-api/chat', method: 'POST', data: result(edit) },
        { path: '/api/activities/apply-chat-update', method: 'POST', status: 422, data: { error: '수정 요청 거절' } },
    ])
    const reply = await chat.getChatReply('역할 수정')
    assert.equal(reply.kind, 'general')
    assert.equal(reply.updatedActivityId, 'activity-1')
    await assert.rejects(chat.getChatReply('잘못된 수정'), error => chat.isTerminalChatFailure(error))
})

test('작업 실패·손상 응답·통신 오류를 성공 응답으로 대체하지 않는다', async t => {
    const errors = [
        [{ jobId: 'ai-failed', status: 'failed', error: '분석 작업 실패' }, /분석 작업 실패/],
        [{ jobId: 'ai-pending', status: 'running', progress }, /텍스트 응답이 완료되지/],
        [{}, /응답 형식/],
        [result({ ...mocks.mockGeneralReply, analysis: mocks.mockTextAnalysisReply.analysis }), /응답 형식/],
    ]
    expectRequests(t, [
        ...errors.map(([data]) => ({ path: '/ai-api/chat', method: 'POST', data })),
        { path: '/ai-api/chat', method: 'POST', status: 400, data: { error: '요청 거부' } },
        { path: '/ai-api/chat', method: 'POST', error: new TypeError('offline') },
        { path: '/ai-api/chat', method: 'POST', data: { jobId: 'ai-invalid', status: 'running', progress: { title: '', steps: [] } } },
    ])
    for (const [_data, pattern] of errors) await assert.rejects(chat.getChatReply('입력'), pattern)
    await assert.rejects(chat.getChatReply('입력'), /요청 거부/)
    await assert.rejects(chat.getChatReply('입력'), /연결하지 못했어요/)
    await assert.rejects(chat.getChatReply('', [new File(['x'], 'x.txt')]), /진행 응답 형식/)
})

test('HTTP 응답 시간 제한과 손상된 JSON을 처리한다', async t => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })
    })
    // AbortSignal.timeout은 이벤트 루프를 유지하지 않으므로 검사 동안만 타이머를 둔다.
    const keepAlive = setTimeout(() => {}, 1000)
    try { await assert.rejects(chat.request('/slow', {}, undefined, 5), /응답 시간이 초과/) }
    finally { clearTimeout(keepAlive) }
    globalThis.fetch = async () => new Response('{broken')
    await assert.rejects(chat.getChatReply('입력'), /응답 형식/)
})
