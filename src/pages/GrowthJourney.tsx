import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { getGrowthJourney } from '../services/journey'
import type { GrowthJourneyData } from '../types/journey'

function GrowthJourney() {
    const [journey, setJourney] = useState<GrowthJourneyData | null>(null)
    const [error, setError] = useState<string | null>(null)

    // 화면은 서비스 응답만 표시한다. 페이지 이탈 후의 응답 반영을 막는다.
    useEffect(() => {
        const controller = new AbortController()
        let active = true
        void getGrowthJourney(controller.signal).then(data => {
            if (active) setJourney(data)
        }).catch(error => {
            if (active && !controller.signal.aborted) setError(error instanceof Error ? error.message : '성장 기록을 불러오지 못했어요.')
        })
        return () => { active = false; controller.abort() }
    }, [])

    return (
        <section aria-labelledby="journey-title" className="space-y-6">
            <header>
                <h2 id="journey-title" className="text-xl sm:text-2xl font-bold tracking-tight text-brand-text">Growth Journey</h2>
                <p className="text-sm text-brand-muted mt-1">시간에 따라 내가 어떻게 달라졌는지 확인해보세요.</p>
            </header>

            {error ? <p role="alert" className="p-8 bg-white border border-brand-border rounded-2xl text-sm text-brand-muted">{error}</p> : !journey ? (
                <p role="status" className="p-8 text-center text-sm text-brand-muted">성장 기록을 불러오고 있어요.</p>
            ) : <>
                {/* 전체 성장 흐름과 첫 경험 배지는 응답으로 표시한다. */}
                <section aria-labelledby="journey-summary-title" className="bg-linear-to-r from-brand-primarySoft via-white to-brand-secondarySoft p-6 rounded-2xl border border-brand-border shadow-soft">
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold tracking-wider text-brand-primary uppercase flex items-center gap-1.5">
                                <Sparkles aria-hidden="true" className="w-4 h-4 shrink-0" /> 최근 성장 흐름 AI 분석
                            </span>
                            {journey.source === 'mock' && <span className="text-[10px] font-medium text-brand-muted bg-white border border-brand-border rounded-full px-2 py-0.5">예시 데이터</span>}
                        </div>
                        <h3 id="journey-summary-title" className="text-lg font-bold text-brand-text wrap-anywhere">{journey.summary.title}</h3>
                        <p className="text-xs text-brand-muted leading-relaxed wrap-anywhere">{journey.summary.description}</p>
                    </div>
                    {journey.badges.length > 0 && <div className="mt-4 pt-4 border-t border-brand-border/60 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-brand-muted mr-1">새롭게 쌓인 경험:</span>
                        {journey.badges.map(badge => <span key={badge.id} className="px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-brand-border text-brand-primary shadow-sm">{badge.label}</span>)}
                    </div>}
                </section>

                {/* 이번 단계는 외형만 구성한다. 필터 동작은 다음 단계에서 연결한다. */}
                <div aria-label="성장 필터" className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                    <div role="group" aria-label="성장 유형" className="flex flex-wrap gap-2">
                        {journey.typeOptions.map(option => <button key={option.value} type="button" disabled aria-pressed={option.value === 'all'} title="필터는 준비 중입니다." className={`px-3.5 py-1.5 rounded-full text-xs font-medium cursor-not-allowed ${option.value === 'all' ? 'bg-brand-primary text-white' : 'bg-white border border-brand-border text-slate-700'}`}>{option.label}</button>)}
                    </div>
                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-brand-border text-xs shrink-0">
                        <label htmlFor="journey-axis" className="text-brand-muted font-medium">성장 축:</label>
                        <select id="journey-axis" disabled defaultValue="all" title="필터는 준비 중입니다." className="bg-transparent font-semibold text-brand-text cursor-not-allowed">
                            {journey.axisOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* 오래된 순으로 표시하며, 카드 클릭·상세 펼침은 아직 제공하지 않는다. */}
                {journey.events.length === 0 ? <p className="p-8 text-center text-xs text-brand-muted bg-white border border-brand-border rounded-2xl">아직 성장 기록이 없어요.</p> : (
                    <ol aria-label="성장 이벤트" className="relative pl-6 space-y-8 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-border">
                        {journey.events.map(event => <li key={event.id} className="relative">
                            <span aria-hidden="true" className="absolute -left-[21px] top-1.5 w-4 h-4 rounded-full border-2 border-brand-primary bg-white" />
                            <article className="bg-white p-5 rounded-2xl border border-brand-border shadow-soft space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                                        <time dateTime={event.occurredAt} className="text-xs font-bold text-brand-primary">{event.occurredAt.replace('-', '.')}</time>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700">{journey.typeOptions.find(option => option.value === event.type)?.label ?? event.type}</span>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600 wrap-anywhere">{event.activity.name}</span>
                                    </div>
                                    <span className="text-[11px] text-brand-muted">{journey.axisOptions.find(option => option.value === event.axis)?.label ?? event.axis}</span>
                                </div>
                                <h3 className="font-bold text-base text-brand-text wrap-anywhere">{event.title}</h3>
                                <p className="text-xs text-brand-muted leading-relaxed wrap-anywhere">{event.description}</p>
                            </article>
                        </li>)}
                    </ol>
                )}
            </>}
        </section>
    )
}

export default GrowthJourney
