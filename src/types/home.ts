import type { FootprintActivity } from './footprints'

export type RecentRecord = {
    id: string
    recordId: string
    activityId: string
    activityName: string
    title: string
    materialType: string
    kind: 'file' | 'text' | 'link'
    savedAt: string
    savedAtLabel: string
}

export type HomeRecent = { activities: FootprintActivity[]; records: RecentRecord[] }
