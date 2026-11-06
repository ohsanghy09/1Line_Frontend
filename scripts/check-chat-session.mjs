import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

const source = path => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'))
const url = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const chatUrl = url(source('../src/services/chat.ts'))
const session = await import(url(source('../src/utils/chatSession.ts').replace("from '../services/chat'", `from '${chatUrl}'`)))
const mocks = await import(url(source('../tests/fixtures/chat.ts')))
const data = new Map()
const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
globalThis.window = { sessionStorage: storage }

const snapshot = {
    version: 1, conversationId: 'same-tab', greetingCreatedAt: 1000, pending: false,
    messages: [
        { id: 'user-1', role: 'user', content: '회의 자료', createdAt: 2000, attachments: [{ id: 'file-1', name: '회의록.pdf', size: 123 }] },
        { ...mocks.mockFileAnalysisReply, createdAt: 3000, recordId: 'saved-1', activityId: 'computer-vision', analysisId: 'analysis-1' },
    ],
}
assert.equal(session.readChatSession(), null)
assert.equal(session.writeChatSession(snapshot), true)
assert.deepEqual(session.readChatSession(), snapshot)
assert.equal(session.readChatSession().messages[1].recordId, 'saved-1')
// 확장된 새 활동 후보도 확인 전 상태로 보관하며 잘못된 날짜는 복원하지 않는다.
const proposedSession = structuredClone(snapshot)
proposedSession.messages[1].analysis.activity = {
    name: '새 연구 활동', confidence: 'medium', id: null, match: 'new', category: '프로젝트',
    status: '진행 중', role: null, period: { start: '2026-09', end: null }, summary: null,
}
session.writeChatSession(proposedSession)
assert.deepEqual(session.readChatSession(), proposedSession)
proposedSession.messages[1].analysis.activity.period.start = '2026-02-30'
session.writeChatSession(proposedSession)
assert.equal(session.readChatSession(), null)
// 다시 읽어도 변경된 분류·정확한 시각·첨부 표시 정보가 유지된다.
const changed = structuredClone(snapshot)
changed.messages[1].analysis.materialType = '회의록'
changed.messages[1].analysis.activity.name = '컴퓨터비전'
changed.pending = true
changed.pendingJob = { jobId: 'job-1', userMessageId: 'user-1' }
session.writeChatSession(changed)
assert.deepEqual(session.readChatSession(), changed)
const received = { ...snapshot.messages[1], id: 'completed-reply' }
const once = session.appendChatReply([snapshot.messages[0]], received)
const twice = session.appendChatReply(once, { ...received, id: 'duplicate-id' })
assert.equal(twice.length, 2)
assert.equal(twice, once)
const linkSnapshot = structuredClone(snapshot)
linkSnapshot.messages.push({ ...mocks.mockLinkAnalysisReply, sourceUrl: 'https://example.com/자료', createdAt: 4000, recordId: 'saved-link' })
session.writeChatSession(linkSnapshot)
assert.deepEqual(session.readChatSession(), linkSnapshot)
linkSnapshot.messages.at(-1).sourceUrl = 'javascript:alert(1)'
session.writeChatSession(linkSnapshot)
assert.equal(session.readChatSession(), null)
storage.setItem(session.CHAT_SESSION_KEY, JSON.stringify({ ...snapshot, pendingJob: { jobId: 'job-1', userMessageId: 'missing-user' } }))
assert.equal(session.readChatSession(), null)
for (const invalid of ['{bad json', JSON.stringify({ ...snapshot, version: 99 }), JSON.stringify({ ...snapshot, messages: [{ ...snapshot.messages[0], attachments: [{}] }] }), JSON.stringify({ ...snapshot, messages: [{ ...snapshot.messages[1], recordId: 123 }] })]) {
    storage.setItem(session.CHAT_SESSION_KEY, invalid)
    assert.equal(session.readChatSession(), null)
}
session.writeChatSession({ ...snapshot, conversationId: 'reset-tab', messages: [], pending: false })
assert.equal(session.readChatSession().messages.length, 0)
assert.equal(session.readChatSession().conversationId, 'reset-tab')
window.sessionStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') } }
assert.equal(session.readChatSession(), null)
assert.equal(session.writeChatSession(snapshot), false)
delete globalThis.window
assert.equal(session.readChatSession(), null)
console.log('PASS: 채팅 세션 복원·카드 저장/수정값·첨부·시각·초기화·손상/접근제한 처리')
