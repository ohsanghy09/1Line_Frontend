import assert from 'node:assert/strict'
import test from 'node:test'
import { componentHarness, settle, textOf } from './support/component-harness.mjs'
import { loadFrontend } from './support/frontend.mjs'
import { createMockJourney } from './fixtures/journey.mjs'

test('분석 ready여도 빈 활동 정보를 모두 확인했다고 표시하지 않고 미설정 항목을 구분한다', async t => {
    const h = await componentHarness('src/components/ActivityAnalysisStatus.tsx', {
        window: new EventTarget(),
        getActivityAnalysis: async () => ({ status: 'ready', stale: false, error: null, updatedAt: null }),
        retryActivityAnalysis: async () => {},
    }, { activityId: 'activity-1', metadata: { summary: '등록된 요약', status: '미설정', period: '', role: '미설정' } })
    t.after(h.unmount)
    h.render(); await settle()
    let text = textOf(h.render())
    assert.match(text, /상태·기간·역할 항목은 아직 미설정/)
    assert.doesNotMatch(text, /모두|확인했어요|요약·상태·기간·역할이 등록/)
    text = textOf(h.render({ activityId: 'activity-1', metadata: { summary: '등록된 요약', status: '완료', role: '개발', period: '2026-11' } }))
    assert.match(text, /요약·상태·기간·역할이 등록/)
    text = textOf(h.render({ activityId: 'activity-1' }))
    assert.match(text, /활동 상세에서 확인/)
    assert.doesNotMatch(text, /요약·상태·기간·역할이 등록/)
})

test('Journey stale 상태는 이전 분석 수와 현재 기록 수를 구분한다', async t => {
    const data = createMockJourney()
    data.analysis.stale = true
    data.analysis.recordCount = 1
    data.analysis.currentRecordCount = 3
    const types = await loadFrontend('src/types/journey.ts')
    const h = await componentHarness('src/pages/GrowthJourney.tsx', {
        Sparkles: 'i', JourneyEventCard: 'JourneyEventCard', JOURNEY_TYPE_OPTIONS: types.JOURNEY_TYPE_OPTIONS,
        getGrowthJourney: async () => data, generateGrowthJourney: async () => data,
        filterJourneyEvents: events => events, journeyTypeIcon: () => '',
    }, {})
    t.after(h.unmount)
    h.render(); await settle()
    const text = textOf(h.render())
    assert.match(text, /이전 분석 기준: 확정 기록 1개/)
    assert.match(text, /현재 확정 기록은 3개/)
    assert.match(text, /최신 기록을 반영하지 않았어요/)
})

test('동일 파일명과 같은 저장 시각이어도 자료 순번·요약을 구분하고 선택은 ID를 사용한다', async t => {
    const selected = []
    const h = await componentHarness('src/components/footprints/ActivityFolders.tsx', {
        ChevronDown: 'i', FileText: 'i', FolderOpen: 'i',
    }, {
        folders: [{ id: 'folder', name: '자료', materialsCount: 2, files: [
            { id: 'first', name: '보고서.txt', type: '보고서', uploadedAtLabel: '같은 시각', summary: '기존 내용', summaryScope: 'record' },
            { id: 'second', name: '보고서.txt', type: '보고서', uploadedAtLabel: '같은 시각', summary: '수정 내용', summaryScope: 'record' },
        ] }],
        onSelectFile: id => selected.push(id),
    })
    t.after(h.unmount)
    const text = textOf(h.render())
    assert.match(text, /같은 이름의 자료 1\/2/)
    assert.match(text, /같은 이름의 자료 2\/2/)
    assert.match(text, /기록 요약: 기존 내용/)
    assert.match(text, /기록 요약: 수정 내용/)
    const buttons = h.nodes().filter(node => node.type === 'button' && node.props['aria-haspopup'] === 'dialog')
    buttons[1].props.onClick()
    assert.deepEqual(selected, ['second'])
})
