import { mockGrowthJourney } from '../mocks/journey'
import type { GrowthJourneyData } from '../types/journey'

// 현재는 목 응답을 반환한다. 실제 API 연결 시 이 경계에서 조회·응답 변환을 교체한다.
export async function getGrowthJourney(signal?: AbortSignal): Promise<GrowthJourneyData> {
    signal?.throwIfAborted()
    const data = structuredClone(mockGrowthJourney)
    // YYYY-MM 문자열을 그대로 비교해 월 단위 정밀도를 유지한다.
    data.events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt))
    return data
}
