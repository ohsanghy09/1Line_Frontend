import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../test-support/app.js'
import { createMockReply } from '../test-support/mock-reply.js'

test('홈 최근 활동·자료는 서로 다른 시간 기준과 실제 ID를 사용한다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const get = async path => {
    const response = await fetch(base + path)
    assert.equal(response.status, 200)
    return response.json()
  }
  const send = async (path, body, method = 'POST') => {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text())
    return response.json()
  }
  try {
    assert.deepEqual(await get('/home/recent'), { activities: [], records: [] })
    const form = new FormData()
    form.set('message', '실제로 올린 파일')
    form.append('files', new Blob(['first']), '첫번째.txt')
    form.append('files', new Blob(['second']), '두번째.txt')
    const draft = await (await fetch(base + '/chat', { method: 'POST', body: form })).json()
    assert.deepEqual(await get('/home/recent'), { activities: [], records: [] })

    const ids = ['line1-hackathon', 'computer-vision', 'scent-orbit', 'data-vis']
    const saved = []
    for (const [index, activityId] of ids.entries()) {
      const record = await send('/records', index === 1 ? { activityId, analysisId: draft.analysisId }
        : { activityId, message: `직접 입력 ${index}`, reply: createMockReply(`직접 입력 ${index}`, [], 'no-change') })
      saved.push(record)
      const when = `2026-01-0${index + 1}T00:00:00.000Z`
      db.prepare('UPDATE records SET created_at = ?, updated_at = ? WHERE id = ?').run(when, when, record.id)
      db.prepare('UPDATE activities SET updated_at = ? WHERE id = ?').run(when, activityId)
    }
    const first = await get('/home/recent')
    assert.deepEqual(first.activities.map(activity => activity.id), ids.slice(1).reverse())
    assert.deepEqual(first.records.map(record => record.recordId), [saved[3].id, saved[2].id, saved[1].id])
    assert.equal(first.records[2].id, draft.attachments[0].id)
    assert.equal(first.records[2].savedAt, '2026-01-02T00:00:00.000Z')
    // 업로드는 오늘 했지만 확정 저장 기준으로 정렬했으므로 세 번째가 된다.
    assert.equal(first.records[2].title, '첫번째.txt')
    const drawer = await get(`/archive/activities/computer-vision/materials/${encodeURIComponent(first.records[2].id)}`)
    assert.equal(drawer.file.name, first.records[2].title)
    assert.equal(first.activities.find(activity => activity.id === 'computer-vision').materialsCount, 2)

    await send(`/records/${saved[0].id}`, { summary: '수정한 요약' }, 'PATCH')
    const edited = await get('/home/recent')
    assert.equal(edited.activities[0].id, ids[0])
    assert.equal(edited.activities[0].updatedAt, (await get(`/archive/activities/${ids[0]}`)).updatedAt)
    assert.deepEqual(edited.records.map(record => [record.id, record.savedAt]), first.records.map(record => [record.id, record.savedAt]))

    // 최근 추가 기록은 순서를 유지하고 연결할 활동·자료 유형만 최신 상태로 바뀐다.
    const moved = await send(`/records/${saved[3].id}`, { activityId: ids[0], materialType: '이동한 기록' }, 'PATCH')
    const afterMove = await get('/home/recent')
    assert.equal(afterMove.records[0].activityId, ids[0])
    assert.equal(afterMove.records[0].materialType, '이동한 기록')
    assert.equal(afterMove.records[0].savedAt, first.records[0].savedAt)
    for (const activityId of [ids[0], ids[3]]) {
      const item = afterMove.activities.find(activity => activity.id === activityId)
      assert.equal(item.updatedAt, moved.updatedAt)
      assert.equal(item.materialsCount, activityId === ids[0] ? 2 : 0)
    }
    assert.equal((await fetch(base + `/archive/activities/${ids[3]}/materials/${encodeURIComponent(afterMove.records[0].id)}`)).status, 404)
    assert.equal((await get(`/archive/activities/${ids[0]}/materials/${encodeURIComponent(afterMove.records[0].id)}`)).file.recordId, saved[3].id)

    const metadata = { category: '수업', status: '완료', role: null, period: null, summary: null }
    const updated = await send(`/records/${saved[2].id}`, { activityUpdates: metadata }, 'PATCH')
    const afterMetadata = await get('/home/recent')
    assert.equal(afterMetadata.activities.find(activity => activity.id === ids[2]).updatedAt, updated.updatedAt)
    assert.equal(afterMetadata.activities.find(activity => activity.id === ids[2]).status, '완료')
    assert.deepEqual(afterMetadata.records.map(record => [record.id, record.savedAt]), afterMove.records.map(record => [record.id, record.savedAt]))

    // 동률에서도 기록 삽입 순서·다중 파일의 원래 순서를 일관되게 유지한다.
    const tied = '2026-01-01T00:00:00.000Z'
    db.prepare('UPDATE records SET created_at = ?, updated_at = ?').run(tied, tied)
    db.prepare('UPDATE activities SET updated_at = ? WHERE updated_at IS NOT NULL').run(tied)
    const equalTimes = await get('/home/recent')
    assert.deepEqual(equalTimes.records.map(record => record.recordId), [saved[3].id, saved[2].id, saved[1].id])
    assert.equal(equalTimes.records[2].id, draft.attachments[0].id)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})
