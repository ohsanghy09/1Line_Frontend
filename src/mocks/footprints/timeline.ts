import type { FootprintTimelineEvent } from '../../types/footprints'

// 원본의 1호선톤 이벤트만 옮긴 목 응답이다. 다른 활동에 같은 변화를 복제하지 않는다.
// 정렬용 시각은 원본 날짜에 2026년을 적용했고 NOW는 목 기준일 11월 4일로 정했다.
export const mockFootprintTimeline: Record<string, FootprintTimelineEvent[]> = {
    'line1-hackathon': [
        {
            id: 'line1-idea-selection', dateLabel: '10/23', occurredAt: '2026-10-23T00:00:00+09:00',
            title: '아이디어 후보 3개 선정', isTurningPoint: false,
            description: '팀 회의를 통해 성장의 과정 기록 서비스 아이디어 채택.', evidenceFileIds: [],
        },
        {
            id: 'line1-service-direction', dateLabel: '10/25', occurredAt: '2026-10-25T00:00:00+09:00',
            title: '서비스 방향 확정', isTurningPoint: true,
            before: '일반적인 성장 결과 리포트 작성 서비스',
            after: '실제 제출 자료 기반의 경험 연결 및 자동 변화 발견',
            reason: '단순한 결과 요약보다 AI가 실제 자료에서 변화 근거를 직접 찾아주는 것이 핵심 가치라고 판단함.',
            evidenceFileIds: ['line1-service-planning-v1'],
        },
        {
            id: 'line1-record-input-ux', dateLabel: '10/26', occurredAt: '2026-10-26T00:00:00+09:00',
            title: '기록 입력 UX 변경', isTurningPoint: true,
            before: '프로젝트를 먼저 생성한 후 파일을 개별 업로드하는 방식',
            after: '자료/텍스트를 먼저 입력하면 AI가 활동을 자동 분류하는 Upload-First 방식',
            reason: '사용자의 초기 입력 부담을 최소화하기 위해 Ask Only When Needed 원칙을 적용함.',
            evidenceFileIds: ['line1-wireframe-v2'],
        },
        {
            id: 'line1-growth-journey', dateLabel: '10/27', occurredAt: '2026-10-27T00:00:00+09:00',
            title: 'Growth Journey 구성 구체화', isTurningPoint: false,
            description: '시간 흐름에 따른 사용자 성장을 확인할 수 있도록 Growth Journey 구성을 구체화.', evidenceFileIds: [],
        },
        {
            id: 'line1-current-design', dateLabel: 'NOW', occurredAt: '2026-11-04T00:00:00+09:00',
            title: '상세기획 및 디자인 진행 중', isTurningPoint: false,
            description: '해커톤 발표용 완성 프로토타입 제작 중.', evidenceFileIds: [],
        },
    ],
}

// 파일명 추측 대신 명시적인 자료 ID로 연결한 목 버전 관계다.
// final_ui.fig는 별도 자료이므로 와이어프레임 버전 체인에 억지로 넣지 않는다.
export const mockFootprintVersionGroups = [
    { activityId: 'line1-hackathon', fileIds: ['line1-wireframe-v1', 'line1-wireframe-v2'] },
]
