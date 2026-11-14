import { useEffect, useRef, useState } from 'react'
import { getActivityAnalysis, retryActivityAnalysis } from '../services/activityAnalysis'
import type { ActivityAnalysis } from '../services/activityAnalysis'
import type { FootprintActivity } from '../types/footprints'

// 저장 결과와 활동 정보 분석 실패를 구분한다. 상태 조회는 모델을 호출하지 않는다.
export default function ActivityAnalysisStatus({ activityId, metadata }: { activityId: string; metadata?: Pick<FootprintActivity, 'summary' | 'status' | 'role' | 'period'> }) {
    const [state, setState] = useState<ActivityAnalysis | null>(null)
    const [error, setError] = useState('')
    const [revision, setRevision] = useState(0)
    const [retrying, setRetrying] = useState(false)
    const sawPending = useRef(false)
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const missing = metadata ? ([['summary', '요약'], ['status', '상태'], ['period', '기간'], ['role', '역할']] as const)
        .filter(([key]) => !metadata[key].trim() || ['미설정', '—', '-'].includes(metadata[key].trim()))
        .map(([, label]) => label) : null

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
        </> : state.status === 'ready' ? <p role="status">{missing === null
            ? '활동 정보 분석을 마쳤어요. 항목별 확인 결과는 활동 상세에서 확인해 주세요.'
            : missing.length > 0 ? `활동 정보 분석을 마쳤어요. ${missing.join('·')} 항목은 아직 미설정이에요.`
                : '활동 정보 분석을 마쳤어요. 요약·상태·기간·역할이 등록되어 있어요.'}</p> : null}
    </div>
}
