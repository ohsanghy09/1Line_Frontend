import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle, Trash2, X } from 'lucide-react'
import { deleteAllData } from '../services/settings'
import { CHAT_SESSION_KEY } from '../utils/chatSession'

export default function SettingsModal({ onClose }: { onClose: () => void }) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const titleId = useId()
    const descriptionId = useId()
    const inputId = useId()
    const inputErrorId = useId()
    const inputRef = useRef<HTMLInputElement>(null)
    const [confirmation, setConfirmation] = useState('')
    const [inputError, setInputError] = useState('')
    const [isDeleting, setIsDeleting] = useState(false)
    const [error, setError] = useState('')
    const [deleted, setDeleted] = useState(false)

    // 네이티브 모달로 배경 조작·초점을 제한하고 닫을 때 설정 버튼으로 복귀한다.
    useEffect(() => {
        const previous = document.activeElement as HTMLElement | null
        const dialog = dialogRef.current
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        dialog?.showModal()
        return () => { dialog?.close(); document.body.style.overflow = overflow; previous?.focus() }
    }, [])

    async function handleDelete() {
        if (isDeleting) return
        // 삭제 요청 전에 확인 문구를 검증하고 잘못된 입력으로 초점을 이동한다.
        if (confirmation !== '전체 삭제') {
            setInputError(confirmation.trim() ? '확인 문구가 일치하지 않아요. ‘전체 삭제’를 정확히 입력해 주세요.' : '확인 문구 ‘전체 삭제’를 입력해 주세요.')
            inputRef.current?.focus()
            return
        }
        setInputError('')
        setIsDeleting(true)
        setError('')
        try {
            await deleteAllData(confirmation)
            setDeleted(true)
            // 다른 사이트 설정은 보존하고 현재 탭의 홈 대화만 제거한다.
            try { sessionStorage.removeItem(CHAT_SESSION_KEY) } catch { /* 저장소 차단 시에도 DB 삭제는 완료됐다. */ }
        } catch (error) {
            setError(error instanceof Error ? error.message : '데이터를 삭제하지 못했어요.')
        } finally { setIsDeleting(false) }
    }

    return createPortal(
        <dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
            onCancel={event => { event.preventDefault(); if (!isDeleting && !deleted) onClose() }}
            className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-2xl border border-brand-border bg-brand-surface p-6 text-brand-text shadow-xl backdrop:bg-slate-900/40">
            <div className="space-y-5">
                <div className="flex items-center justify-between border-b border-brand-border pb-3">
                    <h2 id={titleId} className="text-base font-bold">설정</h2>
                    <button autoFocus type="button" disabled={isDeleting || deleted} onClick={onClose} aria-label="설정 닫기" className="text-brand-muted hover:text-brand-text disabled:opacity-50"><X aria-hidden="true" className="h-5 w-5" /></button>
                </div>
                {deleted ? <>
                    <p id={descriptionId} role="status" className="text-sm">모든 데이터가 삭제되었습니다. 홈에서 새로 시작할 수 있어요.</p>
                    <button type="button" onClick={() => window.location.assign('/')} className="w-full rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-semibold text-white">홈으로 이동</button>
                </> : <form className="space-y-4" onSubmit={event => { event.preventDefault(); void handleDelete() }}>
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-red-600"><Trash2 aria-hidden="true" className="h-4 w-4" />전체 데이터 삭제</h3>
                    <p id={descriptionId} className="text-sm leading-relaxed text-brand-muted">모든 활동, 저장 기록, 업로드한 원본 파일, 분석 초안과 성장 분석 결과를 삭제합니다. 삭제한 데이터는 복구할 수 없습니다.</p>
                    <div className="space-y-2">
                        <label htmlFor={inputId} className="block text-xs font-medium">계속하려면 ‘전체 삭제’를 입력해 주세요.</label>
                        <input ref={inputRef} id={inputId} value={confirmation} disabled={isDeleting} autoComplete="off"
                            aria-invalid={Boolean(inputError)} aria-describedby={inputError ? inputErrorId : undefined}
                            onChange={event => { setConfirmation(event.target.value); setInputError('') }}
                            className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none ${inputError ? 'border-red-300 focus:border-red-300' : 'border-brand-border focus:border-brand-primary'}`} />
                        {inputError && <p id={inputErrorId} role="alert" className="text-xs text-red-500">{inputError}</p>}
                    </div>
                    {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <button type="button" disabled={isDeleting} onClick={onClose} className="rounded-xl border border-brand-border px-4 py-2 text-xs font-medium disabled:opacity-50">취소</button>
                        <button type="submit" disabled={isDeleting} className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                            {isDeleting && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />}
                            {isDeleting ? '삭제 중…' : '전체 데이터 삭제'}
                        </button>
                    </div>
                </form>}
            </div>
        </dialog>, document.body,
    )
}
