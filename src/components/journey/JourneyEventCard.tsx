import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type { JourneyEvent, JourneyOption } from '../../types/journey'

export default function JourneyEventCard({ event, typeOptions, axisOptions, expanded, onToggle }: {
    event: JourneyEvent; typeOptions: JourneyOption[]; axisOptions: JourneyOption[]
    expanded: boolean; onToggle: () => void
}) {
    const detailId = useId()
    const comparison = event.comparison
    const hasComparison = Boolean(comparison?.before.trim() && comparison.after.trim())

    // 상세가 있는 이벤트만 카드 전체를 버튼으로 제공한다. 내부에는 다른 조작을 중첩하지 않는다.
    const content = <>
        <span className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex flex-wrap items-center gap-2 min-w-0">
                <time dateTime={event.occurredAt} className="text-xs font-bold text-brand-primary">{event.occurredAt.replace('-', '.')}</time>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700">{typeOptions.find(option => option.value === event.type)?.label ?? event.type}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 wrap-anywhere">{event.activity.name}</span>
            </span>
            <span className="text-[11px] text-brand-muted">{axisOptions.find(option => option.value === event.axis)?.label ?? event.axis}</span>
        </span>
        <span className="flex items-start justify-between gap-3">
            <span className="font-bold text-base text-brand-text wrap-anywhere">{event.title}</span>
            {hasComparison && <ChevronDown aria-hidden="true" className={`w-4 h-4 mt-1 shrink-0 text-brand-muted ${expanded ? 'rotate-180' : ''}`} />}
        </span>
        <span className="block text-xs text-brand-muted leading-relaxed wrap-anywhere">{event.description}</span>
    </>

    // 원본처럼 모든 카드에 호버 효과를 적용하되 상세 조작은 비교 정보가 있을 때만 제공한다.
    return <article className="bg-white rounded-2xl border border-brand-border shadow-soft group-hover:border-brand-primary group-hover:shadow-cardHover focus-within:border-brand-primary transition cursor-pointer">
        {hasComparison ? (
            <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle} className="block w-full p-5 space-y-3 text-left rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2">
                {content}
            </button>
        ) : <div className="p-5 space-y-3">{content}</div>}

        {/* hidden을 사용해 닫힌 근거 영역은 키보드와 보조기술에도 노출하지 않는다. */}
        {hasComparison && comparison && <div id={detailId} hidden={!expanded} className="px-5 pb-5">
            <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-brand-border">
                    <div className="min-w-0">
                        <span className="text-[10px] font-bold text-brand-muted block">Before</span>
                        <p className="text-slate-700 font-medium wrap-anywhere">{comparison.before}</p>
                    </div>
                    <div className="min-w-0 border-l border-brand-border pl-2.5">
                        <span className="text-[10px] font-bold text-brand-primary block">After</span>
                        <p className="text-brand-primary font-bold wrap-anywhere">{comparison.after}</p>
                    </div>
                </div>
                {comparison.evidence.length > 0 && <p className="text-[11px] text-brand-muted wrap-anywhere"><strong>근거 자료:</strong> {comparison.evidence.join(', ')}</p>}
            </div>
        </div>}
    </article>
}
