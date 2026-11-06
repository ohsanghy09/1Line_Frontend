// 나의 발자국 목록에 필요한 표시 데이터. 실제 API 연결 시 서비스에서 이 구조로 변환한다.
export type FootprintActivity = {
    metadataAnalysis?: import('./activity').ActivityAnalysis
    id: string
    title: string
    category: string
    status: '진행 중' | '완료' | '미설정'
    role: string
    period: string
    summary: string
    materialsCount: number
    recordsCount?: number
    // 실제 저장 시각을 서비스에서 표시용으로 변환한다.
    updatedAtLabel: string
    // 정렬용 ISO 시각. 아직 저장 기록이 없는 활동은 빈 문자열이다.
    updatedAt: string
}

export type FootprintFilters = {
    search: string
    category: string
    status: 'all' | '진행 중' | '완료'
    sort: 'recent' | 'materials' | 'oldest'
}

// 상세 조회는 목록 정보와 해당 활동의 폴더·자료를 함께 반환한다.
export type FootprintFile = {
    id: string
    name: string
    type: string
    uploadedAtLabel: string
    summary: string
    version?: string
    sourceUrl?: string | null
    summaryScope?: 'record'
}

export type FootprintFolder = {
    id: string
    name: string
    // DB 조회에서는 실제 폴더 내 자료 수다. 독립 목 예시는 표시용 총계일 수 있다.
    materialsCount: number
    files: FootprintFile[]
}

export type FootprintActivityDetail = FootprintActivity & {
    folders: FootprintFolder[]
    timeline: FootprintTimelineEvent[]
}

type TimelineEventBase = {
    id: string
    dateLabel: string
    occurredAt: string
    title: string
    evidenceFileIds: string[]
    evidenceLabels?: string[]
    // 주요 변화와 Turning Point는 별개다. 일반 변화에도 비교 내용이 있을 수 있다.
    change?: { before: string; after: string }
}

// 변화가 없는 일반 이벤트에는 Before/After를 요구하거나 생성하지 않는다.
export type FootprintTimelineEvent = TimelineEventBase & (
    | { isTurningPoint: false; description: string }
    | { isTurningPoint: true; before: string; after: string; reason: string }
)

export type FootprintFileDetail = {
    activityId: string
    file: FootprintFile
    events: FootprintTimelineEvent[]
    versionHistory: { fileId: string; version: string }[]
}
