// 홈의 최근 활동 카드에서 사용하는 데이터 형식 타입 설정
export type RecentActivity = {
    id: string
    title: string
    category: string
    status: '진행 중' | '완료'
    summary: string
    materialsCount: number
    updatedAt: string
}

// 원본 HTML의 최근 활동 카드 3개에서 표시하는 목데이터
export const mockRecentActivities: RecentActivity[] = [
    {
        id: 'line1-hackathon',
        title: '1호선톤',
        category: '해커톤',
        status: '진행 중',
        summary: 'AI 기반 개인 성장 아카이브 서비스를 기획하고 개발하고 있는 연합 해커톤 프로젝트',
        materialsCount: 14,
        updatedAt: '오늘 14:32',
    },
    {
        id: 'computer-vision',
        title: '컴퓨터비전',
        category: '전공수업',
        status: '진행 중',
        summary: 'CNN과 이미지 분석 관련 원리를 학습하고 실습 과제를 진행하는 전공수업',
        materialsCount: 8,
        updatedAt: '어제 18:20',
    },
    {
        id: 'scent-orbit',
        title: 'Scent Orbit',
        category: '프로젝트',
        status: '완료',
        summary: '사용자 취향 기반 향수 추천 및 노트 분석 웹서비스 프로젝트',
        materialsCount: 18,
        updatedAt: '2025.06.30',
    },
]
