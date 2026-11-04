import { formatMessageTime } from '../../utils/messageTime'

// 화면에는 간단한 시간을, 마우스를 올리면 정확한 날짜와 시각을 제공한다.
function ChatMessageTime({ createdAt, now }: { createdAt: number; now: number }) {
    const sentAt = new Date(createdAt)

    return (
        <time dateTime={sentAt.toISOString()} title={sentAt.toLocaleString('ko-KR')}>
            {formatMessageTime(createdAt, now)}
        </time>
    )
}

export default ChatMessageTime
