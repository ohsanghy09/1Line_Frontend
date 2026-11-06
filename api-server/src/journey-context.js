import { createHash } from 'node:crypto'

// Python의 journey_context와 같은 열·정렬·JSON 직렬화를 사용한다.
// 빈 활동과 저장 전 분석 초안은 포함하지 않는다. 파일 본문 BLOB도 읽지 않는다.
export function journeySnapshot(db) {
  const records = db.prepare(`SELECT r.id, r.activity_id, a.name, r.message, r.reply,
    r.created_at, r.updated_at, a.category, a.role, a.summary, a.start_date, a.end_date
    FROM records r JOIN activities a ON a.id = r.activity_id ORDER BY r.id`).all()
    .map(row => Object.values(row))
  const files = db.prepare(`SELECT r.id AS record_id, f.id, f.name FROM files f
    JOIN records r ON r.analysis_id = f.analysis_id ORDER BY r.id, f.id`).all()
    .map(row => Object.values(row))
  return { records, files, fingerprint: createHash('sha256').update(JSON.stringify([records, files])).digest('hex') }
}
