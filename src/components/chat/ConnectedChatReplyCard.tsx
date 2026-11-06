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
    const [reviewMode, setReviewMode] = useState<'edit' | null>(null)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    // 변화 없음 카드의 저장 안내 문구를 화면의 카드 구분과 맞춘다.
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
        // 수정 모달과 저장 요청 전에 최신 활동 목록을 확인한다.
        const list = await getActivities()
        if (alive.current) setActivities(list)
        return list
    }

    function save() {
        if (recordId) return
        void perform(async () => {
            if (!reply.analysis) throw new Error('저장할 분석 결과를 확인할 수 없어요.')
            const list = await loadActivities()
            if (!alive.current) return
            // 사용자가 선택한 ID 또는 분석의 기존 활동 ID만 사용하고 이름으로 ID를 추측하지 않는다.
            const proposal = reply.analysis.activity
            const targetId = activityId || (proposal.match === 'existing' || !proposal.match ? proposal.id : '')
            if (!targetId || !list.some(item => item.id === targetId)) {
                throw new Error(!list.length ? '연결할 기존 활동이 없어요. 활동이 준비된 뒤 다시 시도해 주세요.'
                    : reply.kind === 'batch-analysis' ? '자료를 연결할 기존 활동을 확인할 수 없어요. 활동 연결을 확인한 뒤 다시 시도해 주세요.'
                    : '수정 버튼에서 연결할 활동을 선택한 뒤 저장해 주세요.')
            }
            // 원본 파일 연결과 분류는 기존 저장 서비스가 유지하며 새 기록만 추가한다.
            const saved = await saveRecord(reply, { activityId: targetId })
            if (!alive.current) return
            setRecordId(saved.id); setActivityId(saved.activityId)
            change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
            setNotice('아카이브에 저장했어요.')
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
            if (!('activityId' in selection)) throw new Error('연결할 기존 활동을 선택해 주세요.')
            const existing = activities.find(item => item.id === selection.activityId)
            if (!existing) throw new Error('연결할 활동을 다시 선택해 주세요.')
            analysis.activity = { ...existing, match: 'existing', confidence: analysis.activity.confidence }
            if (analysis.materialType !== materialType) {
                analysis.materialType = materialType
                analysis.files.forEach(file => { file.materialType = materialType })
                if (analysis.groups.length) analysis.groups = [{ materialType, count: analysis.files.length }]
            }
            const next = { ...reply, analysis, content: reply.content.replaceAll(reply.analysis.activity.name, analysis.activity.name) }
            if (recordId) {
                const saved = await updateRecord(recordId, selection.activityId, materialType)
                if (!alive.current) return
                setActivityId(saved.activityId)
                change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
            } else {
                setActivityId(selection.activityId)
                change({ ...next, activityId: selection.activityId })
            }
            setReviewMode(null)
            setNotice(recordId ? '저장된 기록을 수정했어요.' : isNoChange ? '활동과 자료 유형을 수정했어요. 아카이브 저장 버튼을 누르면 저장됩니다.' : '활동과 자료 유형을 수정했어요. 기록 버튼을 누르면 저장됩니다.')
        })
    }

    return <div className="space-y-2">
        <ChatReplyCard reply={reply} now={now} actions={{ busy, saved: Boolean(recordId), onSave: save, onEdit: edit }} />
        {notice && <p role="status" className="text-xs text-brand-primary">{notice}</p>}
        {error && !reviewMode && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {/* 모달은 분류 수정에만 사용하고 기록·저장은 카드에서 바로 요청한다. */}
        {reviewMode && reply.analysis && <ActivityReviewModal activities={activities} activityId={activityId} proposal={reply.analysis.activity} materialType={reply.analysis.materialType} classificationOnly saved={Boolean(recordId)} saving={false} busy={busy} error={error} onClose={() => { setReviewMode(null); setError('') }} onSubmit={submit} />}
    </div>
}
