import { getMockChatReply } from '../mocks/Home/chatResponse'
import { getMockChatServiceStatus } from '../mocks/Home/chatStatus'
import type { ChatProgress, ChatReply, ChatServiceStatus } from '../types/chat'

// Home은 이 함수만 호출하고 목 응답 생성 방법이나 API 주소를 알 필요가 없다.
// 실제 연결 시 내부를 API 호출로 교체하고 Promise<ChatReply> 형태를 유지한다.
// 파일 요청은 FormData에 message와 각 File을 담아 보내도록 서버 명세와 협의한다.
export async function getChatReply(message: string, files: File[] = [], onProgress?: (progress: ChatProgress) => void): Promise<ChatReply> {
    return getMockChatReply(message, files, onProgress)
}

// 실제 API 연결 시 내부 조회만 교체한다. API 주소와 응답 구조는 아직 미확정이다.
export async function getChatServiceStatus(): Promise<ChatServiceStatus> {
    return getMockChatServiceStatus()
}
