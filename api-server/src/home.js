import { readArchive } from './archive.js'

// 홈과 나의 발자국이 같은 활동 집계·자료 ID를 사용한다. 미저장 초안은 포함하지 않는다.
export function readHomeRecent(db) {
  const cache = new Map()
  function archive(id) {
    if (!cache.has(id)) cache.set(id, readArchive(db, id))
    return cache.get(id)
  }
  const activities = db.prepare('SELECT id FROM activities WHERE updated_at IS NOT NULL ORDER BY updated_at DESC, rowid DESC LIMIT 3')
    .all().map(({ id }) => {
      const { folders: _folders, timeline: _timeline, ...summary } = archive(id)
      return summary
    })

  const records = []
  // 최초 확정 저장 시각으로 정렬한다. 수정·활동 이동은 추가 시각을 바꾸지 않는다.
  for (const row of db.prepare('SELECT id, activity_id FROM records ORDER BY created_at DESC, rowid DESC').iterate()) {
    const activity = archive(row.activity_id)
    const files = activity.folders.flatMap(folder => folder.files).filter(file => file.recordId === row.id)
      .sort((a, b) => a.recordPosition - b.recordPosition)
    for (const file of files) {
      records.push({ id: file.id, recordId: row.id, activityId: activity.id, activityName: activity.title,
        title: file.name, materialType: file.type, kind: file.kind, savedAt: file.savedAt })
      if (records.length === 3) return { activities, records }
    }
  }
  return { activities, records }
}
