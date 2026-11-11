// 프론트 필터·응답 검사 전용 데이터다. 서버 폴더와 독립적으로 관리한다.
// 원본 HTML의 화면 확인용 예시다. 실제 DB 활동·AI 분석 결과와 연결하지 않는다.
const mockGrowthJourney = {
    source: 'api',
    summary: {
        title: '서비스 기획 경험 → 사용자 중심 기획 → MVP 기준 설정 → PM 역할 확장',
        description: '최근 활동 기록을 기반으로 반복적으로 나타난 변화 흐름이에요. 프로젝트의 질적 향상이 지속적으로 관찰되고 있습니다.',
    },
    // 첫 경험 여부를 계산한 결과가 아닌 원본의 예시 배지다.
    badges: [
        { id: 'first-pm', label: '🌱 첫 PM' },
        { id: 'first-interview', label: '💬 첫 사용자 인터뷰' },
        { id: 'first-deployment', label: '🚀 첫 배포' },
        { id: 'first-hackathon', label: '🏆 첫 연합해커톤' },
    ],
    // 원본의 표시 분류를 유지한다. 정식 AI 성장 유형 enum은 아직 확정하지 않았다.
    typeOptions: [
        { value: 'all', label: '전체' },
        { value: 'ability', label: '🧩 능력 확장' },
        { value: 'achievement', label: '🏆 성과 향상' },
        { value: 'experience', label: '🌱 경험 축적' },
        { value: 'efficiency', label: '⚡ 효율성' },
        { value: 'transfer', label: '🔁 경험 전이' },
    ],
    axisOptions: [
        { value: 'all', label: '전체 분야' },
        { value: 'planning', label: '기획 / PM' },
        { value: 'technology', label: 'AI·기술' },
        { value: 'data', label: '데이터' },
        { value: 'collaboration', label: '발표·협업' },
    ],
    // 예시 시각을 유지하고 실제 활동/자료 ID는 추측하지 않는다. 같은 달은 배열 순서를 유지한다.
    events: [
        {
            id: 'first-planning', occurredAt: '2025-05',
            activity: { id: null, name: 'Scent Orbit' }, type: 'experience', axis: 'planning',
            title: '첫 서비스 기획 경험',
            description: '초기 요구사항 정의서를 작성하며 화면 단위의 기능 기획을 처음 수행함.',
        },
        {
            id: 'user-centered-planning', occurredAt: '2025-09',
            activity: { id: null, name: 'Scent Orbit' }, type: 'ability', axis: 'planning',
            title: '사용자 관점 기획 범위 확장',
            description: '개발 중심 기획에서 벗어나 실제 타겟 유저 인터뷰 결과를 반영한 와이어프레임 설계.',
            // 상세 펼침 확인용 예시다. 실제 DB 자료나 파일 ID와 연결하지 않는다.
            comparison: {
                before: '개발 중심의 기능 기획',
                after: '사용자 인터뷰를 반영한 기획',
                evidence: ['인터뷰 기록', '와이어프레임'],
            },
        },
        {
            id: 'planning-transfer', occurredAt: '2026-03',
            activity: { id: null, name: '1호선톤' }, type: 'transfer', axis: 'planning',
            title: '이전 프로젝트 경험을 새로운 프로젝트 기획에 반영',
            description: 'Scent Orbit에서 경험한 오버스펙 문제를 방지하기 위해 1호선톤에서 초기에 핵심 기능 3개만 빠르게 검증하는 전략을 취함.',
        },
        {
            id: 'data-modeling', occurredAt: '2026-08',
            activity: { id: null, name: 'AI 분석 공모전' }, type: 'achievement', axis: 'technology',
            title: '데이터 모델링을 통한 결과물 질적 향상',
            description: '전공 수업에서 배운 비전 및 데이터 시각화 라이브러리를 공모전 분석 리포트에 적용.',
        },
        {
            id: 'pm-expansion', occurredAt: '2026-10',
            activity: { id: null, name: '1호선톤' }, type: 'ability', axis: 'planning',
            title: 'PM 역할 수행 및 팀 프로세스 수립',
            description: '이전 프로젝트에서는 기획서 작성에 집중했지만, 이번 1호선톤에서는 팀 전체의 데드라인과 개발자-디자이너 간 이슈 싱크업을 주도함.',
            // 상세 펼침에 사용할 원본 근거이며 실제 파일 ID 연결은 없다.
            comparison: { before: '기획 담당', after: 'PM + 기획', evidence: ['회의록', '역할분담표'] },
        },
    ],
}

// 매 요청에 독립된 예시 응답을 제공한다. 실제 DB와 AI는 사용하지 않는다.
export function createMockJourney() { return structuredClone(mockGrowthJourney) }

