// 서버 ISO 시각은 그대로 두고 홈 최근 활동에서만 브라우저의 현지 날짜로 표시한다.
export function formatRecentActivityTime(value: string, now: number): string {
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return '날짜 확인 불가'

    const today = new Date(now)
    const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
    const sameDay = (other: Date) => date.getFullYear() === other.getFullYear()
        && date.getMonth() === other.getMonth() && date.getDate() === other.getDate()
    const time = () => new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit', hour12: true }).format(date)

    if (sameDay(today)) return time()
    if (sameDay(yesterday)) return `어제 ${time()}`
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}
