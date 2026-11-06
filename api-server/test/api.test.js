import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../test-support/app.js'

test('원본·대화 보관, 기록·중복 방지·수정·Timeline·DB 재시작 유지', async () => {
  const dir = mkdtempSync(join(tmpdir(), '1line-api-test-'))
  const path = join(dir, 'test.db')
  let db = openDatabase(path)
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const form = new FormData()
    form.set('message', '회의 자료입니다.')
    form.set('conversationId', 'test-conversation')
    form.set('files', new Blob(['original file bytes']), '회의록.txt')
    const response = await fetch(`${base}/chat`, { method: 'POST', body: form })
    assert.equal(response.status, 201)
    const draft = await response.json()
    assert.equal(draft.reply.analysis.files[0].name, '회의록.txt')
    assert.equal(await (await fetch(`${base}/files/${draft.attachments[0].id}`)).text(), 'original file bytes')
    assert.equal((await (await fetch(`${base}/conversations/test-conversation/messages`)).json()).length, 1)
    assert.deepEqual(await (await fetch(`${base}/activities/line1-hackathon/records`)).json(), [])
    const save = { activityId: 'line1-hackathon', analysisId: draft.analysisId }
    const savedResponse = await fetch(`${base}/records`, json('POST', save))
    assert.equal(savedResponse.status, 201)
    const saved = await savedResponse.json()
    assert.equal(saved.message, '')
    assert.equal(db.prepare('SELECT message FROM analyses WHERE id = ?').get(draft.analysisId).message, '회의 자료입니다.')
    assert.equal((await fetch(`${base}/records`, json('POST', save))).status, 409)
    assert.deepEqual(await (await fetch(`${base}/activities/line1-hackathon/timeline`)).json(), [])
    const change = { before: '이전', after: '이후', category: '범위 변경', evidence: ['회의 자료'] }
    assert.equal((await fetch(`${base}/records/${saved.id}`, json('PATCH', { activityId: 'computer-vision', materialType: '회의록', changes: [change] }))).status, 200)
    const events = await (await fetch(`${base}/activities/computer-vision/timeline`)).json()
    assert.equal(events.length, 1)
    assert.equal(events[0].isTurningPoint, false)
    assert.deepEqual(await (await fetch(`${base}/activities/line1-hackathon/records`)).json(), [])
    assert.equal((await fetch(`${base}/records/${saved.id}`, json('PATCH', { activityId: 'missing' }))).status, 404)
    assert.equal((await fetch(`${base}/records`, json('POST', { activityId: 'line1-hackathon', reply: {} }))).status, 400)
    // 업로드 원본 없이 /example의 카드 JSON만 저장하는 경로도 확인한다.
    const preview = await fetch(`${base}/records`, json('POST', { activityId: 'line1-hackathon', reply: { ...draft.reply, analysis: { ...draft.reply.analysis, changes: [change] } } }))
    assert.equal(preview.status, 201)
    assert.equal((await (await fetch(`${base}/activities/line1-hackathon/timeline`)).json()).length, 1)
    assert.equal((await fetch(`${base}/chat`, { method: 'POST', body: new FormData() })).status, 400)
    await fetch(`${base}/records/${saved.id}`, json('PATCH', { changes: [] }))
    assert.deepEqual(await (await fetch(`${base}/activities/computer-vision/timeline`)).json(), [])
    await new Promise(resolve => server.close(resolve))
    db.prepare('INSERT INTO analysis_jobs VALUES (?, ?, ?, NULL)').run('restart-job', draft.analysisId, Date.now())
    db.close()
    db = openDatabase(path)
    assert.equal(db.prepare('SELECT analysis_id FROM analysis_jobs WHERE id = ?').get('restart-job').analysis_id, draft.analysisId)
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM records').get().count, 2)
    assert.equal(db.prepare('SELECT name FROM files').get().name, '회의록.txt')
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve))
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
