import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { generateGrowthJourney, getGrowthJourney } from '../services/journey'
import { JOURNEY_TYPE_OPTIONS } from '../types/journey'
import type { GrowthJourneyData, JourneyTypeFilter } from '../types/journey'
import JourneyEventCard from '../components/journey/JourneyEventCard'
import { filterJourneyEvents, journeyTypeIcon } from '../utils/journey'

function GrowthJourney() {
    const [journey, setJourney] = useState<GrowthJourneyData | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [retryKey, setRetryKey] = useState(0)
    const [typeFilter, setTypeFilter] = useState<JourneyTypeFilter>('all')
    const [axisFilter, setAxisFilter] = useState('all')
    const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
    const [generating, setGenerating] = useState(false)
    const [generationError, setGenerationError] = useState<string | null>(null)
    const generationController = useRef<AbortController | null>(null)

    // 이탈 시 화면 갱신만 취소한다. 이미 접수된 서버 분석은 완료·저장될 수 있다.
    useEffect(() => () => generationController.current?.abort(), [])

    async function generate() {
        if (generationController.current) return
        const controller = new AbortController()
        generationController.current = controller
        setGenerating(true)
        setGenerationError(null)
        try {
            const result = await generateGrowthJourney(controller.signal)
            if (!controller.signal.aborted) {
                setJourney(result)
                setExpandedIds(new Set())
                setTypeFilter('all')
                setAxisFilter('all')
            }
        } catch (error) {
            if (!controller.signal.aborted) {
                setGenerationError(error instanceof Error ? error.message : '성장 분석에 실패했어요.')
                // 통신이 끊겨도 서버에 저장됐을 수 있으므로 모델 재호출 없이 재조회한다.
                try {
                    const recovered = await getGrowthJourney(controller.signal)
                    if (!controller.signal.aborted) {
                        setJourney(recovered)
                        // 저장된 결과 또는 삭제 상태로 바뀌었을 수 있어 사라진 분야 선택을 남기지 않는다.
                        setExpandedIds(new Set())
                        setTypeFilter('all')
                        setAxisFilter('all')
                    }
                } catch { /* 조회도 실패하면 마지막 표시 결과와 실패 안내를 유지한다. */ }
            }
        } finally {
            if (generationController.current === controller) generationController.current = null
            if (!controller.signal.aborted) setGenerating(false)
        }
    }

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
    }, [retryKey])

    return (
        <section aria-labelledby="journey-title" className="space-y-6">
            <header>
                <h2 id="journey-title" className="text-xl sm:text-2xl font-bold tracking-tight text-brand-text">Growth Journey</h2>
                <p className="text-sm text-brand-muted mt-1">시간에 따라 내가 어떻게 달라졌는지 확인해보세요.</p>
            </header>

            {error ? <div role="alert" className="p-8 bg-white border border-brand-border rounded-2xl text-sm text-brand-muted space-y-3">
                <p>{error}</p>
                <button type="button" onClick={() => { setError(null); setJourney(null); setRetryKey(current => current + 1) }} className="px-4 py-2 bg-brand-primary text-white rounded-xl font-medium hover:bg-brand-primaryHover focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2">다시 불러오기</button>
            </div> : !journey ? (
                <p role="status" className="p-8 text-center text-sm text-brand-muted">성장 기록을 불러오고 있어요.</p>
            ) : <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-brand-muted space-y-1" aria-live="polite">
                        <p>{journey.analysis?.id ? `${journey.analysis.stale ? '이전 분석' : '현재 분석'} 기준: 확정 기록 ${journey.analysis.recordCount}개` : '저장된 기록을 모아 성장 흐름을 분석해 보세요.'}</p>
                        {journey.analysis?.generatedAt && <p>마지막 분석: {new Date(journey.analysis.generatedAt).toLocaleString('ko-KR')}</p>}
                        {journey.analysis?.stale && <p>분석 이후 기록이 변경됐어요. 현재 확정 기록은 {journey.analysis.currentRecordCount}개이며, 표시된 결과는 최신 기록을 반영하지 않았어요.</p>}
                        {journey.analysis?.currentRecordCount === 0 && <p>홈에서 기록을 먼저 저장해 주세요.</p>}
                        <p>날짜는 근거 기록의 저장 월(UTC)을 기준으로 표시합니다.</p>
                    </div>
                    <button type="button" disabled={generating || journey.analysis?.currentRecordCount === 0} onClick={() => void generate()} className="px-4 py-2 text-sm font-medium bg-brand-primary text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2">
                        {generating ? '성장 분석 중...' : journey.analysis?.id ? '분석 갱신' : '성장 분석하기'}
                    </button>
                </div>
                {generating && <p role="status" className="text-sm text-brand-muted">저장된 기록으로 성장 흐름을 분석하고 있어요.</p>}
                {generationError && <div role="alert" className="space-y-1 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    <p className="font-semibold">분석 요청을 완료하지 못했어요. 표시된 결과와 저장 상태를 확인해 주세요.</p>
                    <p>{generationError}</p>
                </div>}
                {/* 전체 성장 흐름과 첫 경험 배지는 응답으로 표시한다. */}
                <section aria-labelledby="journey-summary-title" className="bg-linear-to-r from-brand-primarySoft via-white to-brand-secondarySoft p-6 rounded-2xl border border-brand-border shadow-soft">
                    <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-bold tracking-wider text-brand-primary uppercase flex items-center gap-1.5">
                                <Sparkles aria-hidden="true" className="w-4 h-4 shrink-0" /> 최근 성장 흐름 AI 분석
                            </span>
                        </div>
                        <h3 id="journey-summary-title" className="text-lg font-bold text-brand-text wrap-anywhere">{journey.summary.title}</h3>
                        <p className="text-xs text-brand-muted leading-relaxed wrap-anywhere">{journey.summary.description}</p>
                    </div>
                    {journey.badges.length > 0 && <div className="mt-4 pt-4 border-t border-brand-border/60 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-brand-muted mr-1">새롭게 쌓인 경험:</span>
                        {journey.badges.map(badge => <span key={badge.id} className="px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-brand-border text-brand-primary shadow-sm">{badge.icon && <span aria-hidden="true" className="mr-1">{badge.icon}</span>}{badge.label}</span>)}
                    </div>}
                </section>

                {/* 유형과 성장 축은 각각의 선택을 유지하며 함께 적용한다. */}
                <div aria-label="성장 필터" className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                    <div role="group" aria-label="성장 유형" className="flex flex-wrap gap-2">
                        {JOURNEY_TYPE_OPTIONS.map(option => <button key={option.value} type="button" aria-pressed={option.value === typeFilter} onClick={() => setTypeFilter(option.value)} className={`px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2 ${option.value === typeFilter ? 'bg-brand-primary text-white' : 'bg-white border border-brand-border text-slate-700 hover:bg-slate-50'}`}>{option.value !== 'all' && <span aria-hidden="true" className="mr-1">{journeyTypeIcon(option.value)}</span>}{option.label}</button>)}
                    </div>
                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-brand-border text-xs shrink-0">
                        <label htmlFor="journey-axis" className="text-brand-muted font-medium">성장 축:</label>
                        <select id="journey-axis" value={axisFilter} onChange={event => setAxisFilter(event.target.value)} className="bg-transparent font-semibold text-brand-text focus-visible:outline-2 focus-visible:outline-brand-primary">
                            {journey.axisOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                    </div>
                </div>

                {/* 서비스의 시간순을 유지하고 전체 기록 없음과 필터 결과 없음을 구분한다. */}
                {journey.events.length === 0 ? <p role="status" className="p-8 text-center text-xs text-brand-muted bg-white border border-brand-border rounded-2xl">{journey.analysis?.id ? '현재 기록에서 근거가 충분한 성장 이벤트를 찾지 못했어요.' : '아직 성장 분석 결과가 없어요.'}</p> : events.length === 0 ? (
                    <p role="status" className="p-8 text-center text-xs text-brand-muted bg-white border border-brand-border rounded-2xl">선택한 조건에 맞는 성장 이벤트가 없어요.</p>
                ) : (
                    <ol aria-label="성장 이벤트" className="relative space-y-8 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-border before:pointer-events-none">
                        {events.map(event => <li key={event.id} className="relative group pl-6">
                            {/* 선과 원을 같은 왼쪽 기준으로 배치하고 원을 선 위에 표시한다. */}
                            <span aria-hidden="true" className="absolute left-[3px] top-1.5 z-10 block w-4 h-4 rounded-full border-2 border-brand-primary bg-white group-hover:bg-brand-primary transition-colors" />
                            <JourneyEventCard event={event} axisOptions={journey.axisOptions} evidenceSources={journey.evidenceSources} expanded={expandedIds.has(event.id)} onToggle={() => toggleEvent(event.id)} />
                        </li>)}
                    </ol>
                )}
            </>}
        </section>
    )
}

export default GrowthJourney
