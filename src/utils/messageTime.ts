// 사용자의 현지 날짜를 기준으로 상대 시간 또는 전송 시각을 표시한다.
export function formatMessageTime(createdAt: number, now: number): string {
    const elapsedMinutes = Math.floor(Math.max(0, now - createdAt) / 60_000)
    if (elapsedMinutes < 1) return '방금 전'
    if (elapsedMinutes < 60) return `${elapsedMinutes}분 전`

    const sentAt = new Date(createdAt)
    const currentDate = new Date(now)
    // 실행 환경의 언어 데이터에 관계없이 오전/오후 표기를 일정하게 유지한다.
    const hours = sentAt.getHours()
    const clock = `${hours < 12 ? '오전' : '오후'} ${hours % 12 || 12}:${String(sentAt.getMinutes()).padStart(2, '0')}`

    if (sentAt.toDateString() === currentDate.toDateString()) return clock

    // 연도가 다른 메시지도 날짜를 혼동하지 않도록 연도를 함께 표시한다.
    const year = sentAt.getFullYear() !== currentDate.getFullYear() ? `${sentAt.getFullYear()}년 ` : ''
    return `${year}${sentAt.getMonth() + 1}월 ${sentAt.getDate()}일 ${clock}`
}
