import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// 파일 원본도 BLOB으로 보관하여 별도 파일 경로와 DB 사이의 불일치를 피한다.
export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS activities (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS analyses (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, message TEXT NOT NULL,
      reply TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL REFERENCES analyses(id),
      name TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL, content BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, activity_id TEXT NOT NULL REFERENCES activities(id),
      analysis_id TEXT UNIQUE REFERENCES analyses(id), message TEXT NOT NULL,
      reply TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY, record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      change_json TEXT NOT NULL, is_turning_point INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS analysis_jobs (
      id TEXT PRIMARY KEY, analysis_id TEXT NOT NULL UNIQUE REFERENCES analyses(id),
      started_at INTEGER NOT NULL, error TEXT
    );
  `)
  const insert = db.prepare('INSERT OR IGNORE INTO activities VALUES (?, ?)')
  for (const [id, name] of [['line1-hackathon', '1호선톤'], ['computer-vision', '컴퓨터비전'], ['scent-orbit', 'Scent Orbit'], ['data-vis', '데이터분석과시각화'], ['ai-contest', 'AI 분석 공모전']]) insert.run(id, name)
  return db
}

// 기록과 변화 이벤트는 함께 성공하거나 함께 취소한다.
export function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
