import { readArchive } from './archive.js'

const normalize = value => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

// 개발 서버에서 저장된 텍스트만 비교한다. 파일 원본 BLOB을 읽거나 본문을 추출하지 않는다.
export function selectArchiveActivities(activities, filters) {
  const query = normalize(filters.search)
  const result = activities.filter(activity =>
    (filters.category === 'all' || activity.category === filters.category)
    && (filters.status === 'all' || activity.status === filters.status)
    && (!query || (activity.searchTexts ?? [activity.title, activity.summary]).some(value => normalize(value).includes(query))))
  return result.sort((a, b) => {
    if (filters.sort === 'materials') return b.materialsCount - a.materialsCount
    const difference = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0)
    return filters.sort === 'oldest' ? -difference : difference
  })
}

export function searchArchive(db, query) {
  const activities = db.prepare('SELECT id, name, summary FROM activities ORDER BY rowid').all().map(row => {
    const { folders, timeline: _timeline, ...activity } = readArchive(db, row.id)
    const files = folders.flatMap(folder => folder.files)
    // 미저장 분석은 readArchive에 포함되지 않는다. 전체 자료 수는 검색으로 줄이지 않는다.
    return { ...activity, searchTexts: [row.name, row.summary ?? '', ...files.flatMap(file => [file.name, file.content, file.summary])] }
  })
  const items = selectArchiveActivities(activities, { search: query.q, category: query.category, status: query.status, sort: query.sort })
    .map(({ searchTexts: _searchTexts, ...activity }) => activity)
  return { items, total: activities.length }
}
