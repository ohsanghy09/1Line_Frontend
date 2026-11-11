import { Link, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isHttpUrl } from '../../../services/chat'

// 원본 링크 모달의 간격·색상·크기를 유지한다. 분석 접수와 기록 확정은 분리한다.
export default function LinkInputModal({ initialUrl, onClose, onSubmit }: { initialUrl: string; onClose: () => void; onSubmit: (url: string) => void }) {
    const [url, setUrl] = useState(initialUrl)
    const [error, setError] = useState('')
    const dialogRef = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    const errorId = useId()
    useEffect(() => {
        const dialog = dialogRef.current
        const previous = document.activeElement as HTMLElement | null
        dialog?.showModal()
        return () => { dialog?.close(); previous?.focus() }
    }, [])
    return createPortal(
        <dialog ref={dialogRef} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose() }} className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto bg-brand-surface text-brand-text rounded-2xl border border-brand-border shadow-xl p-6 backdrop:bg-slate-900/40 backdrop:backdrop-blur-xs">
            {/* 브라우저 기본 경고 대신 입력창 아래에서 URL 오류를 안내한다. */}
            <form noValidate className="space-y-4" onSubmit={event => {
                event.preventDefault()
                if (!isHttpUrl(url.trim())) { setError('HTTP 또는 HTTPS 링크를 입력해 주세요.'); return }
                onSubmit(url.trim())
            }}>
                <div className="flex items-center justify-between border-b border-brand-border pb-3">
                    <h3 id={titleId} className="font-bold text-base flex items-center gap-2"><Link className="w-4.5 h-4.5 text-brand-primary" />링크 추가</h3>
                    <button type="button" onClick={onClose} aria-label="링크 모달 닫기" className="text-brand-muted hover:text-brand-text"><X className="w-5 h-5" /></button>
                </div>
                <p className="text-xs text-brand-muted">기록할 링크를 붙여넣어 주세요.</p>
                <div className="space-y-1.5">
                    <input autoFocus required type="url" maxLength={4096} value={url} onChange={event => { setUrl(event.target.value); setError('') }} aria-label="추가할 링크 URL" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} placeholder="https://www.GrowthAI.com" className={`w-full border rounded-xl px-3.5 py-2.5 text-sm focus:outline-none ${error ? 'border-red-300 focus:border-red-300' : 'border-brand-border focus:border-brand-primary'}`} />
                    {error && <p id={errorId} role="alert" className="pl-2 text-xs text-red-400">{error}</p>}
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border border-brand-border text-xs font-medium text-slate-700 hover:bg-slate-50">취소</button>
                    <button type="submit" disabled={!url.trim()} className="px-4 py-2 rounded-xl bg-brand-primary text-white text-xs font-medium hover:bg-brand-primaryHover disabled:opacity-50">분석</button>
                </div>
            </form>
        </dialog>, document.body,
    )
}
