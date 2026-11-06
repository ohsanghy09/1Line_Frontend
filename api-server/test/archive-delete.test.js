import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../test-support/app.js'
import { createMockReply, createMockLinkReply } from '../test-support/mock-reply.js'

async function setup(t, provider) {
  const db = openDatabase(':memory:')
  const ai = express()
  ai.use(express.json())
  ai.post('/api/analyze/records/:id/exclude-file', (req, res) => provider(req, res, db))
  const aiServer = ai.listen(0, '127.0.0.1')
  await new Promise(resolve => aiServer.once('listening', resolve))
  const app = createApp(db, { aiBaseUrl: `http://127.0.0.1:${aiServer.address().port}` })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  t.after(async () => { await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => aiServer.close(resolve))]); db.close() })
  const base = `http://127.0.0.1:${server.address().port}/api`
  const send = (path, body, method = 'POST') => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const get = async path => (await fetch(base + path)).json()
  const save = async (names, activityId = 'line1-hackathon') => {
    const form = new FormData()
    form.set('message', '실제 경험 설명'); form.set('mode', 'change')
    for (const name of names) form.append('files', new Blob([name]), name)
    const draft = await (await fetch(base + '/chat', { method: 'POST', body: form })).json()
    const response = await send('/records', { analysisId: draft.analysisId, activityId })
    assert.equal(response.status, 201)
    return { draft, record: await response.json() }
  }
  return { db, send, get, save, base }
}

test('활동명 확인 후 활동·원본·텍스트 기록·타임라인 삭제, 대화 보존 및 성장 결과 무효화', async t => {
  const { db, send, get, save, base } = await setup(t)
  const target = await save(['a.txt', 'b.txt'])
  const other = await save(['other.txt'], 'computer-vision')
  await send('/records', { activityId: 'line1-hackathon', message: '파일 없는 경험', reply: createMockReply('경험', [], 'change') })
  db.prepare('INSERT INTO journey_analyses VALUES (?, ?, ?, ?, ?, ?, ?)').run('j1', 'old', 3, JSON.stringify({
    source: 'api', summary: { title: '삭제할 근거', description: '기존 요약' }, badges: [], events: [], typeOptions: [{ value: 'all', label: '전체' }], axisOptions: [{ value: 'all', label: '전체 분야' }],
  }), 'test', 'test', new Date().toISOString())
  assert.equal((await send('/archive/activities/line1-hackathon', { confirmation: '잘못된 이름' }, 'DELETE')).status, 400)
  assert.equal((await get('/archive/activities/line1-hackathon')).materialsCount, 2)
  assert.equal((await send('/archive/activities/line1-hackathon', { confirmation: '1호선톤' }, 'DELETE')).status, 200)
  assert.equal((await fetch(base + '/archive/activities/line1-hackathon')).status, 404)
  assert.equal((await fetch(base + '/records/' + target.record.id)).status, 404)
  assert.equal((await fetch(base + '/files/' + target.draft.attachments[0].id)).status, 404)
  assert.equal(db.prepare('SELECT count(*) AS count FROM timeline_events WHERE record_id = ?').get(target.record.id).count, 0)
  assert.equal((await get('/archive/activities/computer-vision')).materialsCount, 1)
  assert.equal((await fetch(base + '/files/' + other.draft.attachments[0].id)).status, 200)
  const conversation = await get(`/conversations/${target.draft.conversationId}/messages`)
  assert.equal(conversation[0].message, '실제 경험 설명')
  assert.equal(conversation[0].reply.kind, 'general')
  assert.deepEqual(conversation[0].attachments, [])
  assert.equal((await send('/records', { analysisId: target.draft.analysisId, activityId: 'computer-vision' })).status, 400)
  const journey = await get('/journey')
  assert.equal(journey.analysis.stale, true)
  assert.deepEqual(journey.events, [])
  assert.match(journey.summary.description, /갱신/)
  assert.equal((await get('/home/recent')).activities.some(item => item.id === 'line1-hackathon'), false)
})

test('자료 소유 활동 검사, 마지막 파일과 링크의 기록 삭제, 빈 활동 유지 및 메타정보 초기화', async t => {
  const { db, send, get, save, base } = await setup(t)
  const { draft, record } = await save(['a.txt'])
  const path = `/archive/activities/line1-hackathon/materials/${draft.attachments[0].id}`
  assert.equal((await send(path.replace('line1-hackathon', 'computer-vision'), {}, 'DELETE')).status, 404)
  db.prepare("UPDATE activities SET summary = '이전 요약', role = '개발', status = '완료', metadata_model = 'test' WHERE id = 'line1-hackathon'").run()
  assert.equal((await send(path, {}, 'DELETE')).status, 200)
  const activity = await get('/archive/activities/line1-hackathon')
  assert.equal(activity.materialsCount, 0); assert.equal(activity.recordsCount, 0)
  assert.equal(activity.role, '미설정'); assert.equal(activity.metadataAnalysis.status, 'idle')
  assert.deepEqual(activity.timeline, [])
  assert.equal((await fetch(base + '/records/' + record.id)).status, 404)
  assert.equal((await send(path, {}, 'DELETE')).status, 404)
  const link = await (await send('/records', { activityId: 'line1-hackathon', reply: createMockLinkReply('https://example.com') })).json()
  assert.equal((await send(`/archive/activities/line1-hackathon/materials/${encodeURIComponent('record:' + link.id)}`, {}, 'DELETE')).status, 200)
  assert.equal((await get('/archive/activities/line1-hackathon')).recordsCount, 0)
})

test('다중 파일 삭제는 남은 원본 재분석 결과로 교체하며 이전 요약·변화는 남기지 않는다', async t => {
  let calls = 0
  const { db, send, get, save } = await setup(t, (req, res, db) => {
    calls++
    const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id)
    const remaining = db.prepare('SELECT id, name FROM files WHERE analysis_id = ? AND id != ? ORDER BY rowid').all(record.analysis_id, req.body.fileId)
    const reply = JSON.parse(record.reply)
    reply.analysis.summary = '남은 자료만의 새 요약'
    reply.analysis.changes = []
    reply.analysis.files = remaining.map(file => ({ name: file.name, materialType: reply.analysis.materialType, previousVersion: null }))
    reply.analysis.groups = [{ materialType: reply.analysis.materialType, count: remaining.length }]
    res.json({ recordReply: record.reply, fileIds: remaining.map(file => file.id), reply })
  })
  const { draft, record } = await save(['a.txt', 'b.txt'])
  const path = `/archive/activities/line1-hackathon/materials/${draft.attachments[0].id}`
  assert.equal((await send(path, {}, 'DELETE')).status, 200)
  assert.equal(calls, 1)
  const activity = await get('/archive/activities/line1-hackathon')
  assert.equal(activity.materialsCount, 1); assert.equal(activity.recordsCount, 1)
  assert.equal(activity.folders[0].files[0].summary, '남은 자료만의 새 요약')
  assert.equal(activity.folders[0].files[0].id, draft.attachments[1].id)
  assert.deepEqual(activity.timeline, [])
  assert.equal(JSON.parse(db.prepare('SELECT reply FROM records WHERE id = ?').get(record.id).reply).analysis.files.length, 1)
})

test('재분석 실패·동시 수정·DB 삭제 오류는 자료를 부분 삭제하지 않는다', async t => {
  let mode = 'failure'
  const { db, send, get, save } = await setup(t, (req, res, db) => {
    if (mode === 'failure') return res.status(503).json({ error: 'test' })
    const record = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id)
    const files = db.prepare('SELECT id FROM files WHERE analysis_id = ? AND id != ? ORDER BY rowid').all(record.analysis_id, req.body.fileId)
    const reply = JSON.parse(record.reply)
    reply.analysis.files = reply.analysis.files.slice(1)
    reply.analysis.changes = []
    db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run('changed', record.id)
    res.json({ recordReply: record.reply, fileIds: files.map(file => file.id), reply })
  })
  const { draft, record } = await save(['a.txt', 'b.txt'])
  const path = `/archive/activities/line1-hackathon/materials/${draft.attachments[0].id}`
  assert.equal((await send(path, {}, 'DELETE')).status, 502)
  assert.equal((await get('/archive/activities/line1-hackathon')).materialsCount, 2)
  mode = 'race'
  assert.equal((await send(path, {}, 'DELETE')).status, 409)
  assert.equal((await get('/archive/activities/line1-hackathon')).materialsCount, 2)
  db.exec("CREATE TRIGGER reject_activity_delete BEFORE DELETE ON activities BEGIN SELECT RAISE(ABORT, 'test rollback'); END")
  assert.equal((await send('/archive/activities/line1-hackathon', { confirmation: '1호선톤' }, 'DELETE')).status, 500)
  assert.equal(db.prepare('SELECT count(*) AS count FROM files WHERE analysis_id = ?').get(draft.analysisId).count, 2)
  assert.ok(db.prepare('SELECT id FROM records WHERE id = ?').get(record.id))
  assert.notEqual(JSON.parse(db.prepare('SELECT reply FROM analyses WHERE id = ?').get(draft.analysisId).reply).kind, 'general')
})
