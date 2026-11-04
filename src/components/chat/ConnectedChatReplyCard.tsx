import { useEffect, useRef, useState } from 'react'
import type { ChatReply } from '../../types/chat'
import { getActivities, saveRecord, updateRecord } from '../../services/records'
import type { ActivityOption } from '../../services/records'
import ChatReplyCard from './ChatReplyCard'
import EditCategoryModal from './modals/EditCategoryModal'

// 카드별 수정본·저장 ID를 관리한다. 홈과 독립 미리보기는 같은 저장 흐름을 사용한다.
export default function ConnectedChatReplyCard({ reply: initial, now, onChange }: {
    reply: ChatReply & { createdAt: number }; now: number; onChange?: (reply: ChatReply) => void
}) {
    const [reply, setReply] = useState(initial)
    const [recordId, setRecordId] = useState(initial.recordId)
    const [activities, setActivities] = useState<ActivityOption[]>([])
    const [activityId, setActivityId] = useState(initial.activityId ?? '')
    const [editing, setEditing] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
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
        const list = activities.length ? activities : await getActivities()
        if (alive.current) setActivities(list)
        return list
    }

    function save() {
        if (recordId) return
        void perform(async () => {
            const list = await loadActivities()
            if (!alive.current) return
            const target = activityId || list.find(item => item.name === reply.analysis?.activity.name)?.id
            if (!target) throw new Error('수정에서 연결할 활동을 먼저 선택해 주세요.')
            const saved = await saveRecord(reply, target)
            if (!alive.current) return
            setRecordId(saved.id); setActivityId(saved.activityId)
            change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
            setNotice('아카이브에 저장했어요.')
        })
    }

    function edit() {
        void perform(async () => {
            const list = await loadActivities()
            if (!alive.current) return
            setActivityId(activityId || list.find(item => item.name === reply.analysis?.activity.name)?.id || '')
            setEditing(true)
        })
    }

    function submit(target: string, materialType: string) {
        void perform(async () => {
            if (recordId) {
                const saved = await updateRecord(recordId, target, materialType)
                if (!alive.current) return
                change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
            } else if (reply.analysis) {
                const analysis = structuredClone(reply.analysis)
                analysis.activity.name = activities.find(item => item.id === target)!.name
                if (analysis.materialType !== materialType) {
                    analysis.materialType = materialType
                    analysis.files.forEach(file => { file.materialType = materialType })
                    if (analysis.groups.length) analysis.groups = [{ materialType, count: analysis.files.length }]
                }
                change({ ...reply, activityId: target, content: reply.content.replaceAll(reply.analysis.activity.name, analysis.activity.name), analysis })
            }
            setActivityId(target); setEditing(false)
            setNotice(recordId ? '저장된 기록을 수정했어요.' : '분류를 수정했어요. 기록 버튼을 누르면 저장됩니다.')
        })
    }

    return <div className="space-y-2">
        <ChatReplyCard reply={reply} now={now} actions={{ busy, saved: Boolean(recordId), onSave: save, onEdit: edit }} />
        {notice && <p role="status" className="text-xs text-brand-primary">{notice}</p>}
        {error && !editing && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {editing && <EditCategoryModal activities={activities} activityId={activityId} materialType={reply.analysis?.materialType ?? ''} busy={busy} error={error} onClose={() => { setEditing(false); setError('') }} onSubmit={submit} />}
    </div>
}
