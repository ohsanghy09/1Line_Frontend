import { z } from 'zod'

const text = z.string().trim().min(1).max(20000)
export const archiveQuerySchema = z.object({
  q: z.string().max(500).default(''), category: z.string().trim().min(1).max(200).default('all'),
  status: z.enum(['all', '진행 중', '완료']).default('all'),
  sort: z.enum(['recent', 'materials', 'oldest']).default('recent'),
}).strict()
// 월 단위/일 단위 날짜를 허용하며 실제 달력 날짜와 기간 순서도 검사한다.
export const activityDate = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/).refine(value => {
  const day = value.length === 7 ? `${value}-01` : value
  const parsed = new Date(`${day}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
}, '유효한 날짜를 입력해 주세요.')
export const activityPeriod = z.object({ start: activityDate.nullable(), end: activityDate.nullable() }).strict()
  .refine(value => !value.start || !value.end || value.start.slice(0, 7) <= value.end.slice(0, 7) && (value.start.length !== 10 || value.end.length !== 10 || value.start <= value.end), '종료일은 시작일보다 빠를 수 없습니다.')
export const activityMetadata = z.object({
  category: z.string().trim().min(1).max(200).refine(value => !['all', '전체'].includes(value), '전체는 활동 유형으로 사용할 수 없습니다.').nullable(), status: z.enum(['진행 중', '완료']).nullable(), role: text.nullable(),
  period: activityPeriod.nullable(), summary: text.nullable(),
}).strict()
const activityProposal = activityMetadata.partial().extend({
  name: text, confidence: z.enum(['high', 'medium', 'low']).nullable(),
  id: text.nullable().optional(), match: z.enum(['existing', 'new', 'unresolved']).optional(),
}).superRefine((value, context) => {
  if (value.match === 'existing' && !value.id || ['new', 'unresolved'].includes(value.match) && value.id != null) {
    context.addIssue({ code: 'custom', message: '활동 연결 상태와 ID가 일치하지 않습니다.' })
  }
})
export const linkSchema = z.object({
  url: z.string().trim().min(1).max(4096).url().refine(value => {
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    } catch { return false }
  }, 'HTTP 또는 HTTPS 링크를 입력해 주세요.'),
  conversationId: z.string().trim().min(1).max(200).optional(),
})
const change = z.object({ before: text, after: text, category: text, evidence: z.array(text).max(100) })
// 외부 JSON은 프론트 TypeScript 타입과 별개로 서버에서 검증한다.
export const replySchema = z.object({
  id: text, role: z.literal('assistant'),
  kind: z.enum(['text-analysis', 'file-analysis', 'no-change', 'batch-analysis', 'link-analysis']),
  content: text,
  activityCreated: z.boolean().optional(),
  sourceUrl: linkSchema.shape.url.optional(),
  analysis: z.object({
    activity: activityProposal,
    materialType: text, stage: text.nullable(), summary: text, noChangeMessage: text.optional(),
    changes: z.array(change).max(100),
    files: z.array(z.object({ name: text, materialType: text, previousVersion: text.nullable() })).max(100),
    groups: z.array(z.object({ materialType: text, count: z.number().int().positive() })).max(100),
    suggestedSaveMode: z.enum(['record-change', 'version-only', 'archive']),
  }),
})
export const saveSchema = z.object({
  activityId: text.optional(), newActivity: activityMetadata.extend({ name: text }).optional(),
  activityUpdates: activityMetadata.optional(), analysisId: text.optional(), reply: replySchema.optional(),
  message: z.string().max(20000).default(''),
  classification: z.object({ materialType: text }).optional(),
}).strict()
  .refine(value => Boolean(value.analysisId) !== Boolean(value.reply), 'analysisId 또는 reply 중 하나를 보내주세요.')
  .refine(value => Boolean(value.activityId) !== Boolean(value.newActivity), '기존 활동 ID 또는 새 활동 정보 중 하나를 보내주세요.')
  .refine(value => !value.activityUpdates || Boolean(value.activityId), '기존 활동 정보 수정에는 활동 ID가 필요합니다.')
export const editSchema = z.object({
  activityId: text.optional(), materialType: text.optional(), summary: text.optional(),
  content: text.optional(), changes: z.array(change).max(100).optional(),
  activityUpdates: activityMetadata.optional(),
}).strict().refine(value => Object.keys(value).length > 0, '수정할 값을 보내주세요.')
