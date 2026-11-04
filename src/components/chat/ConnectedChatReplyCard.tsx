import { useEffect, useRef, useState } from 'react'
import type { ActivitySelection, ChatReply } from '../../types/chat'
import { getActivities, saveRecord, updateRecord } from '../../services/records'
import type { ActivityOption } from '../../services/records'
import ChatReplyCard from './ChatReplyCard'
import ActivityReviewModal from './modals/ActivityReviewModal'

// 카드별 수정본·저장 ID를 관리한다. 홈과 독립 미리보기는 같은 저장 흐름을 사용한다.
export default function ConnectedChatReplyCard({ reply: initial, now, onChange }: {
    reply: ChatReply & { createdAt: number }; now: number; onChange?: (reply: ChatReply) => void
}) {
    const [reply, setReply] = useState(initial)
    const [recordId, setRecordId] = useState(initial.recordId)
    const [activities, setActivities] = useState<ActivityOption[]>([])
    const [activityId, setActivityId] = useState(initial.activityId ?? '')
    const [reviewMode, setReviewMode] = useState<'save' | 'edit' | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    // 화면의 변화 없음 카드 선택 조건과 동일하게 저장·수정 범위를 제한한다.
    const isNoChange = (reply.kind === 'file-analysis' || reply.kind === 'no-change')
        && reply.analysis?.files.length === 1 && reply.analysis.changes.length === 0
    const locked = useRef(false)
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

    function change(next: ChatReply) {
        const updated = { ...reply, ...next }
        setReply(updated)
        onChange?.(updated)
    }

    async function perform(work: () => Promise<void>) {
        if (locked.current) return
        locked.current = true
        setBusy(true); setError(''); setNotice('')
        try { await work() } catch (error) {
            if (alive.current) setError(error instanceof Error ? error.message : '요청을 처리하지 못했어요.')
        } finally {
            locked.current = false
            if (alive.current) setBusy(false)
        }
    }

    async function loadActivities() {
        // 다른 카드에서 만든 활동도 확인 창을 열 때 다시 조회한다.
        const list = await getActivities()
        if (alive.current) setActivities(list)
        return list
    }

    function save() {
        if (recordId) return
        void perform(async () => {
            const list = await loadActivities()
            if (!alive.current) return
            if (isNoChange && reply.analysis) {
                // 카드에서 확정한 연결 활동과 자료 유형으로 바로 저장하며 활동 메타정보는 변경하지 않는다.
                const proposal = reply.analysis.activity
                const targetId = activityId || (proposal.match === 'existing' ? proposal.id
                    : !proposal.match ? list.find(item => item.name === proposal.name)?.id : '')
                if (!targetId || !list.some(item => item.id === targetId)) {
                    throw new Error('수정 버튼에서 연결할 활동을 선택한 뒤 저장해 주세요.')
                }
                const saved = await saveRecord(reply, { activityId: targetId })
                if (!alive.current) return
                setRecordId(saved.id); setActivityId(saved.activityId)
                change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
                setNotice('아카이브에 저장했어요.')
                return
            }
            setReviewMode('save')
        })
    }

    function edit() {
        void perform(async () => {
            await loadActivities()
            if (!alive.current) return
            setReviewMode('edit')
        })
    }

    function submit(selection: ActivitySelection, materialType: string) {
        void perform(async () => {
            if (!reply.analysis) return
            const analysis = structuredClone(reply.analysis)
            const existing = 'activityId' in selection ? activities.find(item => item.id === selection.activityId) : null
            if ('activityId' in selection && !existing) throw new Error('연결할 활동을 다시 선택해 주세요.')
            analysis.activity = 'newActivity' in selection
                ? { ...selection.newActivity, id: null, match: 'new', confidence: null }
                : { ...existing!, ...selection.activityUpdates, match: 'existing', confidence: analysis.activity.confidence }
            if (analysis.materialType !== materialType) {
                analysis.materialType = materialType
                analysis.files.forEach(file => { file.materialType = materialType })
                if (analysis.groups.length) analysis.groups = [{ materialType, count: analysis.files.length }]
            }
            const next = { ...reply, analysis, content: reply.content.replaceAll(reply.analysis.activity.name, analysis.activity.name) }
            if (recordId) {
                if (!('activityId' in selection)) throw new Error('저장된 기록은 기존 활동을 선택해 주세요.')
                const saved = await updateRecord(recordId, selection.activityId, materialType, selection.activityUpdates)
                if (!alive.current) return
                setActivityId(saved.activityId)
                change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
            } else if (reviewMode === 'save') {
                const saved = await saveRecord(next, selection)
                if (!alive.current) return
                setRecordId(saved.id); setActivityId(saved.activityId)
                change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
            } else {
                const targetId = 'activityId' in selection ? selection.activityId : ''
                setActivityId(targetId)
                change({ ...next, activityId: targetId || undefined })
            }
            setReviewMode(null)
            setNotice(recordId ? '저장된 기록을 수정했어요.' : reviewMode === 'save' ? '아카이브에 저장했어요.' : isNoChange ? '활동과 자료 유형을 수정했어요. 아카이브 저장 버튼을 누르면 저장됩니다.' : '확인 내용을 적용했어요. 기록 버튼을 누르면 저장됩니다.')
        })
    }

    return <div className="space-y-2">
        <ChatReplyCard reply={reply} now={now} actions={{ busy, saved: Boolean(recordId), onSave: save, onEdit: edit }} />
        {notice && <p role="status" className="text-xs text-brand-primary">{notice}</p>}
        {error && !reviewMode && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {reviewMode && reply.analysis && <ActivityReviewModal activities={activities} activityId={activityId} proposal={reply.analysis.activity} materialType={reply.analysis.materialType} classificationOnly={isNoChange} saved={Boolean(recordId)} saving={reviewMode === 'save'} busy={busy} error={error} onClose={() => { setReviewMode(null); setError('') }} onSubmit={submit} />}
    </div>
}
