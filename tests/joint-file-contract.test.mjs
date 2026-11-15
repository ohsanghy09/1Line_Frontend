import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { loadFrontend, expectRequests } from './support/frontend.mjs'
import { componentHarness, settle } from './support/component-harness.mjs'
import { file, event } from './fixtures/archive.mjs'

const exchange = JSON.parse(await readFile(new URL('../docs/integration-test-fixes/examples/joint-file-exchange.json', import.meta.url), 'utf8'))
const chat = await loadFrontend('src/services/chat.ts')
const records = await loadFrontend('src/services/records.ts')
const footprints = await loadFrontend('src/services/footprints.ts')
const card = () => ({ ...structuredClone(exchange.publication.reply), analysisId: 'analysis-1', createdAt: 1000 })

test('공동 JSON 예시의 중복 결과를 수용하고 손상된 순서·범위·참조·저장 상태는 거절한다', () => {
    assert.equal(chat.isReply(card()), true)
    for (const change of [
        value => { value.deduplication.files[0].inputIndex = 1 },
        value => { value.deduplication.files.pop() },
        value => { value.deduplication.saveBlocked = true },
        value => { value.deduplication.sha256 = 'private' },
        value => { value.deduplication.files[0].duplicateOfInputIndex = 1 },
        value => { value.deduplication.activityId = 'activity-1' },
    ]) {
        const value = card(); change(value)
        assert.equal(chat.isReply(value), false)
    }
})

test('저장 중 새로 발견한 중복의 코드·자료 순번을 보존하고 성공 이벤트를 보내지 않는다', async t => {
    expectRequests(t, [{ path: '/api/records', method: 'POST', status: 409, data: {
        code: 'duplicate_files', error: '중복 자료가 있어요.', duplicates: [{ inputIndex: 0, matches: [] }],
    } }])
    await assert.rejects(records.saveRecord(card(), 'activity-1'), error => error.code === 'duplicate_files'
        && error.status === 409 && error.duplicates[0].inputIndex === 0)
})

test('중복으로 차단된 카드도 다른 활동으로 변경한 뒤 저장할 수 있다', async t => {
    const initial = card()
    initial.analysis.activity = { id: 'activity-1', name: '기존 활동', match: 'existing', confidence: null }
    initial.deduplication = {
        schemaVersion: 'file-dedup-v1', activityId: 'activity-1', saveBlocked: true,
        files: [
            { inputIndex: 0, status: 'duplicate', matches: [{ activityId: 'activity-1', recordId: 'old', fileId: 'old-file' }] },
            { inputIndex: 1, status: 'new', matches: [] },
        ],
    }
    const saved = []
    const h = await componentHarness('src/components/chat/ConnectedChatReplyCard.tsx', {
        window: new EventTarget(), ChatReplyCard: 'Card', ActivityReviewModal: 'Review', ActivityAnalysisStatus: 'Status',
        getActivities: async () => [{ id: 'activity-1', name: '기존 활동' }, { id: 'activity-2', name: '다른 활동' }],
        isReply: chat.isReply, request: async () => {}, updateRecord: async () => {},
        saveRecord: async (reply, selection) => { saved.push(selection); return { id: 'record', activityId: 'activity-2', reply } },
    }, { reply: initial, now: 1000 })
    t.after(h.unmount)
    h.render()
    const current = () => h.nodes().find(node => node.type === 'Card')
    assert.equal(current().props.actions.blocked, true)
    current().props.actions.onSave(); await settle()
    assert.equal(saved.length, 0)
    current().props.actions.onEdit(); await settle(); h.render()
    h.nodes().find(node => node.type === 'Review').props.onSubmit({ activityId: 'activity-2' }, initial.analysis.materialType)
    await settle(); h.render()
    assert.equal(current().props.reply.deduplication, undefined)
    assert.equal(current().props.actions.blocked, false)
    current().props.actions.onSave(); await settle()
    assert.equal(saved[0].activityId, 'activity-2')
})

test('삭제 후 파일 ID와 원문 인용을 유지하고 다른 자료를 가리키는 근거는 거절한다', async t => {
    const detail = { activityId: 'activity/1', file: file(), versionHistory: [], events: [event({
        changeEvidence: { before: [{ fileId: 'file/1', quote: '원문 이전' }], after: [{ fileId: 'file/1', quote: '원문 이후' }] },
    })] }
    const invalid = structuredClone(detail); invalid.events[0].changeEvidence.after[0].fileId = 'deleted-file'
    expectRequests(t, [detail, invalid].map(data => ({ path: '/api/archive/activities/activity%2F1/materials/file%2F1', data })))
    const result = await footprints.getFootprintFile('activity/1', 'file/1')
    assert.equal(result.events[0].changeEvidence.after[0].quote, '원문 이후')
    await assert.rejects(footprints.getFootprintFile('activity/1', 'file/1'), /응답 형식/)
})
