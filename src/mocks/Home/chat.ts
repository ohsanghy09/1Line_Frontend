import type { ChatReply } from '../../types/chat'

// 레퍼런스 HTML의 AI 채팅 응답을 데이터로 옮긴 파일.
// 텍스트 분석 응답은 채팅 화면에 연결했으며 실제 AI 분석이나 저장 요청을 수행하지 않는다.
// 버튼, 아이콘, 색상, 로딩 시간은 API 답변이 아닌 화면의 역할이므로 포함하지 않는다.


// 1. 초기 인사: 대화가 처음 열렸을 때 표시할 AI 메시지
export const mockGreetingReply: ChatReply = {
    id: 'mock-greeting',
    role: 'assistant',
    kind: 'greeting',
    content: '안녕하세요! 오늘 만든 자료나 기록하고 싶은 경험을 남겨주세요.\n어떤 활동인지 제가 먼저 확인하고 기존 기록과 연결해볼게요.',
    analysis: null,
}


// 2. 일반 대화: 특정 분석 시나리오에 해당하지 않는 입력에 사용할 예시 답변.
// 입력과 관계없이 저장됐다고 안내하지 않도록, 레퍼런스의 일반 답변을 후속 질문으로 조정했다.
export const mockGeneralReply: ChatReply = {
    id: 'mock-general',
    role: 'assistant',
    kind: 'general',
    content: '어떤 활동에서 있었던 일인지 알려주실래요? 기존 기록과 연결해서 정리해볼게요.',
    analysis: null,
}


// 시나리오 1: "오늘 회의에서 기능 6개를 3개 핵심 기능으로 줄였어." 입력 후의 분석 결과.
// 활동 분류, 확신도, Before/After와 판단 근거를 표시하는 데 사용한다.
export const mockTextAnalysisReply: ChatReply = {
    id: 'mock-text-analysis',
    role: 'assistant',
    kind: 'text-analysis',
    content: '1호선톤 활동 기록으로 보이네요. 기존 기획 기록과 비교했을 때 기능 범위를 축소한 중요한 변화가 확인됐어요.',
    analysis: {
        activity: { name: '1호선톤', confidence: 'high' },
        materialType: '사용자 경험 기록',
        stage: null,
        summary: '회의 피드백을 바탕으로 기능 6개를 핵심 기능 3개로 줄였어요.',
        changes: [{
            before: '기능 6개',
            after: '핵심 기능 3개',
            category: '기능 범위 변경 (MVP 최적화)',
            evidence: ['사용자 직접 기록'],
        }],
        files: [],
        groups: [],
        suggestedSaveMode: 'record-change',
    },
}


// 시나리오 2: wireframe_v2.pdf를 업로드했을 때의 분석 완료 결과.
// 이전 파일과의 버전 관계, 자료 분류, 발견된 UX 변화를 표시한다.
export const mockFileAnalysisReply: ChatReply = {
    id: 'mock-file-analysis',
    role: 'assistant',
    kind: 'file-analysis',
    content: '분석이 끝났어요. wireframe_v2.pdf에서 새로운 변화 1개를 발견했어요.',
    analysis: {
        activity: { name: '1호선톤', confidence: null },
        materialType: '디자인 · 와이어프레임',
        stage: '진행 중',
        summary: 'Growth Journey와 메인 AI 기록 인터페이스를 구체화한 와이어프레임이에요.',
        changes: [{
            before: '파일 업로드 영역 중심 대시보드',
            after: 'Growth AI 챗봇 + 파일 업로드 통합',
            category: '메인 입력 UX 변경',
            evidence: ['wireframe_v1.pdf', 'wireframe_v2.pdf'],
        }],
        files: [{ name: 'wireframe_v2.pdf', materialType: '와이어프레임', previousVersion: 'wireframe_v1.pdf' }],
        groups: [],
        suggestedSaveMode: 'record-change',
    },
}


// 시나리오 3: 오탈자만 수정한 발표자료의 분석 결과.
// changes가 비어 있으므로 변화 카드를 만들지 않고 버전 업데이트를 제안한다.
export const mockNoChangeReply: ChatReply = {
    id: 'mock-no-change',
    role: 'assistant',
    kind: 'no-change',
    content: '1호선톤 발표자료의 수정본으로 정리했어요. 이번 자료에서는 새로운 주요 변화가 발견되지 않았어요.',
    analysis: {
        activity: { name: '1호선톤', confidence: null },
        materialType: '발표자료',
        stage: null,
        summary: '오탈자 텍스트 수정 사항만 확인되어 별도의 Turning Point 생성 없이 아카이브에 버전 업데이트를 제안해요.',
        changes: [],
        files: [{ name: 'presentation_typo_fix.pdf', materialType: '발표자료', previousVersion: null }],
        groups: [],
        suggestedSaveMode: 'version-only',
    },
}


// 시나리오 4: 파일 5개를 일괄 업로드했을 때의 그룹화 결과.
// 유형별 개수와 파일 간 버전 관계를 보여주며, 자료 비교만으로 주요 변화를 임의 생성하지 않는다.
export const mockBatchAnalysisReply: ChatReply = {
    id: 'mock-batch-analysis',
    role: 'assistant',
    kind: 'batch-analysis',
    content: '총 5개의 자료를 확인 후 일괄 그룹화했어요.',
    analysis: {
        activity: { name: '1호선톤', confidence: null },
        materialType: '여러 자료',
        stage: null,
        summary: '기획안과 와이어프레임에서 각각 버전(v1 → v2/final) 연관 관계를 자동으로 연동했습니다.',
        changes: [],
        files: [
            { name: 'idea_v1.pdf', materialType: '기획안', previousVersion: null },
            { name: 'idea_final.pdf', materialType: '기획안', previousVersion: 'idea_v1.pdf' },
            { name: 'wireframe_v1.pdf', materialType: '와이어프레임', previousVersion: null },
            { name: 'wireframe_v2.pdf', materialType: '와이어프레임', previousVersion: 'wireframe_v1.pdf' },
            { name: 'meeting.docx', materialType: '회의록', previousVersion: null },
        ],
        groups: [
            { materialType: '기획안', count: 2 },
            { materialType: '와이어프레임', count: 2 },
            { materialType: '회의록', count: 1 },
        ],
        suggestedSaveMode: 'archive',
    },
}


// 시나리오 5: 링크 내용을 읽은 뒤 활동과 자료 유형을 분류한 결과.
// 링크 주소는 사용자가 보내는 요청 데이터이므로 이 AI 응답 예시에는 고정 주소를 넣지 않는다.
export const mockLinkAnalysisReply: ChatReply = {
    id: 'mock-link-analysis',
    role: 'assistant',
    kind: 'link-analysis',
    content: '링크 내용을 성공적으로 확인했어요.',
    analysis: {
        activity: { name: '1호선톤', confidence: null },
        materialType: 'AI 대화 기록 / 기획 리포지토리',
        stage: null,
        summary: '서비스 후보 선정부터 Growth Archive 상세기획까지 이어진 기획 대화 및 코드 기록입니다.',
        changes: [],
        files: [],
        groups: [],
        suggestedSaveMode: 'archive',
    },
}
