import { z } from 'zod'

const text = z.string().trim().min(1).max(20000)
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
  sourceUrl: linkSchema.shape.url.optional(),
  analysis: z.object({
    activity: z.object({ name: text, confidence: z.enum(['high', 'medium', 'low']).nullable() }),
    materialType: text, stage: text.nullable(), summary: text, noChangeMessage: text.optional(),
    changes: z.array(change).max(100),
    files: z.array(z.object({ name: text, materialType: text, previousVersion: text.nullable() })).max(100),
    groups: z.array(z.object({ materialType: text, count: z.number().int().positive() })).max(100),
    suggestedSaveMode: z.enum(['record-change', 'version-only', 'archive']),
  }),
})
export const saveSchema = z.object({
  activityId: text, analysisId: text.optional(), reply: replySchema.optional(),
  message: z.string().max(20000).default(''),
  classification: z.object({ materialType: text }).optional(),
}).refine(value => Boolean(value.analysisId) !== Boolean(value.reply), 'analysisId 또는 reply 중 하나를 보내주세요.')
export const editSchema = z.object({
  activityId: text.optional(), materialType: text.optional(), summary: text.optional(),
  content: text.optional(), changes: z.array(change).max(100).optional(),
}).strict().refine(value => Object.keys(value).length > 0, '수정할 값을 보내주세요.')
