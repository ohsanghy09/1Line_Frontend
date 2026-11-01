import { mockFileAnalysisReply, mockNoChangeReply, mockTextAnalysisReply } from './chat'
import { createMockBatchAnalysis } from './batchAnalysis'
import type { ChatReply } from '../../types/chat'

// API 응답 시간을 흉내 내는 목 전용 함수. 파일 업로드나 내용 분석은 하지 않는다.
export async function getMockChatReply(message: string, files: File[]): Promise<ChatReply> {
    if (!message.trim() && files.length === 0) throw new Error('메시지 또는 파일을 추가해주세요.')

    await new Promise<void>((resolve) => setTimeout(resolve, 1300))

    // 다중 파일의 개수, 유형, 버전 관계는 별도 목 분석기로 구성한다.
    if (files.length > 1) return createMockBatchAnalysis(files)

    // 원본의 단일 파일 시나리오는 해당 예시 파일명일 때만 사용한다.
    if (files.length === 1 && files[0].name === 'wireframe_v2.pdf') {
        return { ...mockFileAnalysisReply, id: crypto.randomUUID() }
    }

    if (files.length === 1 && files[0].name === 'presentation_typo_fix.pdf') {
        return { ...mockNoChangeReply, id: crypto.randomUUID() }
    }

    // 실제 선택한 파일명과 개수로 응답을 구성한다. 파일 내용 분석이나 서버 업로드는 수행하지 않는다.
    // 임의의 파일에 레퍼런스의 5개 파일 이름·버전 관계를 그대로 적용하지 않는다.
    if (files.length > 0) {
        const template = mockFileAnalysisReply

        return {
            ...template,
            id: crypto.randomUUID(),
            content: `총 ${files.length}개의 자료를 받았어요.`,
            analysis: {
                activity: { name: '1호선톤', confidence: null },
                materialType: '첨부 자료',
                stage: null,
                summary: '선택한 자료를 1호선톤 활동으로 분류한 예시 결과예요.',
                changes: [],
                files: files.map((file) => ({ name: file.name, materialType: '첨부 자료', previousVersion: null })),
                groups: [{ materialType: '첨부 자료', count: files.length }],
                suggestedSaveMode: 'archive',
            },
        }
    }

    // 현재는 모든 텍스트에 시나리오 1의 고정 답변을 반환한다.
    // 같은 목 응답을 반복해서 받아도 화면에서 구별할 수 있도록 매번 새 ID를 부여한다.
    return { ...mockTextAnalysisReply, id: crypto.randomUUID() }
}
