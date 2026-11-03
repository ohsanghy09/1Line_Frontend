import type { ChatServiceStatus } from '../../types/chat'

// 헤더 상태 배지의 목 응답. 실제 AI 서버의 연결 상태를 확인한 결과는 아니다.
export const mockChatServiceStatus: ChatServiceStatus = {
    status: 'ready',
    label: '기록 정리 준비됨',
}

// 화면은 목 응답을 직접 읽지 않고 서비스 경계를 통해 조회한다.
export async function getMockChatServiceStatus(): Promise<ChatServiceStatus> {
    return { ...mockChatServiceStatus }
}
