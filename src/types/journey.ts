// 백엔드에 저장한 실제 성장 분석 결과와 조회 상태.
export type JourneyOption = { value: string; label: string; icon?: string }
export type JourneyEvidence = { recordId: string; quote: string }

export type JourneyEvent = {
    id: string
    // 월 단위 정밀도를 보존한다. 실제 일자를 임의로 보충하지 않는다.
    occurredAt: string
    activity: { id: string | null; name: string }
    type: string
    axis: string
    title: string
    description: string
    comparison?: { before: string; after: string; evidence: string[] }
    evidence?: JourneyEvidence[]
}

export type GrowthJourneyData = {
    source: 'api'
    summary: { title: string; description: string; evidence?: JourneyEvidence[] }
    badges: { id: string; label: string; icon?: string; evidence?: JourneyEvidence[] }[]
    typeOptions: JourneyOption[]
    axisOptions: JourneyOption[]
    events: JourneyEvent[]
    analysis?: {
        id: string | null; generatedAt: string | null; stale: boolean
        recordCount: number; currentRecordCount: number
        model: string | null; promptVersion: string | null
    }
}
