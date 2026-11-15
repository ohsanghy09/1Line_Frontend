import { request } from './chat'
import type { GrowthJourneyData } from '../types/journey'
import { isGrowthJourney } from './journeyValidation'
export { isGrowthJourney } from './journeyValidation'

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
