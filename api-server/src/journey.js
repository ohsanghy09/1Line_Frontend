import { z } from 'zod'
import { createMockJourney } from './mock-journey.js'

const text = z.string().trim().min(1)
const options = z.array(z.object({ value: text, label: text }))
const unique = values => new Set(values).size === values.length

// 공급자 응답을 검증한다. Journey 조회는 현재 DB를 읽거나 수정하지 않는다.
export const journeySchema = z.object({
  source: z.enum(['mock', 'api']),
  summary: z.object({ title: text, description: text }),
  badges: z.array(z.object({ id: text, label: text })),
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
  })),
}).superRefine((data, context) => {
  const types = data.typeOptions.map(option => option.value)
  const axes = data.axisOptions.map(option => option.value)
  if (!types.includes('all') || !axes.includes('all') || !unique(types) || !unique(axes)
    || !unique(data.events.map(event => event.id)) || !unique(data.badges.map(badge => badge.id))
    || data.events.some(event => !types.includes(event.type) || !axes.includes(event.axis))) {
    context.addIssue({ code: 'custom', message: '성장 이벤트 ID 또는 분류 선택지가 올바르지 않습니다.' })
  }
})

export function readJourney() {
  const result = journeySchema.safeParse(createMockJourney())
  // 잘못된 공급자 응답은 요청 오류(400)가 아닌 서버 오류로 처리한다.
  if (!result.success) throw new Error('성장 분석 응답 형식이 올바르지 않습니다.')
  return result.data
}
