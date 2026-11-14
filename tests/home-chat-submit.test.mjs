import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { transformWithOxc } from 'vite'
import { loadFrontend } from './support/frontend.mjs'

const chat = await loadFrontend('src/services/chat.ts')
const { code } = await transformWithOxc(await readFile(new URL('../src/pages/Home.tsx', import.meta.url), 'utf8'), 'Home.tsx')
const start = code.indexOf('async function sendChatMessage(')
const end = code.indexOf('function handleResetChat(', start)
assert.ok(start >= 0 && end > start)
// 실제 전송 함수를 실행한다. UI 상태와 네트워크 경계만 대역으로 주입한다.
const source = code.slice(start, end)

function harness(files, request) {
    const state = { messages: [], input: '전송할 내용', files: files.map(file => ({ file })), error: '', pendingJob: null, requests: 0 }
    const set = key => next => { state[key] = typeof next === 'function' ? next(state[key]) : next }
    const env = {
        pendingRequestRef: { current: false }, pendingJob: null, requestIdRef: { current: 0 },
        requestControllerRef: { current: null }, conversationIdRef: { current: 'conversation-1' },
        getChatValidationError: chat.getChatValidationError, getLinkValidationError: chat.getLinkValidationError,
        isTerminalChatFailure: chat.isTerminalChatFailure,
        setReplyError: set('error'), setMessages: set('messages'), setChatInput: set('input'), setPendingFiles: set('files'),
        setPendingJob: set('pendingJob'), setIsReplying() {}, setAnalysisProgress() {},
        appendChatReply: (messages, reply) => [...messages, reply],
        getChatReply: async (...args) => { state.requests++; return request(...args) },
        getLinkReply: async (...args) => { state.requests++; return request(...args) },
    }
    return { state, send: new Function(...Object.keys(env), `${source}; return sendChatMessage`)(...Object.values(env)) }
}

test('합계 용량 초과는 말풍선·입력·첨부 변경이나 네트워크 요청 전에 차단한다', async () => {
    const files = Array.from({ length: 3 }, (_, i) => new File([new Uint8Array(9 * 1024 * 1024)], `${i}.txt`))
    const { state, send } = harness(files, () => { throw new Error('호출되면 안 됨') })
    const originalFiles = state.files
    await send(state.input, files)
    assert.equal(state.requests, 0)
    assert.deepEqual(state.messages, [])
    assert.equal(state.input, '전송할 내용')
    assert.equal(state.files, originalFiles)
    assert.match(state.error, /합계.*25MiB/)
})

test('서버 접수 전 확정 거절은 말풍선을 제거하고 원본 입력·첨부를 복원한다', async () => {
    const files = [new File(['내용'], 'report.txt')]
    const { state, send } = harness(files, async () => { throw Object.assign(new Error('요청 거절'), { status: 413 }) })
    await send(state.input, files)
    assert.equal(state.requests, 1)
    assert.deepEqual(state.messages, [])
    assert.equal(state.input, '전송할 내용')
    assert.equal(state.files[0].file, files[0])
})

test('접수된 작업의 폴링 502는 작업 ID와 말풍선을 유지하고 재업로드하지 않는다', async () => {
    const files = [new File(['내용'], 'report.txt')]
    const { state, send } = harness(files, async (_message, _files, options) => {
        options.onJobStarted('ai-pending')
        throw Object.assign(new Error('AI 서버 일시 오류'), { status: 502 })
    })
    await send(state.input, files)
    assert.equal(state.requests, 1)
    assert.equal(state.messages.length, 1)
    assert.equal(state.pendingJob.jobId, 'ai-pending')
    assert.equal(state.pendingJob.userMessageId, state.messages[0].id)
    assert.deepEqual(state.files, [])
})

test('확정 실패 시에는 새로 작성한 입력을 보존하고 실패한 첨부를 다시 전송할 수 있게 한다', async () => {
    const files = [new File(['내용'], 'report.txt')]
    let h
    h = harness(files, async (_message, _files, options) => {
        options.onJobStarted('ai-failed')
        h.state.input = '새로 작성한 내용'
        throw Object.assign(new Error('분석 실패'), { terminalChatJob: true })
    })
    await h.send(h.state.input, files)
    assert.equal(h.state.pendingJob, null)
    assert.equal(h.state.input, '새로 작성한 내용')
    assert.equal(h.state.files[0].file, files[0])
})
