import type { ChatMessage } from '../types/chat'
import { isReply } from '../services/chat'

export const CHAT_SESSION_KEY = '1line.home-chat.v1'
export type PendingChatJob = { jobId: string; userMessageId: string }
export type ChatSession = {
    version: 1
    conversationId: string
    greetingCreatedAt: number
    messages: ChatMessage[]
    pending: boolean
    pendingJob?: PendingChatJob | null
}

// 브라우저 저장값도 외부 입력처럼 검사한다. 손상된 값은 화면에 렌더링하지 않는다.
export function readChatSession(): ChatSession | null {
    try {
        const raw = window.sessionStorage.getItem(CHAT_SESSION_KEY)
        if (!raw) return null
        const data: unknown = JSON.parse(raw)
        if (!data || typeof data !== 'object') return null
        const value = data as Record<string, unknown>
        if (value.version !== 1 || typeof value.conversationId !== 'string' || !value.conversationId || typeof value.greetingCreatedAt !== 'number' || !Number.isFinite(value.greetingCreatedAt) || typeof value.pending !== 'boolean' || !Array.isArray(value.messages)) return null
        const ids = new Set<string>()
        for (const message of value.messages) {
            if (!message || typeof message !== 'object' || typeof message.id !== 'string' || ids.has(message.id) || typeof message.content !== 'string' || !Number.isFinite(message.createdAt)) return null
            ids.add(message.id)
            if (message.role === 'assistant') {
                if (!isReply(message)) return null
                for (const field of ['analysisId', 'conversationId', 'recordId', 'activityId'] as const) {
                    if (message[field] !== undefined && typeof message[field] !== 'string') return null
                }
            } else if (message.role === 'user') {
                if (message.attachments !== undefined && (!Array.isArray(message.attachments) || !message.attachments.every((file: unknown) => {
                    if (!file || typeof file !== 'object') return false
                    const attachment = file as Record<string, unknown>
                    return typeof attachment.id === 'string' && typeof attachment.name === 'string' && typeof attachment.size === 'number' && Number.isFinite(attachment.size) && attachment.size >= 0
                }))) return null
            } else return null
        }
        if (value.pendingJob !== undefined && value.pendingJob !== null) {
            const job = value.pendingJob as Record<string, unknown>
            if (typeof job !== 'object' || typeof job.jobId !== 'string' || !job.jobId || typeof job.userMessageId !== 'string' || !value.messages.some(message => message.role === 'user' && message.id === job.userMessageId)) return null
        }
        return value as ChatSession
    } catch {
        // 저장소 접근이 제한되거나 JSON이 손상되어도 채팅을 계속 사용할 수 있다.
        return null
    }
}

// 조회 재개나 완료 결과 재조회 시에도 같은 분석 카드는 한 번만 추가한다.
export function appendChatReply(messages: ChatMessage[], reply: ChatMessage): ChatMessage[] {
    if (reply.role !== 'assistant') return messages
    if (messages.some(message => message.id === reply.id || (message.role === 'assistant' && reply.analysisId && message.analysisId === reply.analysisId))) return messages
    return [...messages, reply]
}

export function writeChatSession(session: ChatSession): boolean {
    try {
        window.sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(session))
        return true
    } catch {
        return false
    }
}
