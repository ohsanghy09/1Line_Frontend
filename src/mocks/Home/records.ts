// 홈의 최근 추가된 기록에서 사용하는 데이터 형식
export type RecentRecord = {
    id: string
    title: string
    meta: string
    time: string
    icon: 'file-text' | 'message-square'
}

// 원본 HTML의 최근 추가된 기록 목데이터
export const mockRecentRecords: RecentRecord[] = [
    {
        id: 'wireframe-v2',
        title: 'wireframe_v2.pdf',
        meta: '1호선톤 · 와이어프레임',
        time: '오늘 14:32',
        icon: 'file-text',
    },
    {
        id: 'segmentation',
        title: 'segmentation.pdf',
        meta: '컴퓨터비전 · 강의자료',
        time: '어제 18:20',
        icon: 'file-text',
    },
    {
        id: 'ai-planning-chat',
        title: 'AI 기획 대화 기록',
        meta: '1호선톤 · AI 대화 기록',
        time: '2일 전',
        icon: 'message-square',
    },
]
