import { useEffect, useId, useRef, useState } from 'react'
import type { ActivitySelection, ChatReply } from '../../types/chat'
import { getActivities, saveRecord, updateRecord } from '../../services/records'
import type { ActivityOption } from '../../services/records'
import ChatReplyCard from './ChatReplyCard'
import ActivityReviewModal from './modals/ActivityReviewModal'
import ActivityAnalysisStatus from '../ActivityAnalysisStatus'
import { isReply, request } from '../../services/chat'

// 홈의 카드별 수정본·저장 ID와 연결 활동을 관리한다.
export default function ConnectedChatReplyCard({ reply: initial, now, onChange }: {
    reply: ChatReply & { createdAt: number }; now: number; onChange?: (reply: ChatReply) => void
}) {
    const [reply, setReply] = useState(initial)
    const [recordId, setRecordId] = useState(initial.recordId)
    const [activities, setActivities] = useState<ActivityOption[]>([])
    const [activityId, setActivityId] = useState(initial.activityId ?? '')
    const [reviewMode, setReviewMode] = useState<'edit' | null>(null)
    const [isChoosingActivity, setIsChoosingActivity] = useState(false)
    const [selectedExistingId, setSelectedExistingId] = useState('')
    const activityPickerId = useId()
    const existingActivityButtonRef = useRef<HTMLButtonElement>(null)
    const showProposalActions = !recordId && (reply.analysis?.activity.match === 'new' || reply.analysis?.activity.match === 'unresolved')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    // 변화 없음 카드의 저장 안내 문구를 화면의 카드 구분과 맞춘다.
    const isNoChange = (reply.kind === 'file-analysis' || reply.kind === 'no-change')
        && reply.analysis?.files.length === 1 && reply.analysis.changes.length === 0
    const locked = useRef(false)
    const alive = useRef(true)
    useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
    // 브라우저에 남은 과거 카드도 DB 삭제/재분석 결과를 확인한 뒤 표시한다.
    useEffect(() => {
        if (!recordId) return
        const controller = new AbortController()
        async function refresh() {
            try {
                const value = await request(`/records/${encodeURIComponent(recordId!)}`, { signal: controller.signal })
                if (!controller.signal.aborted && value && typeof value === 'object' && 'reply' in value && isReply(value.reply) && 'activityId' in value && typeof value.activityId === 'string') {
                    const updated = value.reply
                    const target = value.activityId
                    setReply(current => ({ ...updated, createdAt: current.createdAt, recordId, activityId: target }))
                    setActivityId(target)
                }
            } catch (error) {
                if (!controller.signal.aborted && error && typeof error === 'object' && 'status' in error && error.status === 404) {
                    setReply(current => ({ id: current.id, role: 'assistant', kind: 'general', analysis: null,
                        content: `${current.content}\n\n이 기록은 삭제했어요.`, createdAt: current.createdAt }))
                    setRecordId(undefined); setActivityId(''); setReviewMode(null)
                }
            }
        }
        void refresh()
        window.addEventListener('1line:records-changed', refresh)
        return () => { controller.abort(); window.removeEventListener('1line:records-changed', refresh) }
    }, [recordId])

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

    async function saveTo(selection: ActivitySelection, materialType: string) {
        if (!reply.analysis) return
        const saved = await saveRecord({ ...reply, analysis: { ...reply.analysis, materialType } }, selection)
        if (!alive.current) return
        setRecordId(saved.id); setActivityId(saved.activityId)
        change({ ...saved.reply, recordId: saved.id, activityId: saved.activityId })
        setReviewMode(null)
        setIsChoosingActivity(false)
        setNotice('아카이브에 저장했어요.')
    }

    function save() {
        if (recordId) return
        void perform(async () => {
            if (!reply.analysis) throw new Error('저장할 분석 결과를 확인할 수 없어요.')
            const proposal = reply.analysis.activity
            // 새 활동 생성과 원본 자료 저장은 카드의 명시적인 클릭 한 번으로 확정한다.
            if (proposal.match === 'new') {
                await saveTo({ newActivity: { name: proposal.name, category: proposal.category ?? null,
                    status: null, role: null, period: null, summary: null } }, reply.analysis.materialType)
                return
            }
            const list = await loadActivities()
            if (!alive.current) return
            // 사용자가 선택한 ID 또는 분석의 기존 활동 ID만 사용하고 이름으로 ID를 추측하지 않는다.
            const targetId = activityId || (proposal.match === 'existing' || !proposal.match ? proposal.id : '')
            const target = list.find(item => item.id === targetId)
            if (!targetId || !target) {
                setIsChoosingActivity(true)
                return
            }
            // 원본 파일 연결과 분류는 기존 저장 서비스가 유지하며 새 기록만 추가한다.
            await saveTo({ activityId: targetId, ...(!target.category && proposal.category ? {
                activityUpdates: { category: proposal.category, status: null, role: null, period: null, summary: null },
            } : {}) }, reply.analysis.materialType)
        })
    }

    function edit() {
        void perform(async () => {
            await loadActivities()
            if (!alive.current) return
            setReviewMode('edit')
        })
    }

    function chooseExisting() {
        void perform(async () => {
            const list = await loadActivities()
            if (!alive.current) return
            setSelectedExistingId(current => list.some(item => item.id === current) ? current : '')
            setIsChoosingActivity(true)
        })
    }

    function saveExisting() {
        if (recordId) return
        void perform(async () => {
            if (!reply.analysis || !selectedExistingId) return
            // 선택 후 삭제된 활동을 저장 대상으로 사용하지 않도록 최신 목록을 확인한다.
            const list = await loadActivities()
            if (!alive.current) return
            if (!list.some(item => item.id === selectedExistingId)) throw new Error('선택한 활동을 찾을 수 없어요. 다른 활동을 선택해 주세요.')
            await saveTo({ activityId: selectedExistingId }, reply.analysis.materialType)
        })
    }

    function submit(selection: { activityId: string }, materialType: string) {
        void perform(async () => {
            if (!reply.analysis) return
            const analysis = structuredClone(reply.analysis)
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
            setNotice(recordId ? '저장된 기록을 수정했어요.' : isNoChange ? '활동과 자료 유형을 수정했어요. 아카이브 저장 버튼을 누르면 저장돼요.' : '활동과 자료 유형을 수정했어요. 기록 버튼을 누르면 저장돼요.')
        })
    }

    return <div className="space-y-2">
        <ChatReplyCard reply={reply} now={now} actions={{ busy, saved: Boolean(recordId), onSave: save, onEdit: edit }} activityActions={<>
            {showProposalActions && <div className="flex flex-wrap gap-2">
                {reply.analysis?.activity.match === 'new' && <button type="button" disabled={busy} onClick={save} className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-primaryHover disabled:opacity-50">{busy ? '처리 중…' : '새 활동으로 저장'}</button>}
                <button ref={existingActivityButtonRef} type="button" disabled={busy} aria-expanded={isChoosingActivity} aria-controls={activityPickerId} onClick={chooseExisting} className="rounded-lg border border-brand-border px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50">기존 활동에 연결</button>
            </div>}
            {isChoosingActivity && !recordId && <form id={activityPickerId} className="space-y-3 rounded-xl border border-brand-border bg-slate-50 p-3" onSubmit={event => { event.preventDefault(); saveExisting() }}>
                {activities.length ? <>
                    <label htmlFor={`${activityPickerId}-select`} className="block text-xs font-medium">자료를 저장할 기존 활동</label>
                    <select id={`${activityPickerId}-select`} value={selectedExistingId} disabled={busy} onChange={event => { setSelectedExistingId(event.target.value); setError('') }} className="w-full min-w-0 rounded-lg border border-brand-border bg-white p-2 text-xs focus:outline-none focus:border-brand-primary">
                        <option value="">활동을 선택해 주세요</option>
                        {activities.map(activity => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                    </select>
                    <p className="text-xs text-brand-muted">선택한 활동에 이번 자료를 함께 저장해요.</p>
                </> : <p role="status" className="text-xs text-brand-muted">연결할 기존 활동이 없어요.{reply.analysis?.activity.match === 'new' ? ' 새 활동으로 저장할 수 있어요.' : ' 먼저 홈에서 활동을 기록해 주세요.'}</p>}
                <div className="flex flex-wrap gap-2">
                    {activities.length > 0 && <button type="submit" disabled={busy || !selectedExistingId} className="rounded-lg bg-brand-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">{busy ? '저장 중…' : '선택한 활동에 저장'}</button>}
                    <button type="button" disabled={busy} onClick={() => { setIsChoosingActivity(false); setError(''); existingActivityButtonRef.current?.focus() }} className="rounded-lg border border-brand-border px-3 py-1.5 text-xs text-slate-700 disabled:opacity-50">취소</button>
                </div>
            </form>}
        </>} />
        {notice && <p role="status" className="text-xs text-brand-primary">{notice}</p>}
        {recordId && activityId && <ActivityAnalysisStatus key={activityId} activityId={activityId} />}
        {error && !reviewMode && <p role="alert" className="text-xs text-red-600">{error}</p>}
        {/* 모달은 기존 활동·자료 유형 수정에만 사용한다. 신규 추가는 카드에서 판단한다. */}
        {reviewMode && reply.analysis && <ActivityReviewModal activities={activities} activityId={activityId} proposal={reply.analysis.activity} materialType={reply.analysis.materialType} saved={Boolean(recordId)} busy={busy} error={error} onClose={() => { setReviewMode(null); setError('') }} onSubmit={submit} />}
    </div>
}
