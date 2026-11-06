import test from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/database.js'
import { createApp } from '../src/app.js'
import { createMockReply } from '../src/mock-reply.js'

test('검색 API는 확정 이름·입력·요약을 검색하고 파일 BLOB 본문은 읽지 않는다', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db, { testMockAnalysis: true }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const search = async (q, rest = {}) => {
    const response = await fetch(`${base}/archive/activities?${new URLSearchParams({ q, ...rest })}`)
    assert.equal(response.status, 200)
    return response.json()
  }
  const save = async body => {
    const response = await fetch(base + '/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    assert.equal(response.status, 201)
    return response.json()
  }
  try {
    db.prepare('UPDATE activities SET category = ?, status = ?, summary = ? WHERE id = ?')
      .run('프로젝트', '진행 중', '활동 전체 전용 요약', 'line1-hackathon')
    db.prepare('UPDATE activities SET category = ?, status = ? WHERE id = ?').run('전공수업', '완료', 'computer-vision')
    const form = new FormData()
    form.set('message', '입력 전용 사용자 인터뷰')
    form.append('files', new Blob(['PDF본문에만있는비밀키워드'], { type: 'application/pdf' }), 'Research & Notes.pdf')
    form.append('files', new Blob(['두번째파일내부전용'], { type: 'application/pdf' }), '다른 자료.pdf')
    const draft = await (await fetch(base + '/chat', { method: 'POST', body: form })).json()
    assert.deepEqual((await search('Research')).items, [])
    const saved = await save({ activityId: 'line1-hackathon', analysisId: draft.analysisId })
    const reply = createMockReply('기록', [], 'no-change')
    reply.analysis.summary = '저장 요약 전용 문구'
    await save({ activityId: 'computer-vision', message: '독립 텍스트', reply })

    for (const q of ['1호선톤', '활동 전체 전용', '  rEsEaRcH   &   NOTES.pdf ', '입력 전용', '사용자 인터뷰'.normalize('NFD')]) {
      const result = await search(q)
      assert.deepEqual(result.items.map(item => item.id), ['line1-hackathon'])
      assert.equal(result.items[0].materialsCount, 2)
      assert.equal(result.total, 5)
    }
    assert.deepEqual((await search('저장 요약 전용')).items.map(item => item.id), ['computer-vision'])
    assert.equal((await search('')).items.length, 5)
    assert.equal((await search('    ')).items.length, 5)
    for (const q of ['PDF본문에만있는비밀키워드', '두번째파일내부전용', '%', "' OR 1=1 --"]) assert.deepEqual((await search(q)).items, [])
    assert.deepEqual((await search('Research', { category: '프로젝트', status: '진행 중' })).items.map(item => item.id), ['line1-hackathon'])
    assert.deepEqual((await search('Research', { status: '완료' })).items, [])
    assert.deepEqual((await search('Research', { category: '전공수업' })).items, [])
    assert.equal((await search('', { sort: 'materials' })).items[0].id, 'line1-hackathon')
    const older = '2025-01-01T00:00:00.000Z'
    db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run(older, saved.id)
    db.prepare('UPDATE activities SET updated_at = ? WHERE id = ?').run(older, 'line1-hackathon')
    assert.equal((await search('', { sort: 'recent', category: '프로젝트' })).items[0].id, 'line1-hackathon')
    const sorted = (await search('', { sort: 'oldest' })).items.filter(item => item.updatedAt !== null)
    assert.equal(sorted[0].id, 'line1-hackathon')
    for (const query of ['sort=invalid', 'status=invalid', 'q=a&q=b', 'q=' + 'a'.repeat(501)]) {
      assert.equal((await fetch(base + '/archive/activities?' + query)).status, 400)
    }
    // 검색 후에도 파일 원본은 그대로 보관되며 요약/본문을 새로 생성하지 않는다.
    assert.equal(Buffer.from(db.prepare('SELECT content FROM files WHERE id = ?').get(draft.attachments[0].id).content).toString(), 'PDF본문에만있는비밀키워드')
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})
