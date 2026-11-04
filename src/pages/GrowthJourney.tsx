import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { getGrowthJourney } from '../services/journey'
import type { GrowthJourneyData } from '../types/journey'
import JourneyEventCard from '../components/journey/JourneyEventCard'
import { filterJourneyEvents } from '../utils/journey'

function GrowthJourney() {
    const [journey, setJourney] = useState<GrowthJourneyData | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [typeFilter, setTypeFilter] = useState('all')
    const [axisFilter, setAxisFilter] = useState('all')
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())

    // 필터는 목록에만 AND로 적용한다. 전체 성장 요약·배지는 유지한다.
    const events = journey ? filterJourneyEvents(journey.events, typeFilter, axisFilter) : []

    function toggleEvent(id: string) {
        // 필터로 카드가 숨겨져도 같은 이벤트 ID의 펼침 상태는 보존한다.
        setExpandedIds(current => {
            const next = new Set(current)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })
    }

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

                {/* 유형과 성장 축은 각각의 선택을 유지하며 함께 적용한다. */}
                <div aria-label="성장 필터" className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                    <div role="group" aria-label="성장 유형" className="flex flex-wrap gap-2">
                        {journey.typeOptions.map(option => <button key={option.value} type="button" aria-pressed={option.value === typeFilter} onClick={() => setTypeFilter(option.value)} className={`px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2 ${option.value === typeFilter ? 'bg-brand-primary text-white' : 'bg-white border border-brand-border text-slate-700 hover:bg-slate-50'}`}>{option.label}</button>)}
                    </div>
                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-brand-border text-xs shrink-0">
                        <label htmlFor="journey-axis" className="text-brand-muted font-medium">성장 축:</label>
                        <select id="journey-axis" value={axisFilter} onChange={event => setAxisFilter(event.target.value)} className="bg-transparent font-semibold text-brand-text focus-visible:outline-2 focus-visible:outline-brand-primary">
                            {journey.axisOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* 서비스의 시간순을 유지하고 전체 기록 없음과 필터 결과 없음을 구분한다. */}
                {journey.events.length === 0 ? <p role="status" className="p-8 text-center text-xs text-brand-muted bg-white border border-brand-border rounded-2xl">아직 성장 기록이 없어요.</p> : events.length === 0 ? (
                    <p role="status" className="p-8 text-center text-xs text-brand-muted bg-white border border-brand-border rounded-2xl">선택한 조건에 맞는 성장 이벤트가 없어요.</p>
                ) : (
                    <ol aria-label="성장 이벤트" className="relative pl-6 space-y-8 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-border">
                        {events.map(event => <li key={event.id} className="relative">
                            <span aria-hidden="true" className="absolute -left-[21px] top-1.5 w-4 h-4 rounded-full border-2 border-brand-primary bg-white" />
                            <JourneyEventCard event={event} typeOptions={journey.typeOptions} axisOptions={journey.axisOptions} expanded={expandedIds.has(event.id)} onToggle={() => toggleEvent(event.id)} />
                        </li>)}
                    </ol>
                )}
            </>}
        </section>
    )
}

export default GrowthJourney
