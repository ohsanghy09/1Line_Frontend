import { z } from 'zod'
import { transaction } from './database.js'
import { activityDate, activityPeriod } from './validation.js'

const text = z.string().trim().min(1).max(20000)
const actionSchema = z.object({
  activityId: text, activityName: text,
  updates: z.array(z.object({ field: z.enum(['role', 'status', 'summary', 'startDate', 'endDate']), value: text.nullable() }).strict()).min(1).max(5),
}).strict().superRefine((action, context) => {
  const fields = action.updates.map(item => item.field)
  if (new Set(fields).size !== fields.length) context.addIssue({ code: 'custom', message: '수정 항목이 중복됐어요.' })
  for (const item of action.updates) {
    if (item.field === 'status' && item.value !== null && !['진행 중', '완료'].includes(item.value)) context.addIssue({ code: 'custom', message: '지원하지 않는 상태예요.' })
    if (['startDate', 'endDate'].includes(item.field) && item.value !== null && !activityDate.safeParse(item.value).success) context.addIssue({ code: 'custom', message: '활동 날짜를 확인해 주세요.' })
  }
})
export const chatUpdateRequest = z.object({ analysisId: text }).strict()
const fail = (status, message) => Object.assign(new Error(message), { status })

// 완료된 AI 작업의 허용된 필드만 적용한다. 재조회·재요청은 같은 결과를 돌려주며 다시 수정하지 않는다.
export function applyActivityChatUpdate(db, analysisId) {
  return transaction(db, () => {
    const draft = db.prepare(`SELECT a.*, j.status AS job_status, j.kind AS job_kind FROM analyses a
      JOIN ai_chat_jobs j ON j.analysis_id = a.id WHERE a.id = ?`).get(analysisId)
    if (!draft) throw fail(404, '수정 요청을 찾을 수 없어요.')
    if (draft.job_status !== 'completed') throw fail(409, '요청 해석이 끝난 뒤 다시 확인해 주세요.')
    if (draft.job_kind !== 'chat' || db.prepare('SELECT id FROM files WHERE analysis_id = ? LIMIT 1').get(analysisId)) throw fail(400, '첨부 없는 채팅 요청에서만 활동 정보를 수정할 수 있어요.')
    const reply = JSON.parse(draft.reply)
    const result = { analysisId, conversationId: draft.conversation_id, reply, changed: false }
    if (reply.kind === 'general' && reply.updatedActivityId) return result
    if (reply.kind !== 'activity-update' || reply.analysis !== null) throw fail(400, '활동 수정 요청이 아니에요.')
    const parsedAction = actionSchema.safeParse(reply.update)
    if (!parsedAction.success) throw fail(400, '수정할 항목과 값을 확인하지 못했어요. 다시 알려 주세요.')
    const action = parsedAction.data
    const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(action.activityId)
    if (!activity) throw fail(404, '수정할 활동이 없어졌어요. 활동명을 다시 알려 주세요.')
    const updates = Object.fromEntries(action.updates.map(item => [item.field, item.value]))
    // 날짜 일부만 바꾸는 경우에도 기존 반대쪽 날짜와 함께 검증한다.
    if ('startDate' in updates || 'endDate' in updates) {
      const checked = activityPeriod.safeParse({ start: 'startDate' in updates ? updates.startDate : activity.start_date,
        end: 'endDate' in updates ? updates.endDate : activity.end_date })
      if (!checked.success) throw fail(400, '기간을 수정하지 못했어요. 유효한 날짜이며 시작일이 종료일보다 앞서는지 확인해 주세요.')
      const period = checked.data
      db.prepare('UPDATE activities SET start_date = ?, end_date = ?, period = ? WHERE id = ?')
        .run(period.start, period.end, period.start || period.end ? `${period.start ?? '미확인'} ~ ${period.end ?? ''}` : null, activity.id)
    }
    for (const field of ['role', 'status', 'summary']) {
      if (field in updates) db.prepare(`UPDATE activities SET ${field} = ? WHERE id = ?`).run(updates[field], activity.id)
    }
    // 직접 수정 시 이전 자동 분석은 중단한다. 다음 자료 저장의 자동 분석은 그대로 허용한다.
    // 실제 수정이 완료된 시각을 최근 활동 정렬에도 반영한다. 중복 요청은 위에서 반환해 시각을 다시 바꾸지 않는다.
    db.prepare("UPDATE activities SET metadata_status = 'idle', metadata_error = NULL, updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), activity.id)
    const labels = { role: '역할', status: '상태', summary: '전체 요약', startDate: '시작일', endDate: '종료일' }
    const completed = { id: reply.id, role: 'assistant', kind: 'general', analysis: null, updatedActivityId: activity.id,
      content: `${activity.name} 활동 정보를 수정했어요.\n${action.updates.map(item => `${labels[item.field]}: ${item.value ?? '미설정'}`).join('\n')}` }
    db.prepare('UPDATE analyses SET reply = ? WHERE id = ?').run(JSON.stringify(completed), analysisId)
    return { ...result, reply: completed, changed: true }
  })
}
