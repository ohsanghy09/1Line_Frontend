import { isActivityProposal, isReply, request } from './chat'
import type { ActivityMetadata, ActivitySelection, ChatReply } from '../types/chat'

export type ActivityOption = ActivityMetadata & { id: string; name: string }
export type SavedRecord = { id: string; activityId: string; reply: ChatReply }

export async function getActivities(): Promise<ActivityOption[]> {
    const data = await request('/activities')
    if (!Array.isArray(data) || !data.every(item => item && typeof item.id === 'string' && isActivityProposal({ ...item, confidence: null }))) throw new Error('활동 목록 형식이 올바르지 않습니다.')
    return data.map(item => ({ ...item, category: item.category ?? null, status: item.status ?? null, role: item.role ?? null, period: item.period ?? null, summary: item.summary ?? null }))
}

function notifyActivitiesChanged() {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('1line:activities-changed'))
}

// 초안은 ID로 원본 파일 연결을 유지하고, 독립 미리보기는 카드 JSON으로 저장한다.
export async function saveRecord(reply: ChatReply, target: string | ActivitySelection): Promise<SavedRecord> {
    const selection = typeof target === 'string' ? { activityId: target } : target
    const saved = readRecord(await request('/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...selection, ...(reply.analysisId ? { analysisId: reply.analysisId } : { reply }), classification: { materialType: reply.analysis?.materialType } }),
    }))
    notifyActivitiesChanged()
    return saved
}

export async function updateRecord(id: string, activityId: string, materialType: string, activityUpdates?: ActivityMetadata): Promise<SavedRecord> {
    const saved = readRecord(await request(`/records/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activityId, materialType, activityUpdates }),
    }))
    notifyActivitiesChanged()
    return saved
}

function readRecord(data: unknown): SavedRecord {
    if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' || !('activityId' in data) || typeof data.activityId !== 'string' || !('reply' in data) || !isReply(data.reply)) throw new Error('기록 응답 형식을 확인할 수 없습니다.')
    return { id: data.id, activityId: data.activityId, reply: data.reply }
}
