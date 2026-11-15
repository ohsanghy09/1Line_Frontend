// Growth Journey v2. 공개 결과는 Spring이 검증·저장한 값이다.
export const JOURNEY_SCHEMA_VERSION = 'journey-result-v2'
export const JOURNEY_CRITERIA_VERSION = 'growth-criteria-v1'
export const JOURNEY_TYPE_OPTIONS = [
    { value: 'all', label: '전체' },
    { value: 'capability_expansion', label: '능력 확장' },
    { value: 'performance_improvement', label: '성과 향상' },
    { value: 'experience_accumulation', label: '경험 축적' },
    { value: 'efficiency_improvement', label: '효율성' },
    { value: 'experience_transfer', label: '경험 전이' },
] as const
export type GrowthType = Exclude<typeof JOURNEY_TYPE_OPTIONS[number]['value'], 'all'>
export type JourneyTypeFilter = GrowthType | 'all'
export type JourneyOption = { value: string; label: string }
export type JourneyEvidence = { recordId: string; quote: string }
export type JourneyEvidenceSource = { recordId: string; activityId: string; activityName: string }
export type JourneyComparison = {
    before: string; after: string; condition: string
    beforeEvidence: JourneyEvidence[]; afterEvidence: JourneyEvidence[]
}
export type JourneyTransfer = {
    sourceActivity: { id: string | null; name: string }
    experience: string; targetActivityId: string; application: string
    sourceEvidence: JourneyEvidence[]; applicationEvidence: JourneyEvidence[]
}
type AssessmentBase = { reason: string; evidence: JourneyEvidence[] }
export type GrowthAssessment = AssessmentBase & (
    | { type: 'performance_improvement' | 'efficiency_improvement'; comparison: JourneyComparison; transfer?: never }
    | { type: 'experience_transfer'; transfer: JourneyTransfer; comparison?: JourneyComparison }
    | { type: 'capability_expansion' | 'experience_accumulation'; comparison?: JourneyComparison; transfer?: never }
)
export type JourneyEvent = {
    id: string
    // 월 단위 정밀도를 유지한다. 근거 저장 시각의 UTC 월이며 실제 경험 일자가 아니다.
    occurredAt: string
    activity: { id: string; name: string }
    axis: string; title: string; description: string
    growthAssessments: GrowthAssessment[]
}
export type GrowthJourneyData = {
    schemaVersion: typeof JOURNEY_SCHEMA_VERSION
    criteriaVersion: typeof JOURNEY_CRITERIA_VERSION
    source: 'api'
    summary: { title: string; description: string; evidence?: JourneyEvidence[] }
    badges: { id: string; label: string; icon: string; evidence: JourneyEvidence[] }[]
    typeOptions: JourneyOption[]
    axisOptions: JourneyOption[]
    events: JourneyEvent[]
    evidenceSources: JourneyEvidenceSource[]
    analysis: {
        id: string | null; generatedAt: string | null; stale: boolean
        recordCount: number; currentRecordCount: number
        model: string | null; promptVersion: string | null
    }
}
