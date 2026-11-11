// 프론트 HTTP 응답 검증 전용이다. 서버 검색·저장 로직을 재현하지 않는다.
export const timestamp = '2026-11-04T05:32:00.000Z'
export const activity = (overrides = {}) => ({
    id: 'activity/1', title: '테스트 활동', category: '프로젝트', status: '미설정',
    role: '미설정', period: '', summary: '', materialsCount: 0, updatedAt: null, ...overrides,
})
export const file = (overrides = {}) => ({
    id: 'file/1', name: '내 자료.txt', type: '회의록', summary: '자료 요약',
    summaryScope: 'record', uploadedAt: timestamp, ...overrides,
})
export const event = (overrides = {}) => ({
    id: 'event-1', title: '자료 기록', occurredAt: timestamp, evidenceFileIds: ['file/1'],
    isTurningPoint: false, description: '변화 기록', ...overrides,
})
