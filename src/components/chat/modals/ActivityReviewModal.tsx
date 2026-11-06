import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Edit3, X } from 'lucide-react'
import { isActivityProposal } from '../../../services/chat'
import type { ActivityOption } from '../../../services/records'
import type { ActivityMetadata, ActivityProposal, ActivitySelection } from '../../../types/chat'

const NEW_ACTIVITY = '__new_activity__'

// AI 후보는 저장할 사실이 아니라 확인할 제안이다. 미확인 값은 빈 입력으로 보인다.
export default function ActivityReviewModal({ activities, activityId, proposal, materialType, classificationOnly = false, saved, saving, busy, error, onClose, onSubmit }: {
    activities: ActivityOption[]; activityId: string; proposal: ActivityProposal; materialType: string
    saved: boolean; saving: boolean; busy: boolean; error: string
    classificationOnly?: boolean
    onClose: () => void; onSubmit: (selection: ActivitySelection, materialType: string) => void
}) {
    const initialTarget = activityId || (proposal.match === 'new' && !saved && !classificationOnly ? NEW_ACTIVITY
        : proposal.id && activities.some(item => item.id === proposal.id) ? proposal.id
        : !proposal.match ? activities.find(item => item.name === proposal.name)?.id ?? '' : '')
    const [selected, setSelected] = useState(initialTarget)
    const [type, setType] = useState(materialType)
    const [applyUpdates, setApplyUpdates] = useState(false)
    const [localError, setLocalError] = useState('')
    const selectedActivity = activities.find(item => item.id === selected)
    const initialActivity = activities.find(item => item.id === initialTarget)
    const initial = {
        name: proposal.match === 'unresolved' ? '' : proposal.name,
        category: proposal.category ?? initialActivity?.category ?? null,
        status: proposal.status ?? initialActivity?.status ?? null,
        role: proposal.role ?? initialActivity?.role ?? null,
        period: proposal.period ?? initialActivity?.period ?? null,
        summary: proposal.summary ?? initialActivity?.summary ?? null,
    }
    const [name, setName] = useState(initial.name ?? '')
    const [category, setCategory] = useState(initial.category ?? '')
    const [status, setStatus] = useState(initial.status ?? '')
    const [role, setRole] = useState(initial.role ?? '')
    const [start, setStart] = useState(initial.period?.start ?? '')
    const [end, setEnd] = useState(initial.period?.end ?? '')
    const [summary, setSummary] = useState(initial.summary ?? '')
    const dialogRef = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    const isNew = selected === NEW_ACTIVITY

    useEffect(() => {
        const dialog = dialogRef.current
        const previous = document.activeElement as HTMLElement | null
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        dialog?.showModal()
        return () => { dialog?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
    }, [])

    function selectTarget(value: string) {
        setSelected(value); setApplyUpdates(false); setLocalError('')
        const item = value === NEW_ACTIVITY ? initial : activities.find(activity => activity.id === value)
        // 다른 활동을 선택하면 이전 활동의 후보 정보를 옮기지 않는다.
        setName(item?.name ?? (proposal.match === 'new' ? proposal.name : ''))
        setCategory(item?.category ?? ''); setStatus(item?.status ?? ''); setRole(item?.role ?? '')
        setStart(item?.period?.start ?? ''); setEnd(item?.period?.end ?? ''); setSummary(item?.summary ?? '')
    }

    function submit() {
        setLocalError('')
        // 카드의 수정 동작에서는 연결 활동과 자료 유형만 보내고 활동 전체 정보는 변경하지 않는다.
        if (classificationOnly) {
            if (!selectedActivity || !type.trim()) { setLocalError('연결할 활동과 자료 유형을 확인해 주세요.'); return }
            onSubmit({ activityId: selectedActivity.id }, type.trim())
            return
        }
        const nullable = (value: string) => value.trim() || null
        const metadata: ActivityMetadata = {
            category: nullable(category), status: status === '진행 중' || status === '완료' ? status : null,
            role: nullable(role), period: start.trim() || end.trim() ? { start: nullable(start), end: nullable(end) } : null,
            summary: nullable(summary),
        }
        if (!selected || !type.trim() || isNew && !name.trim()) { setLocalError('연결할 활동과 자료 유형을 확인해 주세요.'); return }
        if ((isNew || applyUpdates) && !isActivityProposal({ ...metadata, name: isNew ? name.trim() : selectedActivity?.name, confidence: null })) {
            setLocalError('날짜는 YYYY-MM 또는 YYYY-MM-DD로 입력하고 종료일을 시작일 이후로 설정해 주세요.'); return
        }
        if (!isNew && !selectedActivity) { setLocalError('활동을 다시 선택해 주세요.'); return }
        onSubmit(isNew ? { newActivity: { name: name.trim(), ...metadata } } : { activityId: selected, ...(applyUpdates ? { activityUpdates: metadata } : {}) }, type.trim())
    }

    const inputClass = 'w-full border border-brand-border rounded-xl p-2.5 focus:outline-none focus:border-brand-primary disabled:bg-slate-50'
    return createPortal(
        <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} className="m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[calc(100dvh_-_2rem)] overflow-y-auto bg-brand-surface text-brand-text rounded-2xl border border-brand-border shadow-xl p-6 backdrop:bg-slate-900/40">
            <form onSubmit={event => { event.preventDefault(); if (!busy) submit() }} className="space-y-4">
                <div className="flex items-start justify-between gap-3 border-b border-brand-border pb-3">
                    <h3 id={titleId} className="font-bold text-base flex items-center gap-2"><Edit3 aria-hidden="true" className="w-4.5 h-4.5 text-brand-primary" />{classificationOnly ? '활동·자료 유형 수정' : '활동 정보 확인'}</h3>
                    <button type="button" disabled={busy} onClick={onClose} aria-label={classificationOnly ? '분류 수정 닫기' : '활동 확인 닫기'} className="text-brand-muted hover:text-brand-text disabled:opacity-50"><X aria-hidden="true" className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-brand-muted">{classificationOnly ? '자료를 연결할 활동과 자료 유형을 수정해 주세요.' : '분석된 활동 정보를 확인해 주세요. 알 수 없는 항목은 비워둘 수 있습니다.'}</p>
                <div className="space-y-3 text-xs">
                    <label className="block"><span className="block font-medium mb-1">연결할 활동</span>
                        <select autoFocus required value={selected} disabled={busy} onChange={event => selectTarget(event.target.value)} className={inputClass}>
                            <option value="" disabled>활동을 선택해 주세요</option>
                            {activities.map(activity => <option key={activity.id} value={activity.id}>{activity.name}</option>)}
                            {!saved && !classificationOnly && <option value={NEW_ACTIVITY}>새 활동으로 저장</option>}
                        </select>
                    </label>
                    {selected && !classificationOnly && <>
                        <label className="block"><span className="block font-medium mb-1">활동명</span><input required={isNew} maxLength={20000} value={isNew ? name : selectedActivity?.name ?? ''} disabled={busy || !isNew} onChange={event => setName(event.target.value)} className={inputClass} /></label>
                        {!isNew && <label className="flex items-start gap-2"><input type="checkbox" checked={applyUpdates} disabled={busy} onChange={event => setApplyUpdates(event.target.checked)} /><span>확인한 정보를 이 활동에 적용합니다. 기존 기록들도 이 활동 정보를 사용합니다. 빈 항목은 기존 값을 유지합니다.</span></label>}
                        <fieldset disabled={busy || !isNew && !applyUpdates} className="space-y-3">
                            <legend className="font-semibold mb-2">활동 정보</legend>
                            <label className="block"><span className="block mb-1">유형</span><input value={category} maxLength={200} onChange={event => setCategory(event.target.value)} className={inputClass} /></label>
                            <label className="block"><span className="block mb-1">상태</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)} className={inputClass}><option value="">미확인</option><option value="진행 중">진행 중</option><option value="완료">완료</option></select></label>
                            <label className="block"><span className="block mb-1">역할</span><input value={role} maxLength={20000} onChange={event => setRole(event.target.value)} className={inputClass} /></label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <label className="block"><span className="block mb-1">시작일</span><input value={start} placeholder="YYYY-MM 또는 YYYY-MM-DD" onChange={event => setStart(event.target.value)} className={inputClass} /></label>
                                <label className="block"><span className="block mb-1">종료일</span><input value={end} placeholder="YYYY-MM 또는 YYYY-MM-DD" onChange={event => setEnd(event.target.value)} className={inputClass} /></label>
                            </div>
                            <label className="block"><span className="block mb-1">활동 전체 요약</span><textarea value={summary} maxLength={20000} rows={3} onChange={event => setSummary(event.target.value)} className={inputClass} /></label>
                        </fieldset>
                    </>}
                    <label className="block"><span className="block font-medium mb-1">자료 유형</span><input required maxLength={20000} value={type} disabled={busy} onChange={event => setType(event.target.value)} className={inputClass} /></label>
                </div>
                {(localError || error) && <p role="alert" className="text-xs text-red-600">{localError || error}</p>}
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                    <button type="button" disabled={busy} onClick={onClose} className="px-4 py-2 rounded-xl border border-brand-border text-xs disabled:opacity-50">취소</button>
                    <button type="submit" disabled={busy || !selected || !type.trim()} className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-medium hover:bg-brand-primaryHover disabled:opacity-50">{busy ? '저장 중...' : saving ? '확인하고 기록 저장' : saved ? '수정 저장' : classificationOnly ? '수정 적용' : '확인 내용 적용'}</button>
                </div>
            </form>
        </dialog>, document.body,
    )
}
