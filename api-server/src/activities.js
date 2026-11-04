import { randomUUID } from 'node:crypto'
import { activityPeriod } from './validation.js'

// AI 요청 시 넘길 기존 활동 문맥과 저장 응답에 사용할 공통 구조다.
export function activityInformation(row) {
  return { id: row.id, name: row.name, category: row.category ?? null, status: ['진행 중', '완료'].includes(row.status) ? row.status : null,
    role: row.role ?? null, summary: row.summary ?? null,
    period: row.start_date || row.end_date ? { start: row.start_date ?? null, end: row.end_date ?? null } : null }
}

export function analysisContext(db) {
  return { activities: db.prepare('SELECT * FROM activities ORDER BY rowid').all().map(activityInformation) }
}

// 반드시 기록 저장 트랜잭션 안에서 호출한다. AI 후보만으로는 DB를 변경하지 않는다.
export function resolveActivity(db, input, findActivity, fail) {
  if (input.newActivity) {
    const candidate = input.newActivity
    if (db.prepare('SELECT id FROM activities WHERE name = ?').get(candidate.name)) throw fail(409, '같은 이름의 활동이 있습니다. 기존 활동을 선택해 주세요.')
    const id = randomUUID()
    db.prepare('INSERT INTO activities (id, name) VALUES (?, ?)').run(id, candidate.name)
    applyActivityMetadata(db, id, candidate)
    return findActivity(id)
  }
  const target = findActivity(input.activityId)
  if (input.activityUpdates) applyActivityMetadata(db, target.id, input.activityUpdates)
  return findActivity(target.id)
}

export function applyActivityMetadata(db, id, metadata) {
  // null은 미확인 값이다. 기존 값을 지우거나 덮어쓰지 않는다.
  for (const field of ['category', 'status', 'role', 'summary']) {
    if (metadata[field] != null) db.prepare(`UPDATE activities SET ${field} = ? WHERE id = ?`).run(metadata[field], id)
  }
  if (metadata.period?.start || metadata.period?.end) {
    const current = db.prepare('SELECT start_date, end_date FROM activities WHERE id = ?').get(id)
    const period = activityPeriod.parse({ start: metadata.period.start ?? current.start_date, end: metadata.period.end ?? current.end_date })
    db.prepare('UPDATE activities SET start_date = ?, end_date = ?, period = ? WHERE id = ?')
      .run(period.start, period.end, `${period.start ?? '미확인'} ~ ${period.end ?? ''}`, id)
  }
}

// 저장·수정과 같은 트랜잭션에서 호출한다. 기록 이동은 출발/도착 활동 모두 변경된다.
export function touchActivities(db, ids, now) {
  for (const id of new Set(ids)) db.prepare('UPDATE activities SET updated_at = ? WHERE id = ?').run(now, id)
}
