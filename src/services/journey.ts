import { request } from './chat'
import type { GrowthJourneyData } from '../types/journey'

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const unique = (values: string[]) => new Set(values).size === values.length
const validIcon = (icon: unknown) => icon === undefined || text(icon) && icon.trim().length <= 16

// 정식 공급자 응답도 이 경계에서 검증한다. 오류를 목 데이터로 대체하지 않는다.
export function isGrowthJourney(value: unknown): value is GrowthJourneyData {
    if (!object(value) || value.source !== 'api'
        || !object(value.summary) || !text(value.summary.title) || !text(value.summary.description)
        || !Array.isArray(value.badges) || !value.badges.every(badge => object(badge) && text(badge.id) && text(badge.label) && validIcon(badge.icon))
        || !unique(value.badges.map(badge => badge.id))) return false
    const references = (items: unknown) => items === undefined || Array.isArray(items) && items.length > 0
        && items.every(item => object(item) && text(item.recordId) && text(item.quote))
    if (!references(value.summary.evidence) || !value.badges.every(badge => references(badge.evidence))) return false
    if (value.analysis !== undefined) {
        const analysis = value.analysis
        if (!object(analysis) || !(analysis.id === null || text(analysis.id))
            || !(analysis.generatedAt === null || typeof analysis.generatedAt === 'string' && Number.isFinite(Date.parse(analysis.generatedAt)))
            || typeof analysis.stale !== 'boolean'
            || !Number.isInteger(analysis.recordCount) || (analysis.recordCount as number) < 0
            || !Number.isInteger(analysis.currentRecordCount) || (analysis.currentRecordCount as number) < 0
            || !(analysis.model === null || text(analysis.model)) || !(analysis.promptVersion === null || text(analysis.promptVersion))) return false
    }
    const validOptions = (options: unknown): options is GrowthJourneyData['typeOptions'] => Array.isArray(options)
        && options.every(option => object(option) && text(option.value) && text(option.label) && validIcon(option.icon))
        && options.some(option => option.value === 'all') && unique(options.map(option => option.value))
    if (!validOptions(value.typeOptions) || !validOptions(value.axisOptions) || !Array.isArray(value.events)) return false
    const types = new Set(value.typeOptions.map(option => option.value))
    const axes = new Set(value.axisOptions.map(option => option.value))
    return value.events.every(event => object(event) && text(event.id)
        && typeof event.occurredAt === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(event.occurredAt)
        && object(event.activity) && (event.activity.id === null || text(event.activity.id)) && text(event.activity.name)
        && text(event.type) && event.type !== 'all' && types.has(event.type)
        && text(event.axis) && event.axis !== 'all' && axes.has(event.axis)
        && text(event.title) && text(event.description)
        && references(event.evidence)
        && (event.comparison === undefined || object(event.comparison)
            && text(event.comparison.before) && text(event.comparison.after)
            && Array.isArray(event.comparison.evidence) && event.comparison.evidence.every(text)))
        && unique(value.events.map(event => event.id))
}

// 조회는 저장된 DB 결과만 읽는다. 모델 호출은 명시적인 갱신 요청에서만 수행한다.
export async function getGrowthJourney(signal?: AbortSignal): Promise<GrowthJourneyData> {
    signal?.throwIfAborted()
    const data = await request('/journey', { signal })
    if (!isGrowthJourney(data)) throw new Error('성장 분석 응답 형식이 올바르지 않습니다.')
    // YYYY-MM 문자열을 그대로 비교해 월 단위 정밀도를 유지한다.
    return { ...data, events: [...data.events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)) }
}

export async function generateGrowthJourney(signal?: AbortSignal): Promise<GrowthJourneyData> {
    signal?.throwIfAborted()
    const data = await request('/journey/analyze', { method: 'POST', signal }, undefined, 145_000)
    if (!isGrowthJourney(data)) throw new Error('성장 분석 응답 형식이 올바르지 않습니다.')
    return { ...data, events: [...data.events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)) }
}
