import { createHash } from 'node:crypto'
import { z } from 'zod'
import { transaction } from './database.js'
import { activityPeriod } from './validation.js'

// 입력 해시는 Python과 같은 배열·정렬·JSON 직렬화로 만든다. AI 출력 자체는 입력에 포함하지 않는다.
export function activitySnapshot(db, id) {
  const activity = db.prepare('SELECT id, name, category FROM activities WHERE id = ?').get(id)
  if (!activity) return null
  const records = db.prepare('SELECT id, message, reply, created_at, updated_at FROM records WHERE activity_id = ? ORDER BY id').all(id)
    .map(row => [row.id, row.message, row.reply, row.created_at, row.updated_at])
  const files = db.prepare(`SELECT r.id AS record_id, f.id, f.name FROM files f JOIN records r ON r.analysis_id = f.analysis_id
    WHERE r.activity_id = ? ORDER BY r.id, f.id`).all(id).map(row => [row.record_id, row.id, row.name])
  const fingerprint = createHash('sha256').update(JSON.stringify([[activity.id, activity.name, activity.category], records, files])).digest('hex')
  return { fingerprint, records, files }
}

const text = z.string().trim().min(1).max(20000)
const evidence = z.array(z.object({ recordId: text, quote: text }).strict()).min(1).max(10)
const fact = z.object({ value: text, evidence }).strict()
const dateFact = z.object({ value: z.string(), evidence }).strict()
const outputSchema = z.object({
  sourceFingerprint: text, recordCount: z.number().int().positive(), model: text,
  promptVersion: z.literal('activity-metadata-v1'),
  metadata: z.object({ summary: fact, role: fact.nullable(),
    status: z.object({ value: z.enum(['진행 중', '완료']), evidence }).strict().nullable(),
    period: z.object({ start: dateFact.nullable(), end: dateFact.nullable() }).strict(),
  }).strict(),
}).strict()

export function readActivityAnalysis(db, id) {
  const row = db.prepare('SELECT * FROM activities WHERE id = ?').get(id)
  if (!row) return null
  const snapshot = activitySnapshot(db, id)
  return {
    status: row.metadata_status ?? 'idle', error: row.metadata_error ?? null,
    updatedAt: row.metadata_updated_at ?? null,
    stale: snapshot.records.length > 0 && row.metadata_fingerprint !== snapshot.fingerprint,
  }
}

// 활동별로 저장을 묶는다. 동일 입력의 실패는 자동 재호출하지 않고 새 기록 변경만 다시 접수한다.
export function createActivityMetadataQueue(db, { aiBaseUrl, delayMs = 500, request = fetch } = {}) {
  const jobs = new Map()
  let closed = false
  db.prepare(`UPDATE activities SET metadata_status = 'failed', metadata_error = ? WHERE metadata_status IN ('queued', 'running')`)
    .run('서버가 재시작되어 활동 정보 분석이 중단됐어요. 다시 분석해 주세요.')

  function markFailed(id) {
    try {
      db.prepare("UPDATE activities SET metadata_status = 'failed', metadata_error = ? WHERE id = ?")
        .run(closed ? '서버가 종료되어 분석이 중단됐어요. 다시 분석해 주세요.' : '활동 정보를 갱신하지 못했어요. 저장한 자료와 기존 정보는 유지했어요. 다시 분석해 주세요.', id)
    } catch { /* 상태 기록도 실패할 경우 저장된 자료는 보존하며 조회의 stale로 재시도를 안내한다. */ }
  }

  function schedule(id) {
    if (closed) return false
    try {
      if (!activitySnapshot(db, id)) return false
      const job = jobs.get(id) ?? { timer: null, running: null, dirty: false, controller: null }
      if (job.running) { job.dirty = true; return true }
      db.prepare("UPDATE activities SET metadata_status = 'queued', metadata_error = NULL WHERE id = ?").run(id)
      if (job.timer) clearTimeout(job.timer)
      jobs.set(id, job)
      job.timer = setTimeout(() => {
        job.timer = null
        job.running = run(id, job).catch(() => { if (!job.cancelled) markFailed(id) }).finally(() => {
          if (jobs.get(id) !== job) return
          job.running = null
          if (!closed && job.dirty) {
            job.dirty = false
            if (!schedule(id)) jobs.delete(id)
          } else jobs.delete(id)
        })
      }, delayMs)
      job.timer.unref?.()
      return true
    } catch {
      markFailed(id)
      return false
    }
  }

  async function run(id, job) {
    const initial = activitySnapshot(db, id)
    if (!initial) return
    if (!initial.records.length) {
      // 기록이 다른 활동으로 모두 이동했으면 기존 AI 생성 정보도 남기지 않는다.
      db.prepare(`UPDATE activities SET summary = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE summary END,
        role = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE role END,
        status = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE status END,
        start_date = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE start_date END,
        end_date = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE end_date END,
        period = CASE WHEN metadata_model IS NOT NULL THEN NULL ELSE period END,
        metadata_status = 'idle', metadata_fingerprint = NULL, metadata_error = NULL WHERE id = ?`).run(id)
      return
    }
    db.prepare("UPDATE activities SET metadata_status = 'running' WHERE id = ?").run(id)
    job.controller = new AbortController()
    try {
      const base = (aiBaseUrl ?? process.env.AI_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '')
      const response = await request(`${base}/api/analyze/activities/${encodeURIComponent(id)}`, {
        method: 'POST', signal: AbortSignal.any([job.controller.signal, AbortSignal.timeout(150000)]),
      })
      const body = await response.json().catch(() => null)
      if (job.cancelled) return
      if (!response.ok) throw new Error('활동 정보를 분석하지 못했어요. AI 서버 상태를 확인하고 다시 분석해 주세요.')
      const parsed = outputSchema.safeParse(body)
      if (!parsed.success) throw new Error('활동 정보 분석 응답 형식을 확인하지 못했어요.')
      const output = parsed.data
      transaction(db, () => {
        const current = activitySnapshot(db, id)
        if (!current) return
        if (current.fingerprint !== initial.fingerprint || output.sourceFingerprint !== current.fingerprint || output.recordCount !== current.records.length) {
          // 실제 입력이 변경된 경우에만 새 입력으로 한 번 더 분석한다.
          if (current.fingerprint !== initial.fingerprint) job.dirty = true
          throw new Error('분석 중 기록이 변경됐어요. 최신 기록으로 다시 분석해 주세요.')
        }
        const sources = new Map(current.records.map(row => [row[0], [row[1], JSON.parse(row[2]).analysis.summary]]))
        const metadata = output.metadata
        for (const item of [metadata.summary, metadata.role, metadata.status, metadata.period.start, metadata.period.end].filter(Boolean)) {
          if (item.evidence.some(ref => !sources.get(ref.recordId)?.some(source => source.includes(ref.quote)))) {
            throw new Error('활동 정보의 근거가 저장된 기록과 일치하지 않아요.')
          }
        }
        const previous = db.prepare('SELECT * FROM activities WHERE id = ?').get(id)
        const period = activityPeriod.parse({ start: metadata.period.start?.value ?? previous.start_date,
          end: metadata.period.end?.value ?? previous.end_date })
        db.prepare(`UPDATE activities SET summary = ?, status = ?, role = ?, start_date = ?, end_date = ?, period = ?,
          metadata_status = 'ready', metadata_error = NULL, metadata_fingerprint = ?, metadata_model = ?, metadata_updated_at = ? WHERE id = ?`)
          .run(metadata.summary.value, metadata.status?.value ?? previous.status, metadata.role?.value ?? previous.role,
            period.start, period.end, period.start || period.end ? `${period.start ?? '미확인'} ~ ${period.end ?? ''}` : previous.period,
            current.fingerprint, output.model, new Date().toISOString(), id)
      })
    } catch {
      // 자료와 이전 메타정보를 보존한다. 공급자 원문·사용자 입력은 오류 로그에 남기지 않는다.
      if (!job.cancelled) markFailed(id)
    }
  }

  return {
    schedule,
    cancelPending(id) {
      const job = jobs.get(id)
      if (!job) return
      job.cancelled = true
      job.dirty = false
      clearTimeout(job.timer)
      job.controller?.abort()
      jobs.delete(id)
    },
    hasActive: () => jobs.size > 0,
    async close() {
      closed = true
      for (const job of jobs.values()) { clearTimeout(job.timer); job.controller?.abort() }
      await Promise.allSettled([...jobs.values()].map(job => job.running).filter(Boolean))
      jobs.clear()
    },
  }
}
