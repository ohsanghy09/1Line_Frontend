import { request } from './chat'
import type { ActivityAnalysis } from '../types/activity'
export type { ActivityAnalysis } from '../types/activity'

export function isActivityAnalysis(value: unknown): value is ActivityAnalysis {
    if (!value || typeof value !== 'object') return false
    const state = value as Record<string, unknown>
    return ['idle', 'queued', 'running', 'ready', 'failed'].includes(String(state.status))
        && (state.error === null || typeof state.error === 'string')
        && (state.updatedAt === null || typeof state.updatedAt === 'string' && Number.isFinite(Date.parse(state.updatedAt)))
        && typeof state.stale === 'boolean'
}

export async function getActivityAnalysis(id: string, signal?: AbortSignal): Promise<ActivityAnalysis> {
    const data = await request(`/activities/${encodeURIComponent(id)}/analysis`, { signal })
    if (!isActivityAnalysis(data)) throw new Error('활동 정보 분석 상태를 확인하지 못했어요.')
    return data
}

export async function retryActivityAnalysis(id: string): Promise<void> {
    await request(`/activities/${encodeURIComponent(id)}/analyze`, { method: 'POST' })
}
