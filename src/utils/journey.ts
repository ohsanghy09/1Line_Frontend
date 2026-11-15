import { JOURNEY_TYPE_OPTIONS } from '../types/journey'
import type { GrowthType, JourneyEvent, JourneyEvidence } from '../types/journey'

// 목록과 카드의 다른 판단은 보존하고 선택한 유형의 포함 여부만 검사한다.
export function filterJourneyEvents(events: JourneyEvent[], type: string, axis: string): JourneyEvent[] {
    return events.filter(event => (type === 'all' || event.growthAssessments.some(item => item.type === type))
        && (axis === 'all' || event.axis === axis))
}
export const journeyTypeLabel = (type: GrowthType) => JOURNEY_TYPE_OPTIONS.find(option => option.value === type)!.label
// 참고 HTML과 동일한 표시 아이콘. API 선택지·라벨에는 포함하지 않는다.
const journeyTypeIcons: Record<GrowthType, string> = {
    capability_expansion: '🧩',
    performance_improvement: '🏆',
    experience_accumulation: '🌱',
    efficiency_improvement: '⚡',
    experience_transfer: '🔁',
}
export const journeyTypeIcon = (type: GrowthType) => journeyTypeIcons[type]
export const journeyEvidenceKey = (evidence: JourneyEvidence) => JSON.stringify([evidence.recordId, evidence.quote])
export type GroupedJourneyEvidence = JourneyEvidence & { key: string; roles: string[] }

// 동일 원문도 이전/이후·출발/적용 역할을 잃지 않게 한 번만 표시한다.
export function groupJourneyEvidence(event: JourneyEvent): GroupedJourneyEvidence[] {
    const grouped = new Map<string, GroupedJourneyEvidence>()
    function add(items: JourneyEvidence[], role: string) {
        for (const item of items) {
            const key = journeyEvidenceKey(item)
            const entry = grouped.get(key) ?? { ...item, key, roles: [] }
            if (!entry.roles.includes(role)) entry.roles.push(role)
            grouped.set(key, entry)
        }
    }
    for (const assessment of event.growthAssessments) {
        const label = journeyTypeLabel(assessment.type)
        add(assessment.evidence, label)
        if (assessment.comparison) {
            add(assessment.comparison.beforeEvidence, label + ' · 이전')
            add(assessment.comparison.afterEvidence, label + ' · 이후')
        }
        if (assessment.transfer) {
            add(assessment.transfer.sourceEvidence, label + ' · 출발 경험')
            add(assessment.transfer.applicationEvidence, label + ' · 실제 적용')
        }
    }
    return [...grouped.values()]
}
