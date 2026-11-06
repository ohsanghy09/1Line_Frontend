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
    // 텍스트 경험 기록은 자료 폴더에는 넣지 않지만 확정 기록 검색과 분석에서는 보존한다.
    const savedTexts = db.prepare('SELECT message, reply FROM records WHERE activity_id = ?').all(row.id)
      .flatMap(record => [record.message, JSON.parse(record.reply).analysis?.summary ?? ''])
    // 미저장 분석은 readArchive에 포함되지 않는다. 전체 자료 수는 검색으로 줄이지 않는다.
    return { ...activity, searchTexts: [row.name, row.summary ?? '', ...savedTexts, ...files.flatMap(file => [file.name, file.content, file.summary])] }
  })
  const items = selectArchiveActivities(activities, { search: query.q, category: query.category, status: query.status, sort: query.sort })
    .map(({ searchTexts: _searchTexts, ...activity }) => activity)
  // 검색·유형·상태 조건과 무관한 전체 유형을 반환해 필터 선택지를 유지한다.
  const categories = [...new Set(activities.map(activity => activity.category))].sort((a, b) => a.localeCompare(b, 'ko'))
  return { items, total: activities.length, categories }
}
