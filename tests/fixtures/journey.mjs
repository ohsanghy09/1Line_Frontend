import { readFileSync } from 'node:fs'

// 저장소 계약 예시에서 출발한 검사 전용 응답. 화면 런타임에서는 사용하지 않는다.
const example = JSON.parse(readFileSync(new URL('../../docs/growth-journey-update/examples/journey-exchange.json', import.meta.url), 'utf8')).publicResponse

export function createMockJourney() {
    const data = structuredClone(example)
    data.events[0].id = 'deployment'
    const capabilityEvidence = [{ recordId: 'record-02', quote: '처음 사용자 인터뷰를 직접 진행하고 기획 역할을 수행했다.' }]
    const performanceEvidence = [{ recordId: 'record-03', quote: '동일 평가 조건에서 테스트 통과율이 70%에서 95%로 개선됐다.' }]
    data.events.push({
        id: 'interview', occurredAt: '2026-09', activity: { id: 'activity-02', name: '사용자 조사' },
        axis: 'planning', title: '새로운 기획 역할과 인터뷰 경험', description: '사용자 인터뷰를 직접 수행했다.',
        growthAssessments: [
            { type: 'capability_expansion', reason: '기획 역할을 직접 수행했다.', evidence: capabilityEvidence },
            { type: 'experience_accumulation', reason: '기록 범위에서 새로운 인터뷰 경험이다.', evidence: capabilityEvidence },
        ],
    }, {
        id: 'performance', occurredAt: '2026-10', activity: { id: 'activity-03', name: '품질 개선' },
        axis: 'backend', title: '테스트 통과율 개선', description: '동일 평가 조건의 결과가 개선됐다.',
        growthAssessments: [{
            type: 'performance_improvement', reason: '같은 평가에서 통과율을 높였다.', evidence: performanceEvidence,
            comparison: { before: '통과율 70%', after: '통과율 95%', condition: '동일 평가 조건', beforeEvidence: performanceEvidence, afterEvidence: performanceEvidence },
        }],
    })
    data.axisOptions.push({ value: 'planning', label: '기획' })
    data.evidenceSources.push(
        { recordId: 'record-02', activityId: 'activity-02', activityName: '사용자 조사' },
        { recordId: 'record-03', activityId: 'activity-03', activityName: '품질 개선' },
    )
    data.badges = [{ id: 'first-interview', label: '기록상 첫 인터뷰', icon: '🌱', evidence: capabilityEvidence }]
    data.analysis.recordCount = 3
    data.analysis.currentRecordCount = 3
    return data
}

export function createEmptyJourney(state = 'unanalyzed') {
    const data = createMockJourney()
    data.events = []
    data.badges = []
    data.axisOptions = [{ value: 'all', label: '전체 분야' }]
    data.evidenceSources = []
    data.summary = { title: '아직 분석이 없어요.', description: '저장된 기록으로 분석해 주세요.' }
    if (state === 'unanalyzed') {
        data.analysis = { id: null, generatedAt: null, stale: false, recordCount: 0, currentRecordCount: 0, model: null, promptVersion: null }
    } else if (state === 'deleted') {
        data.analysis.stale = true
        data.summary = { title: '기록이 삭제됐어요.', description: '남은 기록으로 분석을 갱신해 주세요.' }
    } else {
        data.summary = { title: '판단을 유보했어요.', description: '성장 근거가 부족해요.', evidence: structuredClone(example.summary.evidence) }
        data.evidenceSources = structuredClone(example.evidenceSources)
    }
    return data
}

