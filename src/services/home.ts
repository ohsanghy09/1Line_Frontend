import { request } from './chat'
import { readFootprintActivity } from './footprints'
import type { HomeRecent, RecentRecord } from '../types/home'

// 최근 목록의 정렬·최대 개수는 서버가 담당한다. 프론트는 실제 ID와 시각을 변환한다.
export async function getHomeRecent(signal?: AbortSignal): Promise<HomeRecent> {
    const data = await request('/home/recent', { signal })
    if (!data || typeof data !== 'object' || !('activities' in data) || !('records' in data)
        || !Array.isArray(data.activities) || !Array.isArray(data.records)) throw new Error('최근 목록 응답 형식이 올바르지 않습니다.')
    const activities = data.activities.map(readFootprintActivity)
    const records = data.records.map((item: unknown): RecentRecord => {
        if (!item || typeof item !== 'object') throw new Error('최근 기록 응답 형식이 올바르지 않습니다.')
        const row = item as Record<string, unknown>
        if (!['id', 'recordId', 'activityId', 'activityName', 'title', 'materialType', 'savedAt'].every(key => typeof row[key] === 'string')
            || !['file', 'text', 'link'].includes(String(row.kind)) || !Number.isFinite(Date.parse(String(row.savedAt)))) throw new Error('최근 기록 응답 형식이 올바르지 않습니다.')
        return { id: row.id as string, recordId: row.recordId as string, activityId: row.activityId as string,
            activityName: row.activityName as string, title: row.title as string, materialType: row.materialType as string,
            kind: row.kind as RecentRecord['kind'], savedAt: row.savedAt as string,
            savedAtLabel: new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(row.savedAt as string)) }
    })
    return { activities, records }
}
