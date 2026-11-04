import type { JourneyEvent } from '../types/journey'

// 목록의 시간순은 유지하고 두 조건을 함께 적용한다. 원본 응답을 수정하지 않는다.
export function filterJourneyEvents(events: JourneyEvent[], type: string, axis: string): JourneyEvent[] {
    return events.filter(event => (type === 'all' || event.type === type)
        && (axis === 'all' || event.axis === axis))
}
