export type RecordActions = {
    busy: boolean
    saved: boolean
    onSave: () => void
    onEdit: () => void
    blocked?: boolean
}

// 카드마다 원본 버튼 문구와 크기를 유지하고 저장 상태만 공통으로 표시한다.
export default function RecordButtons({ label, actions, otherActivity = false, wide = false }: { label: string; actions?: RecordActions; otherActivity?: boolean; wide?: boolean }) {
    return <>
        <button type="button" disabled={!actions || actions.busy || actions.saved || actions.blocked} onClick={actions?.onSave} className={`${wide ? 'px-3.5' : 'px-3'} py-1.5 bg-brand-primary text-white rounded-lg text-xs font-medium hover:bg-brand-primaryHover disabled:opacity-50 disabled:cursor-not-allowed`}>
            {actions?.busy ? '저장 중...' : actions?.saved ? '저장 완료' : actions?.blocked ? '중복 자료 확인 필요' : label}
        </button>
        <button type="button" disabled={!actions || actions.busy} onClick={actions?.onEdit} className={`${wide ? 'px-3.5' : 'px-3'} py-1.5 border border-brand-border rounded-lg text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50`}>수정</button>
        {otherActivity && <button type="button" disabled={!actions || actions.busy} onClick={actions?.onEdit} className="px-3 py-1.5 text-brand-muted text-xs hover:text-brand-text disabled:opacity-50">다른 활동 선택</button>}
    </>
}
