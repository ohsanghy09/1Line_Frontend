import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../test-support/database.js'
import { createApp } from '../test-support/app.js'

test('링크 검증·접수·링크 진행·확정 저장·수정에서 URL 보존', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const url = 'https://github.com/example/project?tab=readme#소개'
  try {
    for (const invalid of ['', 'invalid', 'javascript:alert(1)', 'file:///secret', 'ftp://example.com/file', 'https://user:password@example.com', 'https://example.com/' + 'a'.repeat(4096)]) {
      assert.equal((await fetch(`${base}/chat/links`, json('POST', { url: invalid }))).status, 400)
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM analyses').get().n, 0)
    const response = await fetch(`${base}/chat/links`, json('POST', { url, conversationId: 'links-test' }))
    assert.equal(response.status, 202)
    const accepted = await response.json()
    assert.equal(accepted.progress.steps[0].label, '링크 확인 중...')
    const job = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(accepted.jobId)
    const saveBody = { activityId: 'computer-vision', analysisId: job.analysis_id, classification: { materialType: '참고 링크' } }
    assert.equal((await fetch(`${base}/records`, json('POST', saveBody))).status, 409)
    db.prepare('UPDATE analysis_jobs SET started_at = ? WHERE id = ?').run(Date.now() - 3000, accepted.jobId)
    const finished = await (await fetch(`${base}/chat/jobs/${accepted.jobId}`)).json()
    assert.equal(finished.status, 'completed')
    assert.equal(finished.result.reply.kind, 'link-analysis')
    assert.equal(finished.result.reply.sourceUrl, url)
    assert.equal(finished.result.message, url)
    assert.equal(finished.result.conversationId, 'links-test')
    assert.deepEqual(finished.result.reply.analysis.changes, [])
    const savedResponse = await fetch(`${base}/records`, json('POST', saveBody))
    assert.equal(savedResponse.status, 201)
    const saved = await savedResponse.json()
    assert.equal(saved.reply.sourceUrl, url)
    assert.equal(saved.reply.analysis.materialType, '참고 링크')
    const edited = await (await fetch(`${base}/records/${saved.id}`, json('PATCH', { activityId: 'line1-hackathon', materialType: '기획 링크' }))).json()
    assert.equal(edited.reply.sourceUrl, url)
    assert.equal(edited.reply.analysis.activity.name, '1호선톤')
    assert.equal(edited.reply.analysis.materialType, '기획 링크')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM timeline_events').get().n, 0)
    const standalone = await fetch(`${base}/records`, json('POST', { activityId: 'line1-hackathon', reply: finished.result.reply }))
    assert.equal((await standalone.json()).reply.sourceUrl, url)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})
