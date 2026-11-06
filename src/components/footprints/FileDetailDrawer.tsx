import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router'
import { ArrowRight, GitCommitHorizontal, Trash2, X } from 'lucide-react'
import { deleteFootprintMaterial, getFootprintFile } from '../../services/footprints'
import DeleteConfirmation from './DeleteConfirmation'
import type { FootprintFileDetail } from '../../types/footprints'

function FileDetailDrawer({ activityId, fileId, onClose }: { activityId: string; fileId: string; onClose: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const closeRef = useRef<HTMLButtonElement>(null)
    const titleId = useId()
    const [detail, setDetail] = useState<FootprintFileDetail | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [confirmDelete, setConfirmDelete] = useState(false)

    useEffect(() => {
        // native dialog가 배경 비활성화와 초점 제한을 담당한다. 닫으면 호출한 자료 버튼으로 복귀한다.
        const dialog = dialogRef.current
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        dialog?.showModal()
        closeRef.current?.focus()

        return () => {
            dialog?.close()
            document.body.style.overflow = previousOverflow
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
        }
    }, [])

    useEffect(() => {
        let isActive = true
        async function loadFile() {
            try {
                const response = await getFootprintFile(activityId, fileId)
                if (isActive) setDetail(response)
            } catch {
                if (isActive) setError('자료 정보를 불러오지 못했어요. 잠시 후 다시 열어주세요.')
            } finally {
                if (isActive) setIsLoading(false)
            }
        }
        void loadFile()
        return () => { isActive = false }
    }, [activityId, fileId])

    return createPortal(
        <dialog
            ref={dialogRef}
            aria-labelledby={titleId}
            onCancel={event => { if (event.target === event.currentTarget) { event.preventDefault(); onClose() } }}
            onClick={event => {
                // dialog 바깥의 원본 오버레이 클릭만 닫기로 처리한다.
                if (event.target !== event.currentTarget) return
                const bounds = event.currentTarget.getBoundingClientRect()
                if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose()
            }}
            className="footprint-drawer fixed inset-y-0 left-auto right-0 m-0 h-dvh max-h-none w-full sm:w-[440px] max-w-none p-0 bg-brand-surface text-brand-text border-0 border-l border-brand-border shadow-2xl open:flex flex-col backdrop:bg-slate-900/30 backdrop:backdrop-blur-xs"
        >
            <div className="p-5 border-b border-brand-border flex items-start justify-between gap-3 bg-slate-50/50 shrink-0">
                <h3 id={titleId} className="font-bold text-base wrap-anywhere">{detail?.file.name ?? '자료 상세 정보'}</h3>
                <div className="flex items-center gap-1 shrink-0">
                    {detail && !isLoading && !error && <button type="button" onClick={() => setConfirmDelete(true)} aria-label="자료 삭제" className="cursor-pointer rounded-lg p-1 text-red-600 transition-colors hover:bg-red-100 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-red-400 focus-visible:outline-offset-2"><Trash2 aria-hidden="true" className="h-5 w-5" /></button>}
                    <button ref={closeRef} type="button" onClick={onClose} aria-label="자료 상세 닫기" className="p-1 rounded-lg text-brand-muted hover:bg-slate-200 shrink-0">
                        <X aria-hidden="true" className="w-5 h-5" />
                    </button>
                </div>
            </div>
            <div className="p-6 flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-5">
                {isLoading ? (
                    <p role="status" className="text-xs text-brand-muted">자료 정보를 불러오고 있어요.</p>
                ) : error ? (
                    <p role="alert" className="text-xs text-brand-muted">{error}</p>
                ) : !detail ? (
                    <p role="status" className="text-xs text-brand-muted">이 활동에서 자료를 찾을 수 없어요.</p>
                ) : (
                    <>
                        <dl className="p-3.5 bg-slate-50 rounded-xl border border-brand-border text-xs space-y-2">
                            <div><dt className="inline text-brand-muted">자료 유형: </dt><dd className="inline font-semibold">{detail.file.type}</dd></div>
                            <div><dt className="inline text-brand-muted">업로드일: </dt><dd className="inline font-semibold">{detail.file.uploadedAtLabel}</dd></div>
                            {detail.file.version && <div><dt className="inline text-brand-muted">버전: </dt><dd className="inline font-semibold">{detail.file.version}</dd></div>}
                            {detail.versionHistory.length > 1 && <div><dt className="inline text-brand-muted">버전 이력: </dt><dd className="inline text-brand-primary font-semibold">{detail.versionHistory.map(item => item.version).join(' → ')}</dd></div>}
                        </dl>
                        <div className="space-y-1">
                            <h4 className="font-bold text-xs">{detail.file.summaryScope === 'record' ? 'AI 기록 요약' : 'AI 요약'}</h4>
                            <p className="text-xs text-brand-muted leading-relaxed wrap-anywhere">{detail.file.summary}</p>
                        </div>

                        {/* 선택 자료가 근거로 연결된 이벤트만 표시한다. 변화 없는 파일에 비교를 만들지 않는다. */}
                        {detail.events.map(event => (
                            <div key={event.id} className="space-y-3">
                                {(event.isTurningPoint || event.change) && (
                                    <div className="p-4 bg-indigo-50/60 border border-indigo-100 rounded-xl space-y-2">
                                        <h4 className="font-bold text-xs text-brand-primary flex items-center gap-1.5">
                                            <GitCommitHorizontal aria-hidden="true" className="w-4 h-4 shrink-0" /> {event.isTurningPoint ? '발견된 변화 (Turning Point)' : '발견된 변화'}
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                            <div><span className="text-[10px] text-brand-muted block">Before</span><p className="text-slate-700 wrap-anywhere">{event.isTurningPoint ? event.before : event.change?.before}</p></div>
                                            <div className="border-t sm:border-t-0 sm:border-l border-indigo-200 pt-2 sm:pt-0 sm:pl-2"><span className="text-[10px] text-brand-primary block">After</span><p className="font-bold text-brand-primary wrap-anywhere">{event.isTurningPoint ? event.after : event.change?.after}</p></div>
                                        </div>
                                    </div>
                                )}
                                <p className="text-xs text-brand-muted">관련 Timeline 이벤트: <Link to={`/archive/${encodeURIComponent(activityId)}/timeline#${event.id}`} className="text-brand-primary font-semibold underline underline-offset-2">{event.title}</Link></p>
                            </div>
                        ))}

                        <div className="pt-4">
                            <Link to={`/archive/${encodeURIComponent(activityId)}/timeline${detail.events[0] ? `#${detail.events[0].id}` : ''}`} className="w-full py-2.5 px-3 bg-brand-primary text-white font-medium rounded-xl text-xs hover:bg-brand-primaryHover transition flex items-center justify-center gap-2">
                                Project Timeline에서 보기 <ArrowRight aria-hidden="true" className="w-4 h-4 shrink-0" />
                            </Link>
                        </div>
                        {confirmDelete && <DeleteConfirmation title="자료 삭제"
                            description={`‘${detail.file.name}’ 자료를 삭제할까요? 마지막 자료라면 연결된 기록과 타임라인도 삭제해요. 같은 기록에 다른 파일이 남으면 재분석한 뒤 삭제하며, 실패하면 기존 자료를 유지해요. 삭제한 자료는 복구할 수 없어요.`}
                            onClose={() => setConfirmDelete(false)} onDelete={async () => {
                                await deleteFootprintMaterial(activityId, fileId)
                                onClose()
                            }} />}
                    </>
                )}
            </div>
        </dialog>, document.body,
    )
}

export default FileDetailDrawer
