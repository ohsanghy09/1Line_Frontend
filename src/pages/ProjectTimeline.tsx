import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { ArrowLeft, Folder } from 'lucide-react'
import { getFootprintActivity } from '../services/footprints'
import type { FootprintActivityDetail } from '../types/footprints'

function ProjectTimeline() {
    const { activityId = '' } = useParams()
    return <ProjectTimelineContent key={activityId} activityId={activityId} />
}

function ProjectTimelineContent({ activityId }: { activityId: string }) {
    const [activity, setActivity] = useState<FootprintActivityDetail | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const { hash } = useLocation()
    const archivePath = `/archive/${encodeURIComponent(activityId)}`

    useEffect(() => {
        // 활동 변경·화면 이탈 후에는 이전 활동 응답을 반영하지 않는다.
        let isActive = true
        async function loadTimeline() {
            try {
                const response = await getFootprintActivity(activityId)
                if (isActive) setActivity(response)
            } catch {
                if (isActive) setError('타임라인을 불러오지 못했어요. 잠시 후 다시 방문해주세요.')
            } finally {
                if (isActive) setIsLoading(false)
            }
        }
        void loadTimeline()
        return () => { isActive = false }
    }, [activityId])

    useEffect(() => {
        // Drawer에서 선택한 이벤트로 이동한다. 다른 활동/임의 요소 ID는 조회하지 않는다.
        const event = activity?.timeline.find(item => `#${item.id}` === hash)
        if (!event) return
        const element = document.getElementById(event.id)
        element?.scrollIntoView({ block: 'start' })
        element?.focus({ preventScroll: true })
    }, [activity, hash])

    const events = activity?.timeline ?? []
    const turningPointCount = events.filter(event => event.isTurningPoint).length
    const files = activity?.folders.flatMap(folder => folder.files) ?? []

    return (
        <section aria-label="Project Timeline" className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Link to={archivePath} className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-muted hover:text-brand-text">
                    <ArrowLeft aria-hidden="true" className="w-4 h-4" /> 활동 상세로 돌아가기
                </Link>
                <Link to={archivePath} className="px-3.5 py-1.5 rounded-xl bg-white border border-brand-border hover:bg-slate-50 text-slate-700 font-medium text-xs flex items-center gap-2 transition">
                    <Folder aria-hidden="true" className="w-4 h-4 text-brand-primary" /> 관련 자료 보기
                </Link>
            </div>

            {isLoading ? (
                <p role="status" className="p-8 text-center text-sm text-brand-muted">타임라인을 불러오고 있어요.</p>
            ) : error ? (
                <p role="alert" className="p-8 text-center text-sm text-brand-muted bg-white rounded-xl border border-brand-border">{error}</p>
            ) : !activity ? (
                <div className="p-8 text-center bg-white rounded-xl border border-brand-border space-y-2">
                    <h2 className="font-bold">활동을 찾을 수 없어요.</h2>
                    <Link to="/archive" className="text-sm text-brand-primary underline">나의 발자국으로 돌아가기</Link>
                </div>
            ) : (
                <>
                    <header className="bg-brand-surface p-6 rounded-2xl border border-brand-border shadow-soft flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="space-y-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-xl font-bold text-brand-text wrap-anywhere">{activity.title} Project Timeline</h2>
                                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${activity.status === '진행 중' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{activity.status}</span>
                            </div>
                            <p className="text-xs text-brand-muted">{activity.category} · {activity.role} ({activity.period})</p>
                        </div>
                        <dl className="flex flex-wrap items-center gap-3 text-xs shrink-0">
                            <div className="px-3.5 py-2 bg-slate-50 border border-brand-border rounded-xl text-center">
                                <dt className="text-brand-muted text-[10px]">주요 변화</dt>
                                <dd className="text-base text-brand-text font-bold">{events.length}개</dd>
                            </div>
                            <div className="px-3.5 py-2 bg-brand-secondarySoft border border-indigo-100 rounded-xl text-center">
                                <dt className="text-brand-secondary text-[10px] font-bold">Turning Point</dt>
                                <dd className="text-base text-brand-secondary font-bold">{turningPointCount}개</dd>
                            </div>
                        </dl>
                    </header>

                    {events.length === 0 ? (
                        <p className="p-6 text-center text-xs text-brand-muted bg-white rounded-xl border border-brand-border">등록된 타임라인 이벤트가 없습니다.</p>
                    ) : (
                        <ol aria-label="활동 변화 이벤트" className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-brand-border">
                            {events.map(event => (
                                <li key={event.id} className="relative">
                                    <span aria-hidden="true" className={`absolute -left-[21px] top-2 w-4 h-4 rounded-full border-2 ${event.isTurningPoint ? 'border-brand-secondary bg-brand-secondary' : 'border-slate-300 bg-white'}`} />
                                    <article id={event.id} tabIndex={-1} className={`scroll-mt-6 p-5 rounded-2xl border space-y-3 focus-visible:outline-2 focus-visible:outline-brand-primary ${event.isTurningPoint ? 'bg-brand-accentBg border-indigo-200 shadow-soft' : 'bg-white border-brand-border'}`}>
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <time dateTime={event.occurredAt} className={`text-xs font-bold ${event.isTurningPoint ? 'text-brand-secondary' : 'text-brand-muted'}`}>{event.dateLabel}</time>
                                            {event.isTurningPoint && <span className="px-2 py-0.5 bg-brand-secondary text-white rounded text-[10px] font-bold">⭐ TURNING POINT</span>}
                                        </div>
                                        <h3 className="font-bold text-base text-brand-text wrap-anywhere">{event.title}</h3>
                                        {event.isTurningPoint ? (
                                            <>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 bg-white/80 rounded-xl border border-indigo-100 text-xs">
                                                    <div><span className="text-[10px] font-bold text-brand-muted block">Before</span><p className="text-slate-700 font-medium wrap-anywhere">{event.before}</p></div>
                                                    <div className="border-t md:border-t-0 md:border-l border-indigo-100 pt-2 md:pt-0 md:pl-3"><span className="text-[10px] font-bold text-brand-primary block">After</span><p className="text-brand-primary font-bold wrap-anywhere">{event.after}</p></div>
                                                </div>
                                                <p className="text-[11px] text-brand-muted wrap-anywhere"><strong>Reason:</strong> {event.reason}</p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-xs text-brand-muted leading-relaxed wrap-anywhere">{event.description}</p>
                                                {event.change && (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3.5 bg-slate-50 rounded-xl border border-brand-border text-xs">
                                                        <div><span className="text-[10px] font-bold text-brand-muted block">Before</span><p className="wrap-anywhere">{event.change.before}</p></div>
                                                        <div><span className="text-[10px] font-bold text-brand-primary block">After</span><p className="text-brand-primary wrap-anywhere">{event.change.after}</p></div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        {event.evidenceLabels?.map((label, index) => <p key={index} className="text-[11px] text-brand-muted wrap-anywhere"><strong>Evidence:</strong> {label}</p>)}
                                        {event.evidenceFileIds.length > 0 && (
                                            <div className="text-[11px] text-brand-muted flex flex-wrap gap-x-2 gap-y-1">
                                                <strong>Evidence:</strong>
                                                {event.evidenceFileIds.map(fileId => {
                                                    const file = files.find(item => item.id === fileId)
                                                    return file ? <Link key={fileId} to={`${archivePath}?file=${encodeURIComponent(fileId)}`} className="text-brand-primary font-semibold underline underline-offset-2 wrap-anywhere">{file.name}</Link> : <span key={fileId}>근거 자료를 찾을 수 없어요.</span>
                                                })}
                                            </div>
                                        )}
                                    </article>
                                </li>
                            ))}
                        </ol>
                    )}
                </>
            )}
        </section>
    )
}

export default ProjectTimeline
