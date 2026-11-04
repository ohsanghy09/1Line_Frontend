import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/database.js'
import { createApp } from '../src/app.js'
import { jobProgress, MOCK_STAGE_MS } from '../src/progress.js'

test('목 진행 경계값과 시각 역전', () => {
  for (let stage = 0; stage <= 4; stage++) {
    const state = jobProgress(1000, 1000 + MOCK_STAGE_MS * stage)
    assert.equal(state.status, stage === 4 ? 'completed' : 'running')
    assert.equal(state.progress.steps.filter(step => step.status === 'completed').length, stage)
    assert.equal(state.progress.steps.filter(step => step.status === 'working').length, stage === 4 ? 0 : 1)
  }
  assert.equal(jobProgress(1000, 0).progress.steps.length, 1)
  assert.equal(jobProgress(1000, 1000 + MOCK_STAGE_MS - 1).progress.steps[0].status, 'working')
})

test('비동기 접수·진행·완료·실패·저장 제한', async () => {
  const db = openDatabase(':memory:')
  const server = createApp(db).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/api`
  try {
    const form = new FormData()
    form.set('files', new Blob(['original']), '원본.txt')
    const accepted = await fetch(`${base}/chat`, { method: 'POST', headers: { Prefer: 'respond-async' }, body: form })
    assert.equal(accepted.status, 202)
    const job = await accepted.json()
    assert.equal(job.status, 'running')
    assert.equal(job.reply, undefined)
    const stored = db.prepare('SELECT * FROM analysis_jobs WHERE id = ?').get(job.jobId)
    const save = () => fetch(`${base}/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activityId: 'line1-hackathon', analysisId: stored.analysis_id }) })
    assert.equal((await save()).status, 409)
    for (let stage = 1; stage <= 4; stage++) {
      db.prepare('UPDATE analysis_jobs SET started_at = ? WHERE id = ?').run(Date.now() - stage * MOCK_STAGE_MS, job.jobId)
      const state = await (await fetch(`${base}/chat/jobs/${job.jobId}`)).json()
      assert.equal(state.status, stage === 4 ? 'completed' : 'running')
      assert.equal(state.progress.steps.filter(step => step.status === 'completed').length, stage)
      if (stage === 4) {
        assert.equal(state.result.analysisId, stored.analysis_id)
        assert.equal(state.result.attachments[0].name, '원본.txt')
        assert.equal(state.result.reply.analysis.files[0].name, '원본.txt')
      } else assert.equal(state.result, undefined)
    }
    assert.equal((await save()).status, 201)
    assert.equal((await fetch(`${base}/chat/jobs/missing`)).status, 404)
    db.prepare('UPDATE analysis_jobs SET error = ? WHERE id = ?').run('목 처리 실패', job.jobId)
    const failed = await (await fetch(`${base}/chat/jobs/${job.jobId}`)).json()
    assert.equal(failed.status, 'failed')
    assert.equal(failed.error, '목 처리 실패')
    assert.equal((await save()).status, 409)
  } finally {
    await new Promise(resolve => server.close(resolve))
    db.close()
  }
})
