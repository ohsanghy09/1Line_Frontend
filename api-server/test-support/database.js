import { openDatabase as openProductionDatabase } from '../src/database.js'
import { tmpdir } from 'node:os'
import { resolve, sep } from 'node:path'

// 과거 HTTP·조회 회귀 검사의 준비 데이터다. 사용자 DB와 개발 서버에서는 사용하지 않는다.
export function openDatabase(path) {
  if (path !== ':memory:' && !resolve(path).toLowerCase().startsWith((resolve(tmpdir()) + sep).toLowerCase())) {
    throw new Error('검사 예시 활동은 메모리 또는 임시 폴더 DB에만 생성할 수 있습니다.')
  }
  const db = openProductionDatabase(path)
  const insert = db.prepare('INSERT OR IGNORE INTO activities (id, name) VALUES (?, ?)')
  for (const [id, name] of [['line1-hackathon', '1호선톤'], ['computer-vision', '컴퓨터비전'], ['scent-orbit', 'Scent Orbit'], ['data-vis', '데이터분석과시각화'], ['ai-contest', 'AI 분석 공모전']]) insert.run(id, name)
  return db
}
