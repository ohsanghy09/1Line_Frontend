// 화면용 임시 계약. 실제 AI 응답은 서비스에서 이 구조로 변환한다.
export type JourneyOption = { value: string; label: string }

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
}

export type GrowthJourneyData = {
    source: 'mock' | 'api'
    summary: { title: string; description: string }
    badges: { id: string; label: string }[]
    typeOptions: JourneyOption[]
    axisOptions: JourneyOption[]
    events: JourneyEvent[]
}
