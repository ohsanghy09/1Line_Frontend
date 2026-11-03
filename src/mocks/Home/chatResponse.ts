import { mockFileAnalysisProgress, mockFileAnalysisReply, mockNoChangeReply, mockSingleFileAnalysisMode, mockTextAnalysisReply } from './chat'
import { createMockBatchAnalysis } from './batchAnalysis'
import type { ChatProgress, ChatReply } from '../../types/chat'

// 모든 단일 파일: 점 3개(600ms) → 진행 카드(1300ms) → 같은 형식의 결과 카드.
// 파일 내용은 읽지 않는다. 분석은 예시 데이터를 사용하고 실제 선택한 파일명만 보존한다.
async function getMockFileReply(file: File, onProgress?: (progress: ChatProgress) => void): Promise<ChatReply> {
    await new Promise<void>((resolve) => setTimeout(resolve, 600))
    onProgress?.(mockFileAnalysisProgress)
    await new Promise<void>((resolve) => setTimeout(resolve, 1300))

    // API 연결 전에는 목 설정으로 변화 있음/없음을 선택한다. 어떤 파일 이름으로도 확인할 수 있다.
    const template = mockSingleFileAnalysisMode === 'no-change' ? mockNoChangeReply : mockFileAnalysisReply
    const analysis = template.analysis!
    const previousVersion = file.name === analysis.files[0].name ? analysis.files[0].previousVersion : null

    return {
        ...template,
        id: crypto.randomUUID(),
        content: analysis.changes.length === 0 ? template.content : `분석이 끝났어요. ${file.name}`,
        analysis: {
            ...analysis,
            // 임의의 파일을 wireframe_v1.pdf와 연결하거나 고정 파일명을 근거로 표시하지 않는다.
            files: [{ name: file.name, materialType: analysis.materialType, previousVersion }],
            changes: analysis.changes.map((change) => ({
                ...change,
                evidence: previousVersion ? [previousVersion, file.name] : [file.name],
            })),
            groups: [],
        },
    }
}

// API 응답 시간을 흉내 내는 목 전용 함수. 파일 업로드나 내용 분석은 하지 않는다.
export async function getMockChatReply(message: string, files: File[], onProgress?: (progress: ChatProgress) => void): Promise<ChatReply> {
    if (!message.trim() && files.length === 0) throw new Error('메시지 또는 파일을 추가해주세요.')

    // 파일 이름·확장자와 관계없이 한 개면 같은 분석 진행 흐름으로 보낸다.
    if (files.length === 1) {
        return getMockFileReply(files[0], onProgress)
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 1300))

    // 다중 파일의 개수, 유형, 버전 관계는 별도 목 분석기로 구성한다.
    if (files.length > 1) return createMockBatchAnalysis(files)

    // 현재는 모든 텍스트에 시나리오 1의 고정 답변을 반환한다.
    // 같은 목 응답을 반복해서 받아도 화면에서 구별할 수 있도록 매번 새 ID를 부여한다.
    return { ...mockTextAnalysisReply, id: crypto.randomUUID() }
}
