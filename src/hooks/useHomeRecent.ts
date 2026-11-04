import { useEffect, useState } from 'react'
import { getHomeRecent } from '../services/home'
import type { HomeRecent } from '../types/home'

// 홈 진입과 저장/수정 성공 시 목록을 재조회한다. 취소된 이전 응답은 덮어쓰지 못한다.
export function useHomeRecent() {
    const [state, setState] = useState<{ data: HomeRecent | null; loading: boolean; error: string }>({ data: null, loading: true, error: '' })
    const [revision, setRevision] = useState(0)
    useEffect(() => {
        let active = true
        let controller: AbortController | null = null
        let requestId = 0
        async function refresh() {
            controller?.abort()
            const current = new AbortController()
            controller = current
            const id = ++requestId
            setState({ data: null, loading: true, error: '' })
            try {
                const data = await getHomeRecent(current.signal)
                if (active && id === requestId) setState({ data, loading: false, error: '' })
            } catch (error) {
                if (active && id === requestId && !current.signal.aborted) setState({ data: null, loading: false, error: error instanceof Error ? error.message : '최근 목록을 불러오지 못했어요.' })
            }
        }
        const onChange = () => { void refresh() }
        void refresh()
        window.addEventListener('1line:activities-changed', onChange)
        return () => { active = false; controller?.abort(); window.removeEventListener('1line:activities-changed', onChange) }
    }, [revision])
    return { ...state, retry: () => setRevision(value => value + 1) }
}
