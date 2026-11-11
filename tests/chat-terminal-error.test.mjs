import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

const source = stripTypeScriptTypes(readFileSync(new URL('../src/services/chat.ts', import.meta.url), 'utf8'))
const chat = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

test('이전 작업은 서버 요청 전에 복원 실패로 확정해 대기 작업을 해제할 수 있다', async () => {
    const originalFetch = globalThis.fetch
    let requests = 0
    try {
        globalThis.fetch = async () => { requests += 1; throw new Error('Unexpected request') }
        await assert.rejects(chat.resumeChatReply('legacy-job'), error => {
            assert.equal(chat.isTerminalChatFailure(error), true)
            assert.equal(error.jobId, 'legacy-job')
            assert.match(error.message, /이전 분석 작업을 복원할 수 없어요/)
            return true
        })
        assert.equal(requests, 0)
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('AI 작업 복원과 진행 재조회는 AI 서버에서 완료 결과를 받는다', async () => {
    const originalFetch = globalThis.fetch
    const requests = []
    try {
        globalThis.fetch = async path => {
            requests.push(path)
            if (requests.length === 1) return Response.json({
                jobId: 'ai-running', status: 'running',
                progress: { title: '분석 중', steps: [{ label: '분석', status: 'working' }] },
            })
            return Response.json({
                jobId: 'ai-running', status: 'completed',
                result: { analysisId: 'draft-1', conversationId: 'conversation-1',
                    reply: { id: 'reply-1', role: 'assistant', kind: 'general', content: '완료', analysis: null } },
            })
        }
        const reply = await chat.resumeChatReply('ai-running')
        assert.deepEqual(requests, ['/ai-api/chat/jobs/ai-running', '/ai-api/chat/jobs/ai-running'])
        assert.equal(reply.analysisId, 'draft-1')
        assert.equal(reply.content, '완료')
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('완료된 실패 작업은 통신 실패와 구분해 다음 전송을 허용할 수 있다', async () => {
    const originalFetch = globalThis.fetch
    try {
        globalThis.fetch = async () => Response.json({ jobId: 'ai-failed', status: 'failed',
            error: 'OpenAI 서버에 연결하지 못했어요.', code: 'openai_connection' })
        await assert.rejects(chat.resumeChatReply('ai-failed'), error => {
            assert.equal(chat.isTerminalChatFailure(error), true)
            assert.equal(error.code, 'openai_connection')
            assert.equal(error.jobId, 'ai-failed')
            return true
        })
        globalThis.fetch = async () => { throw new TypeError('offline') }
        await assert.rejects(chat.resumeChatReply('ai-running'), error => {
            assert.equal(chat.isTerminalChatFailure(error), false)
            return true
        })
        assert.equal(chat.isTerminalChatFailure(AbortSignal.abort().reason), false)
    } finally {
        globalThis.fetch = originalFetch
    }
})
