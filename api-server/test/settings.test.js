import assert from 'node:assert/strict'
import test from 'node:test'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../src/app.js'

test('전체 삭제는 확인 문구·진행 작업을 검사하고 전체 테이블을 원자적으로 비운다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const reset = confirmation => fetch(base + '/settings/reset-data', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmation }),
  })
  const count = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n
  try {
    db.exec(`INSERT INTO analyses VALUES ('a', 'c', 'message', '{}', '2026-11-06');
      INSERT INTO files VALUES ('f', 'a', 'file.txt', 'text/plain', 1, X'61');
      INSERT INTO records VALUES ('r', 'line1-hackathon', 'a', 'message', '{}', '2026-11-06', '2026-11-06');
      INSERT INTO timeline_events VALUES ('t', 'r', '{}', 0, '2026-11-06');
      INSERT INTO analysis_jobs VALUES ('j', 'a', 0, NULL);
      INSERT INTO ai_chat_jobs VALUES ('ai', 'key', 'fingerprint', 'a', 'text', 'running', 'analyzing', NULL, '{}', '2026-11-06', '2026-11-06');
      INSERT INTO journey_analyses VALUES ('g', 'fingerprint', 1, '{}', 'test', 'test', '2026-11-06');`)
    assert.equal((await reset('잘못된 문구')).status, 400)
    assert.equal((await reset('전체 삭제')).status, 409)
    assert.equal(count('records'), 1)
    db.exec("UPDATE ai_chat_jobs SET status = 'completed'")
    // 마지막 테이블 삭제 실패 시 앞서 삭제한 기록·파일도 모두 복구한다.
    db.exec("CREATE TRIGGER prevent_reset BEFORE DELETE ON activities BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
    assert.equal((await reset('전체 삭제')).status, 500)
    assert.equal(count('records'), 1)
    assert.equal(count('files'), 1)
    db.exec('DROP TRIGGER prevent_reset')
    const result = await reset('전체 삭제')
    assert.equal(result.status, 200)
    assert.deepEqual(await result.json(), { deleted: true })
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) assert.equal(count(name), 0, name)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal((await reset('전체 삭제')).status, 200)
    assert.deepEqual(await (await fetch(base + '/activities')).json(), [])
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})
