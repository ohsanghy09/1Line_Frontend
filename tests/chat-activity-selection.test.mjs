import assert from 'node:assert/strict'
import test from 'node:test'
import { loadFrontend } from './support/frontend.mjs'
import { componentHarness, settle, textOf } from './support/component-harness.mjs'

const { mockFileAnalysisReply } = await loadFrontend('tests/fixtures/chat.ts')
const chat = await loadFrontend('src/services/chat.ts')
const reply = () => ({ ...structuredClone(mockFileAnalysisReply), analysisId: 'analysis-1', createdAt: 1000 })

async function harness(t, list) {
    const card = reply()
    card.analysis.activity = { name: '연결 미확정', confidence: null, match: 'unresolved', category: null }
    const saved = []
    const window = new EventTarget()
    const h = await componentHarness('src/components/chat/ConnectedChatReplyCard.tsx', {
        window,
        ChatReplyCard: 'ChatReplyCard', ActivityReviewModal: 'ActivityReviewModal', ActivityAnalysisStatus: 'ActivityAnalysisStatus',
        isReply: chat.isReply, request: async () => { throw new Error('예상하지 않은 조회') },
        getActivities: async () => { if (list instanceof Error) throw list; return list },
        saveRecord: async (reply, selection) => {
            saved.push({ reply, selection })
            return { id: 'record-1', activityId: 'selected-activity', reply }
        },
        updateRecord: async () => { throw new Error('예상하지 않은 수정') },
    }, { reply: card, now: 1000 })
    t.after(h.unmount)
    h.render(); await settle(); h.render()
    return { h, saved, window }
}

test('활동 0개·미확정 분류에서 새 이름을 입력해 원본 초안을 새 활동에 저장한다', async t => {
    const { h, saved } = await harness(t, [])
    const card = h.nodes().find(node => node.type === 'ChatReplyCard')
    assert.match(card.props.activityGuidance, /저장된 활동이 없어요/)
    assert.equal(h.nodes().some(node => node.type === 'button' && textOf(node) === '기존 활동에 연결'), false)
    h.nodes().find(node => node.type === 'button' && textOf(node) === '새 활동으로 저장').props.onClick()
    h.render()
    const input = h.nodes().find(node => node.type === 'input')
    input.props.onChange({ target: { value: '새 프로젝트' } })
    h.render()
    h.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await settle()
    assert.equal(saved.length, 1)
    assert.equal(saved[0].selection.newActivity.name, '새 프로젝트')
    assert.equal(saved[0].reply.analysisId, 'analysis-1')
    assert.equal(saved[0].selection.newActivity.category, null)
})

test('기존 활동을 선택하면 명시적인 활동 ID로 저장하고 새 활동을 만들지 않는다', async t => {
    const list = [{ id: 'activity-existing', name: '기존 프로젝트', category: null }]
    const { h, saved } = await harness(t, list)
    h.nodes().find(node => node.type === 'button' && textOf(node) === '기존 활동에 연결').props.onClick()
    await settle(); h.render()
    h.nodes().find(node => node.type === 'select').props.onChange({ target: { value: 'activity-existing' } })
    h.render()
    h.nodes().find(node => node.type === 'form').props.onSubmit({ preventDefault() {} })
    await settle()
    assert.deepEqual(saved[0].selection, { activityId: 'activity-existing' })
})

test('활동 목록 조회 실패를 활동 없음으로 오인하지 않고 재시도 안내를 표시한다', async t => {
    const { h, saved } = await harness(t, new Error('조회 실패'))
    assert.match(h.nodes().find(node => node.type === 'ChatReplyCard').props.activityGuidance, /확인하지 못했어요/)
    assert.ok(h.nodes().find(node => node.type === 'button' && textOf(node) === '기존 활동에 연결'))
    assert.equal(saved.length, 0)
})

test('다른 카드에서 활동이 생성되면 활동 없음 안내와 기존 활동 연결 버튼을 갱신한다', async t => {
    const list = []
    const { h, window } = await harness(t, list)
    list.push({ id: 'new-activity', name: '새 활동', category: null })
    window.dispatchEvent(new Event('1line:activities-changed'))
    await settle(); h.render()
    assert.doesNotMatch(h.nodes().find(node => node.type === 'ChatReplyCard').props.activityGuidance, /저장된 활동이 없어요/)
    assert.ok(h.nodes().find(node => node.type === 'button' && textOf(node) === '기존 활동에 연결'))
})
