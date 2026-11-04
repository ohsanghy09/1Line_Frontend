import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeft, Folder, GitCommitHorizontal, Sparkles } from 'lucide-react'
import ActivityFolders from '../components/footprints/ActivityFolders'
import FileDetailDrawer from '../components/footprints/FileDetailDrawer'
import { getFootprintActivity } from '../services/footprints'
import type { FootprintActivityDetail } from '../types/footprints'

// URL에서 활동을 바꾸면 조회·펼침 상태도 해당 활동 기준으로 새로 시작한다.
function ActivityArchive() {
    const { activityId = '' } = useParams()
    return <ActivityArchiveContent key={activityId} activityId={activityId} />
}

function ActivityArchiveContent({ activityId }: { activityId: string }) {
    // 자료 ID를 URL에 보관해 Timeline의 근거 자료 링크와 직접 접근도 지원한다.
    const [searchParams, setSearchParams] = useSearchParams()
    const selectedFileId = searchParams.get('file')
    function selectFile(fileId: string | null) {
        setSearchParams(current => {
            const next = new URLSearchParams(current)
            if (fileId === null) next.delete('file')
            else next.set('file', fileId)
            return next
        }, { replace: true, preventScrollReset: true })
    }
    const [activity, setActivity] = useState<FootprintActivityDetail | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        // 빠르게 다른 활동으로 이동하거나 페이지를 떠나면 이전 응답은 무시한다.
        let isActive = true

        async function loadActivity() {
            try {
                const response = await getFootprintActivity(activityId)
                if (isActive) setActivity(response)
            } catch {
                if (isActive) setError('활동 정보를 불러오지 못했어요. 잠시 후 다시 방문해주세요.')
            } finally {
                if (isActive) setIsLoading(false)
            }
        }

        void loadActivity()
        return () => { isActive = false }
    }, [activityId])

    return (
        <section aria-label="활동 상세" className="space-y-6">
            {/* 목록으로의 이동은 직접 접근한 상세 URL에서도 사용할 수 있다. */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <Link to="/archive" className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-muted hover:text-brand-text">
                    <ArrowLeft aria-hidden="true" className="w-4 h-4" />
                    나의 발자국으로 돌아가기
                </Link>
                {/* 선택한 활동의 Timeline으로 이동한다. */}
                {activity && (
                    <Link to={`/archive/${encodeURIComponent(activityId)}/timeline`} className="px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-primaryHover text-white font-medium text-xs flex items-center gap-2 shadow-sm transition">
                        <GitCommitHorizontal aria-hidden="true" className="w-4 h-4 shrink-0" />
                        <span>변화 과정 보기 (Project Timeline)</span>
                    </Link>
                )}
            </div>

            {isLoading ? (
                <p role="status" className="p-8 text-center text-sm text-brand-muted">활동 정보를 불러오고 있어요.</p>
            ) : error ? (
                <p role="alert" className="p-8 text-center text-sm text-brand-muted bg-white rounded-2xl border border-brand-border">{error}</p>
            ) : !activity ? (
                <div className="p-8 text-center bg-white rounded-2xl border border-brand-border space-y-2">
                    <h2 className="font-bold text-brand-text">활동을 찾을 수 없어요.</h2>
                    <p className="text-sm text-brand-muted">나의 발자국 목록에서 활동을 다시 선택해주세요.</p>
                </div>
            ) : (
                <>
                    {/* 원본의 활동 정보와 AI 요약 카드 */}
                    <header className="bg-brand-surface p-6 rounded-2xl border border-brand-border shadow-soft space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-3 min-w-0">
                                <h2 className="text-xl font-bold text-brand-text wrap-anywhere">{activity.title}</h2>
                                <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-brand-primarySoft text-brand-primary">{activity.category}</span>
                                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${activity.status === '진행 중' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{activity.status}</span>
                            </div>
                            <p className="text-xs text-brand-muted font-medium">역할: {activity.role} ({activity.period})</p>
                        </div>
                        <div className="p-3.5 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs space-y-1">
                            <h3 className="font-bold text-brand-primary flex items-center gap-1">
                                <Sparkles aria-hidden="true" className="w-3.5 h-3.5" /> AI 활동 요약
                            </h3>
                            <p className="text-slate-700 leading-relaxed wrap-anywhere">{activity.summary}</p>
                        </div>
                    </header>

                    <section aria-labelledby="archive-folders-title" className="space-y-3">
                        <h3 id="archive-folders-title" className="font-bold text-base text-brand-text flex items-center gap-2">
                            <Folder aria-hidden="true" className="w-4.5 h-4.5 text-brand-primary" /> 보관된 자료 폴더
                        </h3>
                        <ActivityFolders folders={activity.folders} onSelectFile={selectFile} />
                    </section>
                    {selectedFileId !== null && <FileDetailDrawer key={selectedFileId} activityId={activityId} fileId={selectedFileId} onClose={() => selectFile(null)} />}
                </>
            )}
        </section>
    )
}

export default ActivityArchive
