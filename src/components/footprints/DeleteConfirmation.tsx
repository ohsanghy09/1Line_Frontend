import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export default function DeleteConfirmation({ title, description, confirmation, onDelete, onClose }: {
    title: string; description: string; confirmation?: string; onDelete: () => Promise<void>; onClose: () => void
}) {
    const dialogRef = useRef<HTMLDialogElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const locked = useRef(false)
    const titleId = useId()
    const descriptionId = useId()
    const inputId = useId()
    const errorId = useId()
    const [value, setValue] = useState('')
    const [inputError, setInputError] = useState('')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
        const dialog = dialogRef.current
        const overflow = document.body.style.overflow
        const nested = Boolean(document.querySelector('dialog[open]'))
        if (!nested) document.body.style.overflow = 'hidden'
        dialog?.showModal()
        return () => { dialog?.close(); if (!nested) document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus() }
    }, [])

    async function submit() {
        if (locked.current) return
        if (confirmation !== undefined && value !== confirmation) {
            setInputError(value ? '활동명이 일치하지 않아요. 정확히 입력해 주세요.' : '삭제할 활동명을 입력해 주세요.')
            inputRef.current?.focus()
            return
        }
        locked.current = true; setBusy(true); setError('')
        try { await onDelete() } catch (error) {
            setError(error instanceof Error ? error.message : '삭제하지 못했어요. 다시 시도해 주세요.')
        } finally { locked.current = false; setBusy(false) }
    }

    return createPortal(<dialog ref={dialogRef} aria-labelledby={titleId} aria-describedby={descriptionId}
        onCancel={event => { event.preventDefault(); if (!locked.current) onClose() }}
        className="m-auto w-[calc(100%_-_2rem)] max-w-md max-h-[calc(100dvh_-_2rem)] overflow-y-auto rounded-2xl border border-brand-border bg-brand-surface p-6 text-brand-text shadow-xl backdrop:bg-slate-900/40">
        <form onSubmit={event => { event.preventDefault(); void submit() }} className="space-y-4">
            <h2 id={titleId} className="font-bold text-base">{title}</h2>
            <p id={descriptionId} className="text-sm leading-relaxed text-brand-muted whitespace-pre-line wrap-anywhere">{description}</p>
            {confirmation !== undefined && <div className="space-y-2">
                <label htmlFor={inputId} className="block text-xs font-medium wrap-anywhere">계속하려면 ‘{confirmation}’을 입력해 주세요.</label>
                <input ref={inputRef} id={inputId} value={value} disabled={busy} autoComplete="off" aria-invalid={Boolean(inputError)} aria-describedby={inputError ? errorId : undefined}
                    onChange={event => { setValue(event.target.value); setInputError('') }}
                    className={`w-full rounded-xl border px-3 py-2 text-sm focus:outline-none ${inputError ? 'border-red-300 focus:border-red-300' : 'border-brand-border focus:border-brand-primary'}`} />
                {inputError && <p id={errorId} role="alert" className="text-xs text-red-500">{inputError}</p>}
            </div>}
            {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
            {busy && <p role="status" className="text-xs text-brand-muted">삭제를 처리하고 있어요. 남은 파일이 있으면 먼저 재분석해요.</p>}
            <div className="flex justify-end gap-2">
                <button autoFocus type="button" disabled={busy} onClick={onClose} className="cursor-pointer rounded-xl border border-brand-border px-4 py-2 text-xs font-medium transition-colors enabled:hover:border-slate-300 enabled:hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50">취소</button>
                <button type="submit" disabled={busy} className="cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white transition-colors enabled:hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-red-400 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-50">{busy ? '삭제 중…' : '삭제'}</button>
            </div>
        </form>
    </dialog>, document.body)
}
