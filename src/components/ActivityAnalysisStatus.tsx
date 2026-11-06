import { useEffect, useRef, useState } from 'react'
import { getActivityAnalysis, retryActivityAnalysis } from '../services/activityAnalysis'
import type { ActivityAnalysis } from '../services/activityAnalysis'

// 저장 결과와 활동 정보 분석 실패를 구분한다. 상태 조회는 모델을 호출하지 않는다.
export default function ActivityAnalysisStatus({ activityId }: { activityId: string }) {
    const [state, setState] = useState<ActivityAnalysis | null>(null)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    const [retrying, setRetrying] = useState(false)
    const sawPending = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    useEffect(() => {
        const refresh = () => setRevision(value => value + 1)
        window.addEventListener('1line:records-changed', refresh)
        return () => window.removeEventListener('1line:records-changed', refresh)
    }, [])

    useEffect(() => {
        const controller = new AbortController()
        sawPending.current = false
        async function refresh() {
            try {
                const result = await getActivityAnalysis(activityId, controller.signal)
                if (controller.signal.aborted) return
                setState(result); setError('')
                if (result.status === 'queued' || result.status === 'running') {
                    sawPending.current = true
                    timer.current = setTimeout(() => { void refresh() }, 1500)
                } else if (sawPending.current || result.status === 'ready') {
                    window.dispatchEvent(new Event('1line:activities-changed'))
                }
            } catch (error) {
                if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '상태를 확인하지 못했어요.')
            }
        }
        void refresh()
        return () => { controller.abort(); clearTimeout(timer.current) }
    }, [activityId, revision])

    async function retry() {
        if (retrying) return
        setRetrying(true); setError('')
        try {
            await retryActivityAnalysis(activityId)
            setState(null); setRevision(value => value + 1)
        } catch (error) {
            setError(error instanceof Error ? error.message : '분석을 접수하지 못했어요.')
        } finally { setRetrying(false) }
    }

    return <div className="space-y-1 text-xs text-brand-muted">
        {error ? <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => setRevision(value => value + 1)} className="text-brand-primary hover:underline">상태 다시 확인</button>
        </> : !state || retrying || state.status === 'queued' || state.status === 'running' ? (
            <p role="status">활동 정보를 정리하고 있어요.</p>
        ) : state.status === 'failed' || state.stale ? <>
            <p role="status">{state.error ?? '활동 정보에 최신 자료를 반영할 수 있어요.'}</p>
            <button type="button" disabled={retrying} onClick={() => { void retry() }} className="text-brand-primary hover:underline disabled:opacity-50">활동 정보 다시 분석</button>
        </> : state.status === 'ready' ? <p role="status">AI가 활동 전체 요약·상태·기간·역할을 확인했어요.</p> : null}
    </div>
}
