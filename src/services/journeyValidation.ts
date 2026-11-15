import { JOURNEY_SCHEMA_VERSION, JOURNEY_CRITERIA_VERSION, JOURNEY_TYPE_OPTIONS } from '../types/journey'
import type { GrowthAssessment, GrowthJourneyData, JourneyComparison, JourneyEvent, JourneyEvidence, JourneyTransfer } from '../types/journey'
import { journeyEvidenceKey } from '../utils/journey'

const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && [...v].length <= max
const unique = (values: string[]) => new Set(values).size === values.length
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0
const timestamp = (v: unknown): v is string => text(v, 80)
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v))
function shape(v: unknown, required: string[], optional: string[] = []): v is Record<string, unknown> {
    return object(v) && required.every(key => Object.hasOwn(v, key))
        && Object.keys(v).every(key => required.includes(key) || optional.includes(key))
}
function evidence(v: unknown, max: number): v is JourneyEvidence[] {
    return Array.isArray(v) && v.length > 0 && v.length <= max
        && v.every(item => shape(item, ['recordId', 'quote']) && text(item.recordId, 200) && text(item.quote, 800))
}
function comparison(v: unknown): v is JourneyComparison {
    return shape(v, ['before', 'after', 'condition', 'beforeEvidence', 'afterEvidence'])
        && text(v.before, 500) && text(v.after, 500) && text(v.condition, 500)
        && evidence(v.beforeEvidence, 10) && evidence(v.afterEvidence, 10)
}
function transfer(v: unknown): v is JourneyTransfer {
    return shape(v, ['sourceActivity', 'experience', 'targetActivityId', 'application', 'sourceEvidence', 'applicationEvidence'])
        && shape(v.sourceActivity, ['id', 'name']) && (v.sourceActivity.id === null || text(v.sourceActivity.id, 200)) && text(v.sourceActivity.name, 200)
        && text(v.experience, 500) && text(v.targetActivityId, 200) && text(v.application, 500)
        && evidence(v.sourceEvidence, 10) && evidence(v.applicationEvidence, 10)
}
function assessment(v: unknown): v is GrowthAssessment {
    if (!shape(v, ['type', 'reason', 'evidence'], ['comparison', 'transfer'])
        || !JOURNEY_TYPE_OPTIONS.some(option => option.value !== 'all' && option.value === v.type)
        || !text(v.reason, 500) || !evidence(v.evidence, 10)) return false
    if (Object.hasOwn(v, 'comparison') && !comparison(v.comparison)) return false
    if (['performance_improvement', 'efficiency_improvement'].includes(String(v.type)) && !comparison(v.comparison)) return false
    if (v.type === 'experience_transfer' ? !transfer(v.transfer) : Object.hasOwn(v, 'transfer')) return false
    const all = new Set(v.evidence.map(journeyEvidenceKey))
    const roles = [
        ...(comparison(v.comparison) ? [...v.comparison.beforeEvidence, ...v.comparison.afterEvidence] : []),
        ...(transfer(v.transfer) ? [...v.transfer.sourceEvidence, ...v.transfer.applicationEvidence] : []),
    ]
    return roles.every(item => all.has(journeyEvidenceKey(item)))
}
function event(v: unknown): v is JourneyEvent {
    return shape(v, ['id', 'occurredAt', 'activity', 'axis', 'title', 'description', 'growthAssessments'])
        && text(v.id, 200) && typeof v.occurredAt === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(v.occurredAt)
        && shape(v.activity, ['id', 'name']) && text(v.activity.id, 200) && text(v.activity.name, 200)
        && text(v.axis, 80) && v.axis !== 'all' && text(v.title, 120) && text(v.description, 1000)
        && Array.isArray(v.growthAssessments) && v.growthAssessments.length > 0 && v.growthAssessments.length <= 5
        && v.growthAssessments.every(assessment) && unique(v.growthAssessments.map(item => item.type))
}

// 실제 기록 원문·날짜의 진실성은 Spring/AI가 검증한다. 프론트에서는 공개 계약과 참조 관계를 확인한다.
export function isGrowthJourney(value: unknown): value is GrowthJourneyData {
    if (!shape(value, ['schemaVersion', 'criteriaVersion', 'source', 'summary', 'badges', 'typeOptions', 'axisOptions', 'events', 'evidenceSources', 'analysis'])
        || value.schemaVersion !== JOURNEY_SCHEMA_VERSION || value.criteriaVersion !== JOURNEY_CRITERIA_VERSION || value.source !== 'api'
        || !shape(value.summary, ['title', 'description'], ['evidence']) || !text(value.summary.title, 120) || !text(value.summary.description, 2000)
        || Object.hasOwn(value.summary, 'evidence') && !evidence(value.summary.evidence, 20)) return false
    if (!Array.isArray(value.badges) || value.badges.length > 10
        || !value.badges.every(b => shape(b, ['id', 'label', 'icon', 'evidence']) && text(b.id, 200) && text(b.label, 80) && text(b.icon, 16) && evidence(b.evidence, 5))
        || !unique(value.badges.map(b => b.id))) return false
    if (!Array.isArray(value.typeOptions) || value.typeOptions.length !== JOURNEY_TYPE_OPTIONS.length
        || !value.typeOptions.every((option, i) => shape(option, ['value', 'label']) && option.value === JOURNEY_TYPE_OPTIONS[i].value && option.label === JOURNEY_TYPE_OPTIONS[i].label)) return false
    if (!Array.isArray(value.axisOptions) || value.axisOptions.length < 1 || value.axisOptions.length > 9
        || !value.axisOptions.every(o => shape(o, ['value', 'label']) && text(o.value, 80) && text(o.label, 40))
        || value.axisOptions[0].value !== 'all' || value.axisOptions[0].label !== '전체 분야' || !unique(value.axisOptions.map(o => o.value))) return false
    const labels = value.axisOptions.slice(1).map(o => o.label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase())
    if (!unique(labels) || labels.some(label => ['전체', '전체 분야', '전체분야'].includes(label))) return false
    if (!Array.isArray(value.events) || value.events.length > 20 || !value.events.every(event) || !unique(value.events.map(e => e.id))) return false
    const usedAxes = new Set(value.events.map(e => e.axis))
    if (usedAxes.size !== value.axisOptions.length - 1 || !value.axisOptions.slice(1).every(o => usedAxes.has(o.value))) return false
    if (!Array.isArray(value.evidenceSources) || value.evidenceSources.length > 100
        || !value.evidenceSources.every(s => shape(s, ['recordId', 'activityId', 'activityName']) && text(s.recordId, 200) && text(s.activityId, 200) && text(s.activityName, 200))
        || !unique(value.evidenceSources.map(s => s.recordId))) return false
    const a = value.analysis
    if (!shape(a, ['id', 'generatedAt', 'stale', 'recordCount', 'currentRecordCount', 'model', 'promptVersion'])
        || !(a.id === null || text(a.id, 200)) || !(a.generatedAt === null || timestamp(a.generatedAt)) || typeof a.stale !== 'boolean'
        || !count(a.recordCount) || a.recordCount > 100 || !count(a.currentRecordCount)
        || !(a.model === null || text(a.model, 200)) || !(a.promptVersion === null || a.promptVersion === 'journey-v6')) return false
    if (a.id === null ? a.generatedAt !== null || a.model !== null || a.promptVersion !== null || a.recordCount !== 0 || a.stale
        : a.generatedAt === null || a.model === null || a.promptVersion === null) return false
    // 미분석·삭제 무효화 상태에만 요약 근거 생략을 허용한다.
    if (!value.summary.evidence && (value.events.length > 0 || value.badges.length > 0 || a.id !== null && !a.stale)) return false
    if (a.id === null && (value.events.length > 0 || value.badges.length > 0 || value.evidenceSources.length > 0)) return false
    if (value.events.length === 0 && value.badges.length > 0) return false
    const data = value as unknown as GrowthJourneyData
    const sources = new Map(data.evidenceSources.map(source => [source.recordId, source]))
    const referenced = new Set<string>()
    const check = (refs: JourneyEvidence[]) => refs.every(ref => {
        referenced.add(ref.recordId)
        return sources.has(ref.recordId)
    })
    if (!check(data.summary.evidence ?? []) || !data.badges.every(b => check(b.evidence))) return false
    for (const item of data.events) {
        const refs = item.growthAssessments.flatMap(g => g.evidence)
        if (!check(refs) || !refs.some(ref => sources.get(ref.recordId)?.activityId === item.activity.id && sources.get(ref.recordId)?.activityName === item.activity.name)) return false
        for (const g of item.growthAssessments) {
            if (!g.transfer) continue
            const t = g.transfer
            if (t.targetActivityId !== item.activity.id || t.sourceActivity.id === t.targetActivityId
                || !t.applicationEvidence.some(ref => sources.get(ref.recordId)?.activityId === t.targetActivityId)
                || t.sourceActivity.id !== null && !t.sourceEvidence.some(ref => sources.get(ref.recordId)?.activityId === t.sourceActivity.id
                    && sources.get(ref.recordId)?.activityName === t.sourceActivity.name)) return false
        }
    }
    return referenced.size === sources.size
}
