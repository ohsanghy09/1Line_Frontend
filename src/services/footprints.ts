import { request } from './chat'
import { isActivityAnalysis } from './activityAnalysis'
import type { FootprintActivity, FootprintActivityDetail, FootprintFile, FootprintFileDetail, FootprintFilters, FootprintTimelineEvent } from '../types/footprints'

type RawActivity = Omit<FootprintActivity, 'updatedAt' | 'updatedAtLabel'> & { updatedAt: string | null }
type RawFile = Omit<FootprintFile, 'uploadedAtLabel'> & { uploadedAt: string }
// 유니온의 각 분기에 적용해 Turning Point 고유 필드를 유지한다.
type WithoutDateLabel<T> = T extends unknown ? Omit<T, 'dateLabel'> : never
type RawEvent = WithoutDateLabel<FootprintTimelineEvent>

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string')
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const count = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0

function isActivity(value: unknown): value is RawActivity & Record<string, unknown> {
    return object(value) && ['id', 'title', 'category', 'role', 'period', 'summary'].every(key => typeof value[key] === 'string')
        && ['진행 중', '완료', '미설정'].includes(String(value.status)) && count(value.materialsCount)
        && (value.updatedAt === null || date(value.updatedAt))
        && (value.recordsCount === undefined || count(value.recordsCount))
        && (value.metadataAnalysis === undefined || isActivityAnalysis(value.metadataAnalysis))
}

function isFile(value: unknown): value is RawFile {
    return object(value) && ['id', 'name', 'type', 'summary'].every(key => typeof value[key] === 'string') && date(value.uploadedAt)
        && (value.version === undefined || typeof value.version === 'string')
        && (value.sourceUrl === undefined || value.sourceUrl === null || typeof value.sourceUrl === 'string')
        && (value.summaryScope === undefined || value.summaryScope === 'record')
}

function isEvent(value: unknown): value is RawEvent {
    return object(value) && typeof value.id === 'string' && typeof value.title === 'string' && date(value.occurredAt)
        && strings(value.evidenceFileIds) && (value.evidenceLabels === undefined || strings(value.evidenceLabels))
        && (value.change === undefined || object(value.change) && typeof value.change.before === 'string' && typeof value.change.after === 'string')
        && (value.isTurningPoint === true ? ['before', 'after', 'reason'].every(key => typeof value[key] === 'string') : value.isTurningPoint === false && typeof value.description === 'string')
}

function dateLabel(value: string): string {
    return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function activityView(value: RawActivity): FootprintActivity {
    return { ...value, updatedAt: value.updatedAt ?? '', updatedAtLabel: value.updatedAt ? dateLabel(value.updatedAt) : '기록 없음' }
}

// 홈의 최근 활동도 같은 계약 검증과 시각 표시 변환을 사용한다.
export function readFootprintActivity(value: unknown): FootprintActivity {
    if (!isActivity(value)) throw new Error('활동 응답 형식이 올바르지 않습니다.')
    return activityView(value)
}
const fileView = (value: RawFile): FootprintFile => ({ ...value, uploadedAtLabel: dateLabel(value.uploadedAt) })
const eventView = (value: RawEvent): FootprintTimelineEvent => ({ ...value, dateLabel: dateLabel(value.occurredAt) })

// 서버 연결 실패를 예시 활동으로 대체하지 않는다. 404만 화면의 없음 상태로 변환한다.
async function getOrNull(path: string): Promise<unknown> {
    try { return await request(path) } catch (error) {
        if (object(error) && error.status === 404) return null
        throw error
    }
}

export async function getFootprintActivities(): Promise<FootprintActivity[]> {
    return (await searchFootprintActivities({ search: '', category: 'all', status: 'all', sort: 'recent' })).items
}

// 정식 서버로 교체할 때도 검색 조건과 응답을 이 경계에서 변환한다.
export async function searchFootprintActivities(filters: FootprintFilters, signal?: AbortSignal): Promise<{ items: FootprintActivity[]; total: number; categories: string[] }> {
    const query = new URLSearchParams({ q: filters.search, category: filters.category, status: filters.status, sort: filters.sort })
    const data = await request(`/archive/activities?${query}`, { signal })
    if (!object(data) || !Array.isArray(data.items) || !data.items.every(isActivity) || !count(data.total) || data.total < data.items.length) throw new Error('활동 목록 응답 형식이 올바르지 않습니다.')
    if (!strings(data.categories) || data.categories.some(category => !category.trim() || category === 'all') || new Set(data.categories).size !== data.categories.length) throw new Error('활동 유형 응답 형식이 올바르지 않습니다.')
    return { items: data.items.map(activityView), total: data.total, categories: data.categories }
}

export async function getFootprintActivity(id: string): Promise<FootprintActivityDetail | null> {
    if (!id) return null
    const data = await getOrNull(`/archive/activities/${encodeURIComponent(id)}`)
    if (data === null) return null
    if (!isActivity(data) || !object(data) || data.id !== id || !Array.isArray(data.folders) || !Array.isArray(data.timeline) || !data.timeline.every(isEvent)) throw new Error('활동 상세 응답 형식이 올바르지 않습니다.')
    const folders = data.folders.map((folder: unknown) => {
        if (!object(folder) || typeof folder.id !== 'string' || typeof folder.name !== 'string' || !count(folder.materialsCount) || !Array.isArray(folder.files) || !folder.files.every(isFile)) throw new Error('폴더 응답 형식이 올바르지 않습니다.')
        return { id: folder.id, name: folder.name, materialsCount: folder.materialsCount, files: folder.files.map(fileView) }
    })
    return { ...activityView(data), folders, timeline: data.timeline.map(eventView) }
}

export async function getFootprintFile(activityId: string, fileId: string): Promise<FootprintFileDetail | null> {
    if (!activityId || !fileId) return null
    const data = await getOrNull(`/archive/activities/${encodeURIComponent(activityId)}/materials/${encodeURIComponent(fileId)}`)
    if (data === null) return null
    if (!object(data) || data.activityId !== activityId || !isFile(data.file) || data.file.id !== fileId || !Array.isArray(data.events) || !data.events.every(isEvent)
        || !Array.isArray(data.versionHistory) || !data.versionHistory.every(item => object(item) && typeof item.fileId === 'string' && typeof item.version === 'string')) throw new Error('자료 상세 응답 형식이 올바르지 않습니다.')
    return { activityId, file: fileView(data.file), events: data.events.map(eventView), versionHistory: data.versionHistory }
}

async function remove(path: string, confirmation?: string): Promise<void> {
    const result = await request(path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation }) }, undefined, 165_000)
    if (!object(result) || result.deleted !== true) throw new Error('삭제 결과를 확인하지 못했어요. 새로고침 후 확인해 주세요.')
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('1line:activities-changed'))
        window.dispatchEvent(new Event('1line:records-changed'))
    }
}

export function deleteFootprintActivity(id: string, confirmation: string): Promise<void> {
    return remove(`/archive/activities/${encodeURIComponent(id)}`, confirmation)
}

export function deleteFootprintMaterial(activityId: string, fileId: string): Promise<void> {
    return remove(`/archive/activities/${encodeURIComponent(activityId)}/materials/${encodeURIComponent(fileId)}`)
}
