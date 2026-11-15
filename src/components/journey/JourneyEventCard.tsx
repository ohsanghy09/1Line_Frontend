import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import type { JourneyEvent, JourneyEvidenceSource, JourneyOption } from '../../types/journey'
import { groupJourneyEvidence, journeyTypeIcon, journeyTypeLabel } from '../../utils/journey'

export default function JourneyEventCard({ event, axisOptions, evidenceSources, expanded, onToggle }: {
    event: JourneyEvent; axisOptions: JourneyOption[]; evidenceSources: JourneyEvidenceSource[]
    expanded: boolean; onToggle: () => void
}) {
    const detailId = useId()
    const evidence = groupJourneyEvidence(event)
    const sources = new Map(evidenceSources.map(source => [source.recordId, source]))

    return <article className="bg-white rounded-2xl border border-brand-border shadow-soft group-hover:border-brand-primary group-hover:shadow-cardHover focus-within:border-brand-primary transition">
        <button type="button" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle} className="block w-full p-5 space-y-3 text-left rounded-2xl cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2">
            <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2 min-w-0">
                    <time dateTime={event.occurredAt} className="text-xs font-bold text-brand-primary">{event.occurredAt.replace('-', '.')}</time>
                    {event.growthAssessments.map(item => <span key={item.type} className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700"><span aria-hidden="true" className="mr-1">{journeyTypeIcon(item.type)}</span>{journeyTypeLabel(item.type)}</span>)}
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 wrap-anywhere">{event.activity.name}</span>
                </span>
                <span className="text-[11px] text-brand-muted">{axisOptions.find(option => option.value === event.axis)?.label ?? event.axis}</span>
            </span>
            <span className="flex items-start justify-between gap-3">
                <span className="font-bold text-base text-brand-text wrap-anywhere">{event.title}</span>
                <ChevronDown aria-hidden="true" className={`w-4 h-4 mt-1 shrink-0 text-brand-muted ${expanded ? 'rotate-180' : ''}`} />
            </span>
            <span className="block text-xs text-brand-muted leading-relaxed wrap-anywhere">{event.description}</span>
        </button>

        {/* 상세 조작은 주 버튼 바깥에 둬 버튼 중첩을 방지한다. 닫힌 내용은 초점에서도 제외한다. */}
        <div id={detailId} hidden={!expanded} className="px-5 pb-5">
            <div className="pt-4 border-t border-slate-100 space-y-4">
                {event.growthAssessments.map(item => <section key={item.type} aria-label={journeyTypeLabel(item.type) + ' 판단'} className="space-y-2 text-xs">
                    <h4 className="font-semibold text-brand-primary">{journeyTypeLabel(item.type)}</h4>
                    <p className="text-brand-text leading-relaxed wrap-anywhere">{item.reason}</p>
                    {item.comparison && <div className="rounded-xl bg-slate-50 border border-brand-border p-3 space-y-2">
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="min-w-0">
                                <dt className="text-[10px] font-bold text-brand-muted">Before · 이전</dt>
                                <dd className="text-slate-700 mt-1 wrap-anywhere">{item.comparison.before}</dd>
                            </div>
                            <div className="min-w-0">
                                <dt className="text-[10px] font-bold text-brand-primary">After · 이후</dt>
                                <dd className="text-brand-primary font-medium mt-1 wrap-anywhere">{item.comparison.after}</dd>
                            </div>
                        </dl>
                        <p className="text-[11px] text-brand-muted leading-relaxed wrap-anywhere">비교 조건: {item.comparison.condition}</p>
                    </div>}
                    {item.transfer && <div className="rounded-xl bg-slate-50 border border-brand-border p-3 space-y-1">
                        <p className="font-medium text-slate-700 wrap-anywhere">
                            {item.transfer.sourceActivity.name}의 {item.transfer.experience}
                            <span aria-hidden="true"> → </span><span className="sr-only">을 적용한 활동: </span>{event.activity.name}
                        </p>
                        <p className="text-[11px] text-brand-muted leading-relaxed wrap-anywhere">{item.transfer.application}</p>
                    </div>}
                </section>)}

                <details className="border-t border-slate-100 pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-brand-muted rounded focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2">
                        근거 기록 보기 ({evidence.length})
                    </summary>
                    <ol aria-label="판단 근거 원문" className="mt-3 space-y-4">
                        {evidence.map(item => <li key={item.key} className="space-y-2">
                            <div className="flex flex-wrap gap-1">
                                {item.roles.map(role => <span key={role} className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 text-[10px]">{role}</span>)}
                            </div>
                            <blockquote className="border-l-2 border-brand-border pl-3 text-xs text-brand-text leading-relaxed whitespace-pre-wrap wrap-anywhere">{item.quote}</blockquote>
                            <p className="text-[11px] text-brand-muted wrap-anywhere">
                                출처: {sources.get(item.recordId)?.activityName} · 기록 ID: {item.recordId}
                            </p>
                        </li>)}
                    </ol>
                </details>
            </div>
        </div>
    </article>
}
