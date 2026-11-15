import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Edit3, X } from 'lucide-react'
import type { ActivityOption } from '../../../services/records'
import type { ActivityProposal } from '../../../types/chat'

// 기존 활동 연결과 자료 유형만 수정한다. 신규 활동 저장은 카드에서 처리한다.
export default function ActivityReviewModal({ activities, activityId, proposal, materialType, saved, busy, error, onClose, onSubmit }: {
    activities: ActivityOption[]; activityId: string; proposal: ActivityProposal; materialType: string
    saved: boolean; busy: boolean; error: string
    onClose: () => void; onSubmit: (selection: { activityId: string }, materialType: string) => void
}) {
    const initialTarget = activityId || (proposal.id && activities.some(item => item.id === proposal.id) ? proposal.id
        : !proposal.match ? activities.find(item => item.name === proposal.name)?.id ?? '' : '')
    const [selected, setSelected] = useState(initialTarget)
    const [type, setType] = useState(materialType)
    const [localError, setLocalError] = useState('')
    const dialogRef = useRef<HTMLDialogElement>(null)
    const titleId = useId()

    useEffect(() => {
        const dialog = dialogRef.current
        const previous = document.activeElement as HTMLElement | null
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        dialog?.showModal()
        return () => { dialog?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
    }, [])

    function submit() {
        setLocalError('')
        if (!activities.some(item => item.id === selected) || !type.trim()) {
            setLocalError('연결할 활동과 자료 유형을 확인해 주세요.'); return
        }
        onSubmit({ activityId: selected }, type.trim())
    }

    const inputClass = 'w-full border border-brand-border rounded-xl p-2.5 focus:outline-none focus:border-brand-primary disabled:bg-slate-50'
    return createPortal(
        <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[calc(100dvh_-_2rem)] overflow-y-auto bg-brand-surface text-brand-text rounded-2xl border border-brand-border shadow-xl p-6 backdrop:bg-slate-900/40">
            <form onSubmit={event => { event.preventDefault(); if (!busy) submit() }} className="space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-brand-border pb-3">
                    <h3 id={titleId} className="font-bold text-base flex items-center gap-2"><Edit3 aria-hidden="true" className="w-4.5 h-4.5 text-brand-primary" />활동·자료 유형 수정</h3>
                    <button type="button" disabled={busy} onClick={onClose} aria-label="분류 수정 닫기" className="text-brand-muted hover:text-brand-text disabled:opacity-50"><X aria-hidden="true" className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-brand-muted">자료를 연결할 활동과 자료 유형을 수정해 주세요.</p>
                <div className="space-y-3 text-xs">
                    <label className="block"><span className="block font-medium mb-1">연결할 활동</span>
                        <select autoFocus required value={selected} disabled={busy} onChange={event => { setSelected(event.target.value); setLocalError('') }} className={inputClass}>
                            <option value="" disabled>활동을 선택해 주세요</option>
                            {activities.map(activity => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                        </select>
                    </label>
                    <label className="block"><span className="block font-medium mb-1">자료 유형</span><input required maxLength={20000} value={type} disabled={busy} onChange={event => setType(event.target.value)} className={inputClass} /></label>
                </div>
                {(localError || error) && <p role="alert" className="text-xs text-red-600">{localError || error}</p>}
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2 rounded-xl border border-brand-border text-xs disabled:opacity-50">취소</button>
                    <button type="submit" disabled={busy || !selected || !type.trim()} className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-medium hover:bg-brand-primaryHover disabled:opacity-50">{busy ? '저장 중...' : saved ? '수정 저장' : '수정 적용'}</button>
                </div>
            </form>
        </dialog>, document.body,
    )
}
