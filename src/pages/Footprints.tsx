import { useEffect, useState } from 'react'
import { ChevronRight, LoaderCircle, Search } from 'lucide-react'
import { Link } from 'react-router'
import { searchFootprintActivities } from '../services/footprints'
import type { FootprintActivity, FootprintFilters } from '../types/footprints'

function Footprints() {
    // DB에서 조회한 목록과 요청 상태를 관리한다.
    const [activities, setActivities] = useState<FootprintActivity[]>([])
    // AI 분석으로 저장된 활동 유형을 서버에서 받으며 전체는 화면에서 추가한다.
    const [categories, setCategories] = useState<string[]>([])
    const categoryOptions = [{ value: 'all', label: '전체' }, ...categories.map(category => ({ value: category, label: category }))]
    const [total, setTotal] = useState(0)
    const [isLoading, setIsLoading] = useState(true)
    const [hasLoaded, setHasLoaded] = useState(false)
    const [retryKey, setRetryKey] = useState(0)
    const [error, setError] = useState<string | null>(null)

    // 검색·필터·정렬 조건을 서버로 전달한다. 자료명/내용 일치를 프론트에서 재필터링하지 않는다.
    const [filters, setFilters] = useState<FootprintFilters>({
        search: '', category: 'all', status: 'all', sort: 'recent',
    })

    // 분석 중인 활동이 있을 때만 목록을 재조회한다. 조회는 모델을 호출하지 않는다.
    useEffect(() => {
        if (!activities.some(activity => ['queued', 'running'].includes(activity.metadataAnalysis?.status ?? ''))) return
        const timer = setTimeout(() => setRetryKey(current => current + 1), 1500)
        return () => clearTimeout(timer)
    }, [activities])

    useEffect(() => {
        const refresh = () => setRetryKey(current => current + 1)
        window.addEventListener('1line:activities-changed', refresh)
        return () => window.removeEventListener('1line:activities-changed', refresh)
    }, [])

    function updateFilters(next: Partial<FootprintFilters>) {
        // 조합 중인 한글을 포함해 입력이 바뀌면 즉시 재조회 상태로 전환한다.
        setIsLoading(true)
        setError(null)
        setFilters(current => ({ ...current, ...next }))
    }

    function retry() {
        setError(null)
        setIsLoading(true)
        setRetryKey(current => current + 1)
    }

    useEffect(() => {
        // 입력 변경마다 즉시 요청하고, 이전 요청을 취소해 최신 조건의 결과만 반영한다.
        const controller = new AbortController()
        let isActive = true

        async function loadActivities() {
            setIsLoading(true)
            setError(null)
            try {
                const response = await searchFootprintActivities(filters, controller.signal)
                if (isActive) {
                    setActivities(response.items); setTotal(response.total); setCategories(response.categories); setHasLoaded(true)
                    // 다른 화면에서 분류가 변경되어 선택지가 사라지면 전체로 복귀한다.
                    if (filters.category !== 'all' && !response.categories.includes(filters.category)) setFilters(current => ({ ...current, category: 'all' }))
                }
            } catch (error) {
                if (isActive && !controller.signal.aborted) setError(error instanceof Error ? error.message : '활동 목록을 불러오지 못했어요.')
            } finally {
                if (isActive) setIsLoading(false)
            }
        }

        void loadActivities()
        return () => { isActive = false; controller.abort() }
    }, [filters, retryKey])

    return (
        <section aria-labelledby="footprints-title" className="space-y-6">
            {/* 원본의 페이지 제목과 설명 */}
            <header>
                <h2 id="footprints-title" className="text-xl sm:text-2xl font-bold tracking-tight text-brand-text">나의 발자국</h2>
                <p className="text-sm text-brand-muted mt-1">지금까지의 활동과 그 안에 남겨둔 자료를 한곳에서 확인해보세요.</p>
            </header>

            {/* 저장된 이름·입력 글·요약만 검색하며 파일 내부 본문은 읽지 않는다. */}
            <div className="bg-brand-surface p-4 rounded-2xl border border-brand-border shadow-soft space-y-4">
                <div className="relative">
                    <label htmlFor="footprints-search" className="sr-only">활동명, 파일명, 저장된 내용 검색</label>
                    <Search aria-hidden="true" className="w-5 h-5 absolute left-3.5 top-3 text-brand-muted pointer-events-none" />
                    <input
                        id="footprints-search"
                        type="search"
                        maxLength={500}
                        aria-describedby="footprints-search-help"
                        value={filters.search}
                        onChange={event => updateFilters({ search: event.target.value })}
                        placeholder="활동명, 파일명, 내용으로 검색..."
                        className="w-full bg-slate-50 border border-brand-border rounded-xl pl-11 pr-4 py-2.5 text-sm text-brand-text focus:outline-none focus:border-brand-primary transition"
                    />
                </div>
                <p id="footprints-search-help" className="text-[11px] text-brand-muted">활동명, 자료명, 입력한 글과 저장된 요약을 검색해요. 파일 내부 본문은 검색하지 않아요.</p>

                <div className="flex flex-wrap gap-4 items-center justify-between text-xs">
                    <div role="group" aria-label="활동 유형" className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-brand-muted">유형:</span>
                        {categoryOptions.map(option => (
                            <button
                                key={option.value}
                                type="button"
                                aria-pressed={filters.category === option.value}
                                onClick={() => updateFilters({ category: option.value })}
                                className={`px-3 py-1 rounded-lg font-medium ${filters.category === option.value ? 'bg-brand-primary text-white' : 'bg-slate-100 text-brand-muted hover:bg-slate-200'}`}
                            >
                                {option.label}
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1.5">
                            <label htmlFor="footprints-status" className="text-brand-muted">상태:</label>
                            <select
                                id="footprints-status"
                                value={filters.status}
                                onChange={event => updateFilters({ status: event.target.value as FootprintFilters['status'] })}
                                className="bg-slate-50 border border-brand-border rounded-lg px-2.5 py-1 text-xs text-brand-text"
                            >
                                <option value="all">전체</option>
                                <option value="진행 중">진행 중</option>
                                <option value="완료">완료</option>
                            </select>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <label htmlFor="footprints-sort" className="text-brand-muted">정렬:</label>
                            <select
                                id="footprints-sort"
                                value={filters.sort}
                                aria-describedby="footprints-sort-help"
                                onChange={event => updateFilters({ sort: event.target.value as FootprintFilters['sort'] })}
                                className="bg-slate-50 border border-brand-border rounded-lg px-2.5 py-1 text-xs text-brand-text"
                            >
                                <option value="recent">최근 업데이트</option>
                                <option value="materials">자료 많은 순</option>
                                <option value="oldest">오래된 순</option>
                            </select>
                            <span id="footprints-sort-help" className="sr-only">오래된 순은 최근 업데이트가 오래된 활동부터 표시합니다.</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* 최초 조회는 큰 안내, 재조회는 기존 목록 위의 안내와 흐림 효과로 구분한다. */}
            <div className="relative min-h-[280px]">
            {!hasLoaded && !error ? (
                <div role="status" className="min-h-[280px] flex flex-col items-center justify-center gap-4 p-8 text-center bg-white rounded-2xl border border-brand-border shadow-soft">
                    <span className="flex items-center justify-center w-14 h-14 rounded-full bg-brand-primarySoft text-brand-primary">
                        <LoaderCircle aria-hidden="true" className="w-8 h-8 animate-spin motion-reduce:animate-none" />
                    </span>
                    <p className="text-sm font-semibold text-brand-text">활동 목록을 불러오고 있어요.</p>
                </div>
            ) : error ? (
                <div role="alert" className="p-8 text-center text-sm text-brand-muted bg-white rounded-2xl border border-brand-border space-y-3">
                    <p>{error}</p>
                    <button type="button" onClick={retry} className="px-4 py-2 rounded-xl bg-brand-primary text-white font-medium hover:bg-brand-primaryHover">다시 불러오기</button>
                </div>
            ) : (
                <>
                {isLoading && (
                    <div role="status" className="absolute inset-x-0 top-4 z-10 flex justify-center pointer-events-none px-3">
                        <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white border border-brand-primary/30 shadow-soft text-sm font-semibold text-brand-primary">
                            <LoaderCircle aria-hidden="true" className="w-5 h-5 shrink-0 animate-spin motion-reduce:animate-none" />
                            조건에 맞는 활동을 찾고 있어요.
                        </div>
                    </div>
                )}
                {/* inert는 재조회 중 이전 결과의 마우스·키보드 이동을 함께 막는다. */}
                <div inert={isLoading} aria-busy={isLoading} aria-hidden={isLoading ? true : undefined} className={isLoading ? 'opacity-40 pointer-events-none' : ''}>
                {total === 0 ? (
                <p className="p-8 text-center text-sm text-brand-muted bg-white rounded-2xl border border-brand-border">아직 기록한 활동이 없어요.</p>
            ) : activities.length === 0 ? (
                <p role="status" className="p-8 text-center text-xs text-brand-muted bg-white rounded-2xl border border-brand-border">조건에 맞는 활동이 없어요.</p>
            ) : (
                <ul aria-label="활동 목록" className="space-y-3">
                    {activities.map(activity => (
                        <li key={activity.id}>
                            {/* 활동 ID를 URL로 전달해 해당 활동의 상세 아카이브로 이동한다. */}
                            <Link to={`/archive/${encodeURIComponent(activity.id)}`} aria-label={`${activity.title} 활동 상세 보기`} className="group bg-white p-5 rounded-2xl border border-brand-border shadow-soft hover:border-brand-primary hover:shadow-cardHover transition flex flex-col md:flex-row justify-between md:items-center gap-4 focus-visible:outline-2 focus-visible:outline-brand-primary">
                                <div className="space-y-1.5 flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
                                        <h3 className="font-bold text-base text-brand-text group-hover:text-brand-primary transition wrap-anywhere">{activity.title}</h3>
                                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">{activity.category}</span>
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${activity.status === '진행 중' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                            {activity.status === '진행 중' ? '🟢 진행 중' : activity.status === '완료' ? '✓ 완료' : '상태 미설정'}
                                        </span>
                                    </div>
                                    <p className="text-xs text-brand-muted leading-relaxed wrap-anywhere">{activity.summary}</p>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-brand-muted pt-1">
                                        <span>기간: {activity.period}</span>
                                        <span>역할: {activity.role}</span>
                                    </div>
                                </div>

                                {/* 실제 확정 자료 수와 저장·수정 시각을 표시한다. */}
                                <div className="flex flex-wrap items-center justify-between md:flex-col md:items-end gap-2 border-t md:border-t-0 border-slate-100 pt-3 md:pt-0 shrink-0">
                                    <div className="flex items-center gap-4">
                                        <span className="text-xs font-semibold text-brand-primary bg-brand-primarySoft px-3 py-1.5 rounded-xl">자료 {activity.materialsCount}개</span>
                                        <ChevronRight aria-hidden="true" className="w-5 h-5 text-brand-muted group-hover:text-brand-primary transition" />
                                    </div>
                                    <span className="text-[11px] text-brand-muted">최근 업데이트: {activity.updatedAtLabel}</span>
                                </div>
                            </Link>
                        </li>
                    ))}
                </ul>
                )}
                </div>
                </>
            )}
            </div>
        </section>
    )
}

export default Footprints
