import { getMockChatReply } from '../mocks/Home/chatResponse'
import type { ChatReply } from '../types/chat'

// Home은 이 함수만 호출하고 목 응답 생성 방법이나 API 주소를 알 필요가 없다.
// 실제 연결 시 내부를 API 호출로 교체하고 Promise<ChatReply> 형태를 유지한다.
// 파일 요청은 FormData에 message와 각 File을 담아 보내도록 서버 명세와 협의한다.
export async function getChatReply(message: string, files: File[] = []): Promise<ChatReply> {
    return getMockChatReply(message, files)
}
