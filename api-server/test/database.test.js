import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/database.js'

test('신규 DB·재실행·삭제 후 재실행에서도 예시 활동을 자동 생성하지 않는다', () => {
  const directory = mkdtempSync(join(tmpdir(), '1line-empty-db-'))
  const path = join(directory, 'empty.db')
  let db
  try {
    db = openDatabase(path)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 0)
    db.prepare('INSERT INTO activities (id, name) VALUES (?, ?)').run('actual', '사용자가 생성한 활동')
    db.close()
    db = openDatabase(path)
    assert.deepEqual(db.prepare('SELECT id FROM activities').all().map(row => row.id), ['actual'])
    db.prepare('DELETE FROM activities').run()
    db.close()
    db = openDatabase(path)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 0)
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  } finally {
    db?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
