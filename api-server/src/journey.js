import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { transaction } from './database.js'
import { journeySnapshot } from './journey-context.js'

const text = z.string().trim().min(1)
const icon = z.string().trim().min(1).max(16)
// 이전 저장 결과에는 icon이 없을 수 있다. 새 분석의 아이콘은 공급자 경계에서 필수 검사한다.
const options = z.array(z.object({ value: text, label: text, icon: icon.optional() }))
const unique = values => new Set(values).size === values.length
const evidence = z.array(z.object({ recordId: text, quote: text })).min(1).max(20)

// 실제 공급자 응답과 저장 결과를 같은 계약으로 검증한다.
export const journeySchema = z.object({
  source: z.literal('api'),
  summary: z.object({ title: text, description: text, evidence: evidence.optional() }),
  badges: z.array(z.object({ id: text, label: text, icon: icon.optional(), evidence: evidence.optional() })).max(10),
  typeOptions: options,
  axisOptions: options,
  events: z.array(z.object({
    id: text,
    occurredAt: z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/),
    activity: z.object({ id: text.nullable(), name: text }),
    type: text.refine(value => value !== 'all'),
    axis: text.refine(value => value !== 'all'),
    title: text, description: text,
    comparison: z.object({ before: text, after: text, evidence: z.array(text) }).optional(),
    evidence: evidence.optional(),
  })).max(20),
  analysis: z.object({
    id: text.nullable(), generatedAt: text.nullable(), stale: z.boolean(),
    recordCount: z.number().int().nonnegative(), currentRecordCount: z.number().int().nonnegative(),
    model: text.nullable(), promptVersion: text.nullable(),
  }).optional(),
}).superRefine((data, context) => {
  const types = data.typeOptions.map(option => option.value)
  const axes = data.axisOptions.map(option => option.value)
  if (!types.includes('all') || !axes.includes('all') || !unique(types) || !unique(axes)
    || !unique(data.events.map(event => event.id)) || !unique(data.badges.map(badge => badge.id))
    || data.events.some(event => !types.includes(event.type) || !axes.includes(event.axis))) {
    context.addIssue({ code: 'custom', message: '성장 이벤트 ID 또는 분류 선택지가 올바르지 않습니다.' })
  }
})

export function readJourney(db) {
  return transaction(db, () => {
    const snapshot = journeySnapshot(db)
    const saved = db.prepare('SELECT * FROM journey_analyses ORDER BY created_at DESC, rowid DESC LIMIT 1').get()
    const data = saved ? journeySchema.parse(JSON.parse(saved.result_json)) : {
      source: 'api', summary: { title: '아직 성장 분석이 없어요.', description: '홈에서 기록을 저장한 뒤 성장 분석을 실행해 주세요.' },
      badges: [], typeOptions: [{ value: 'all', label: '전체' }], axisOptions: [{ value: 'all', label: '전체 분야' }], events: [],
    }
    return { ...data, analysis: {
      id: saved?.id ?? null, generatedAt: saved?.created_at ?? null,
      stale: Boolean(saved && saved.source_fingerprint !== snapshot.fingerprint),
      recordCount: saved?.record_count ?? 0, currentRecordCount: snapshot.records.length,
      model: saved?.model ?? null, promptVersion: saved?.prompt_version ?? null,
    } }
  })
}

const providerSchema = z.object({
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/), recordCount: z.number().int().min(1).max(100),
  model: text, promptVersion: text, result: journeySchema,
}).superRefine((output, context) => {
  const types = output.result.typeOptions.filter(option => option.value !== 'all')
  const labels = types.map(option => option.label.normalize('NFKC').trim().toLowerCase())
  const used = new Set(output.result.events.map(event => event.type))
  const axes = output.result.axisOptions.filter(option => option.value !== 'all')
  const axisLabels = axes.map(option => option.label.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase())
  const usedAxes = new Set(output.result.events.map(event => event.axis))
  if (types.length > 8 || !unique(labels) || types.some(option => !option.icon || !used.has(option.value))
    || output.result.badges.some(badge => !badge.icon)) {
    context.addIssue({ code: 'custom', message: '분석 분류·아이콘이 누락되거나 중복됐습니다.' })
  }
  // 저장 결과 조회는 과거 고정 분야도 허용하고, 새 공급자 결과에만 동적 분야 계약을 적용한다.
  if (axes.length > 8 || !unique(axisLabels) || axisLabels.some(label => ['전체', '전체 분야', '전체분야'].includes(label))
    || axes.some(option => option.label.length > 40 || !usedAxes.has(option.value)) || usedAxes.size !== axes.length) {
    context.addIssue({ code: 'custom', message: '성장 분야가 중복되거나 이벤트와 일치하지 않습니다.' })
  }
})

export async function generateJourney(db, { aiBaseUrl = process.env.AI_API_BASE_URL ?? 'http://127.0.0.1:8000' } = {}) {
  const fail = (status, message) => Object.assign(new Error(message), { status, publicMessage: true })
  let response
  try {
    response = await fetch(`${aiBaseUrl.replace(/\/$/, '')}/api/analyze/journey`, {
      method: 'POST', signal: AbortSignal.timeout(135_000),
    })
  } catch (error) {
    throw fail(error.name === 'TimeoutError' ? 504 : 502, error.name === 'TimeoutError'
      ? '성장 분석 응답 시간이 초과됐어요. 다시 조회한 뒤 갱신해 주세요.' : 'AI 서버에 연결하지 못했어요. 실행 상태를 확인해 주세요.')
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw fail([409, 422, 429, 502, 503, 504].includes(response.status) ? response.status : 502,
    typeof body?.error === 'string' ? body.error : '성장 분석 요청에 실패했어요.')
  const parsed = providerSchema.safeParse(body)
  if (!parsed.success) throw fail(502, '성장 분석 응답 형식을 확인할 수 없어요.')
  const output = parsed.data
  transaction(db, () => {
    const snapshot = journeySnapshot(db)
    if (snapshot.fingerprint !== output.sourceFingerprint || snapshot.records.length !== output.recordCount) {
      throw fail(409, '분석 중 기록이 변경됐어요. 최신 기록으로 다시 분석해 주세요.')
    }
    const records = new Map(snapshot.records.map(row => [row[0], row]))
    const check = references => {
      if (!references?.length) throw fail(502, '성장 분석의 근거 기록이 없어요.')
      for (const item of references) {
        const row = records.get(item.recordId)
        if (!row || ![row[3], JSON.parse(row[4]).analysis.summary].some(value => typeof value === 'string' && value.includes(item.quote))) {
          throw fail(502, '성장 분석의 근거가 실제 기록과 일치하지 않아요.')
        }
      }
    }
    check(output.result.summary.evidence)
    for (const badge of output.result.badges) check(badge.evidence)
    for (const event of output.result.events) {
      check(event.evidence)
      const target = event.evidence.map(item => records.get(item.recordId)).find(row => row[1] === event.activity.id)
      if (!target || event.occurredAt !== event.evidence.map(item => records.get(item.recordId)[5]).sort().at(-1).slice(0, 7)
        || event.comparison && new Set(event.evidence.map(item => item.recordId)).size < 2) {
        throw fail(502, '성장 이벤트의 활동·날짜·비교 근거가 실제 기록과 일치하지 않아요.')
      }
      event.activity.name = target[2]
      if (event.comparison) event.comparison.evidence = event.evidence.map(item => item.quote)
    }
    const id = randomUUID()
    // 재분석 결과는 별도 스냅샷이며 홈 기록과 Timeline을 수정하지 않는다.
    for (const event of output.result.events) event.id = randomUUID()
    for (const badge of output.result.badges) badge.id = randomUUID()
    db.prepare('INSERT INTO journey_analyses VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, snapshot.fingerprint, output.recordCount, JSON.stringify(output.result), output.model, output.promptVersion, new Date().toISOString())
  })
  return readJourney(db)
}
