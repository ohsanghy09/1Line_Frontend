import type { ChatServiceStatus } from '../../types/chat'

// 색상과 조회 상태 문구는 UI가, 준비 상태와 해당 문구는 서비스 응답이 담당한다.
function ChatServiceStatusBadge({ status, hasError }: { status: ChatServiceStatus | null; hasError: boolean }) {
    const state = status?.status ?? (hasError ? 'error' : 'loading')
    const styles = {
        ready: { badge: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
        unavailable: { badge: 'bg-amber-50 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
        loading: { badge: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
        error: { badge: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400' },
    }[state]
    const label = status?.label ?? (hasError ? '상태 확인 실패' : '상태 확인 중')

    return (
        <span role="status" className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${styles.badge}`}>
            <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full mr-1.5 ${styles.dot}`}></span>
            {label}
        </span>
    )
}

export default ChatServiceStatusBadge
