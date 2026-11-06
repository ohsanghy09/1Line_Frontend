import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../test-support/app.js'
import { createMockLinkReply } from '../test-support/mock-reply.js'

test('아카이브는 확정한 실제 자료만 집계하고 분류·활동·변화 수정과 함께 갱신한다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const get = async path => (await fetch(base + path)).json()
  const send = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text())
    return response.json()
  }
  try {
    const listing = await get('/archive/activities')
    const list = listing.items
    assert.equal(listing.total, 5)
    assert.equal(list.length, 5)
    assert.ok(list.every(item => item.materialsCount === 0 && item.updatedAt === null && item.status === '미설정'))
    db.prepare('UPDATE activities SET category = ?, status = ?, role = ?, period = ?, summary = ? WHERE id = ?')
      .run('프로젝트', '진행 중', '개발', '2026.11 ~', '저장된 활동 요약', 'line1-hackathon')

    const form = new FormData()
    form.set('message', '실제 입력한 자료 설명')
    form.set('mode', 'change')
    form.append('files', new Blob(['first original']), '실제 기획.txt')
    form.append('files', new Blob(['second original']), '두번째.txt')
    const draft = await (await fetch(base + '/chat', { method: 'POST', body: form })).json()
    assert.equal((await get('/archive/activities/line1-hackathon')).materialsCount, 0)
    const saved = await send('/records', { activityId: 'line1-hackathon', analysisId: draft.analysisId })
    const detail = await get('/archive/activities/line1-hackathon')
    assert.equal(detail.materialsCount, 2)
    assert.equal(detail.summary, '저장된 활동 요약')
    assert.equal(detail.role, '개발')
    assert.equal(detail.timeline.length, 1)
    assert.equal(detail.timeline[0].isTurningPoint, false)
    assert.equal(detail.timeline[0].change.before, draft.reply.analysis.changes[0].before)
    assert.equal(detail.folders[0].materialsCount, 2)
    assert.ok(detail.folders.every(folder => !/\s/.test(folder.id)))
    assert.equal(detail.updatedAt, saved.updatedAt)
    const fileId = draft.attachments[0].id
    const file = await get(`/archive/activities/line1-hackathon/materials/${fileId}`)
    assert.equal(file.file.name, '실제 기획.txt')
    assert.equal(file.file.content, '실제 입력한 자료 설명')
    assert.equal(file.file.summaryScope, 'record')
    assert.equal(file.events.length, 1)
    assert.deepEqual(file.versionHistory, [])
    assert.equal(await (await fetch(base + `/files/${fileId}`)).text(), 'first original')
    assert.equal((await fetch(base + `/archive/activities/computer-vision/materials/${fileId}`)).status, 404)
    assert.equal((await fetch(base + '/archive/activities/unknown')).status, 404)

    await send(`/records/${saved.id}`, { activityId: 'computer-vision', materialType: '회의록', summary: '수정된 기록 요약' }, 'PATCH')
    assert.equal((await get('/archive/activities/line1-hackathon')).materialsCount, 0)
    const moved = await get('/archive/activities/computer-vision')
    assert.equal(moved.materialsCount, 2)
    assert.equal(moved.folders[0].name, '회의록')
    assert.equal(moved.folders[0].files[0].summary, '수정된 기록 요약')
    assert.equal(moved.timeline[0].id, detail.timeline[0].id)
    assert.equal((await fetch(base + `/archive/activities/line1-hackathon/materials/${fileId}`)).status, 404)
    await send(`/records/${saved.id}`, { changes: [] }, 'PATCH')
    assert.deepEqual((await get('/archive/activities/computer-vision')).timeline, [])

    const textForm = new FormData()
    textForm.set('message', '오늘은 DB 연동을 구현했다.')
    const textDraft = await (await fetch(base + '/chat', { method: 'POST', body: textForm })).json()
    await send('/records', { activityId: 'line1-hackathon', analysisId: textDraft.analysisId })
    await send('/records', { activityId: 'line1-hackathon', reply: createMockLinkReply('https://example.com/actual-input') })
    const entries = (await get('/archive/activities/line1-hackathon')).folders.flatMap(folder => folder.files)
    assert.equal(entries.length, 1)
    assert.ok(entries.every(file => file.kind !== 'text'))
    assert.equal((await get('/archive/activities/line1-hackathon')).recordsCount, 2)
    assert.equal(entries.find(file => file.kind === 'link').sourceUrl, 'https://example.com/actual-input')
    assert.deepEqual((await get('/archive/activities/line1-hackathon')).timeline, [])
    // 같은 이름의 파일은 ID를 임의 선택하지 않고 문자열 근거로 남긴다.
    const duplicates = new FormData()
    duplicates.set('mode', 'change')
    duplicates.append('files', new Blob(['a']), 'same.txt')
    duplicates.append('files', new Blob(['b']), 'same.txt')
    const duplicateDraft = await (await fetch(base + '/chat', { method: 'POST', body: duplicates })).json()
    await send('/records', { activityId: 'ai-contest', analysisId: duplicateDraft.analysisId })
    const ambiguous = await get('/archive/activities/ai-contest')
    assert.equal(ambiguous.materialsCount, 2)
    assert.deepEqual(ambiguous.timeline[0].evidenceFileIds, [])
    assert.ok(ambiguous.timeline[0].evidenceLabels.includes('same.txt'))
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})

test('기존 2열 activities DB를 데이터 손실 없이 마이그레이션하고 재실행한다', () => {
  const directory = mkdtempSync(join(tmpdir(), '1line-archive-migration-'))
  const path = join(directory, 'migration.db')
  const legacy = new DatabaseSync(path)
  legacy.exec("CREATE TABLE activities (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE); INSERT INTO activities VALUES ('custom', '직접 만든 활동')")
  legacy.close()
  let db
  try {
    db = openDatabase(path)
    assert.equal(db.prepare('SELECT name FROM activities WHERE id = ?').get('custom').name, '직접 만든 활동')
    assert.equal(db.prepare('SELECT summary FROM activities WHERE id = ?').get('custom').summary, null)
    db.prepare('UPDATE activities SET role = ? WHERE id = ?').run('내 역할', 'custom')
    const historical = '2025-06-30T08:00:00.000Z'
    db.prepare('INSERT INTO records VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('legacy-record', 'custom', null, '실제 과거 기록', JSON.stringify(createMockLinkReply('https://example.com/old')), historical, historical)
    db.close()
    db = openDatabase(path)
    assert.equal(db.prepare('SELECT role FROM activities WHERE id = ?').get('custom').role, '내 역할')
    assert.equal(db.prepare('SELECT updated_at FROM activities WHERE id = ?').get('custom').updated_at, historical)
    assert.equal(db.prepare('SELECT updated_at FROM activities WHERE id = ?').get('line1-hackathon').updated_at, null)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activities').get().n, 6)
  } finally {
    db?.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
    rmdirSync(directory)
  }
})
