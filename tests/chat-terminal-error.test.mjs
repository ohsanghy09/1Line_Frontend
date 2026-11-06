import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'

const source = stripTypeScriptTypes(readFileSync(new URL('../src/services/chat.ts', import.meta.url), 'utf8'))
const chat = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

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
