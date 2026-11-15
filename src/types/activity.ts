// 활동 전체 정보 분석의 저장 상태. 상태 조회는 AI 모델 호출과 구분한다.
export type ActivityAnalysis = {
    status: 'idle' | 'queued' | 'running' | 'ready' | 'failed'
    error: string | null
    updatedAt: string | null
    stale: boolean
}
