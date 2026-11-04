import { Edit3, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ActivityOption } from '../../../services/records'

export default function EditCategoryModal({ activities, activityId, materialType, busy, error, onClose, onSubmit }: {
    activities: ActivityOption[]; activityId: string; materialType: string; busy: boolean; error: string
    onClose: () => void; onSubmit: (activityId: string, materialType: string) => void
}) {
    const [selected, setSelected] = useState(activityId)
    const [type, setType] = useState(materialType)
    const titleId = useId()
    const dialogRef = useRef<HTMLDialogElement>(null)

    // 네이티브 모달로 초점 제한·Escape·배경 접근 차단을 제공하고 닫힐 때 초점을 돌려준다.
    useEffect(() => {
        const dialog = dialogRef.current
        const previous = document.activeElement as HTMLElement | null
        dialog?.showModal()
        return () => { dialog?.close(); previous?.focus() }
    }, [])

    return createPortal(
        <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto bg-brand-surface text-brand-text rounded-2xl border border-brand-border shadow-xl p-6 backdrop:bg-slate-900/40">
            <form onSubmit={event => { event.preventDefault(); if (!busy && selected && type.trim()) onSubmit(selected, type.trim()) }} className="space-y-4">
                <div className="flex items-center justify-between border-b border-brand-border pb-3">
                    <h3 id={titleId} className="font-bold text-base flex items-center gap-2"><Edit3 className="w-4.5 h-4.5 text-brand-primary" />기록 분류 수정</h3>
                    <button type="button" disabled={busy} onClick={onClose} aria-label="수정 모달 닫기" className="text-brand-muted hover:text-brand-text disabled:opacity-50"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3 text-xs">
                    <label className="block"><span className="block font-medium mb-1">연결할 활동 선택</span>
                        <select autoFocus required value={selected} disabled={busy} onChange={event => setSelected(event.target.value)} className="w-full border border-brand-border rounded-xl p-2.5 focus:outline-none focus:border-brand-primary">
                            <option value="" disabled>활동을 선택해 주세요</option>
                            {activities.map(activity => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                        </select>
                    </label>
                    <label className="block"><span className="block font-medium mb-1">자료 유형</span>
                        <input required maxLength={20000} value={type} disabled={busy} onChange={event => setType(event.target.value)} className="w-full border border-brand-border rounded-xl p-2.5 focus:outline-none focus:border-brand-primary" />
                    </label>
                </div>
                {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
                <div className="flex justify-end space-x-2 pt-2">
                    <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2 rounded-xl border border-brand-border text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">취소</button>
                    <button type="submit" disabled={busy || !selected || !type.trim()} className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-medium hover:bg-brand-primaryHover disabled:opacity-50">{busy ? '저장 중...' : '수정 저장'}</button>
                </div>
            </form>
        </dialog>, document.body,
    )
}
