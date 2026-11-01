// 사용자 메시지와 AI 답변을 하나의 배열에 담아 대화 순서대로 표시한다.
// File 객체는 전송용으로 별도 보관하고, 말풍선에는 파일명 등의 표시 정보만 저장한다.
export type ChatAttachment = {
    id: string
    name: string
    size: number
}

export type UserMessage = {
    id: string
    role: 'user'
    content: string
    attachments?: ChatAttachment[]
}

export type ChatMessage = UserMessage | ChatReply

// 화면에서 일반 말풍선 또는 종류별 분석 카드를 선택할 때 사용한다.
export type ChatReplyKind = 'greeting' | 'general' | 'text-analysis' | 'file-analysis' | 'no-change' | 'batch-analysis' | 'link-analysis'

// AI가 기존 기록과 비교해서 발견한 변화 정보
export type ChatChange = {
    before: string
    after: string
    // 예: 기능 범위 변경, 메인 입력 UX 변경
    category: string
    // 변화 판단의 근거가 된 사용자 기록 또는 자료 이름
    evidence: string[]
}

// AI가 특정 파일을 어떤 자료로 분류했는지 나타내는 정보
export type AnalyzedFile = {
    name: string
    materialType: string
    // 이전 버전 파일이 있을 때만 이름을 전달한다.
    previousVersion: string | null
}

// 실제 API 응답 형식을 협의하기 전 사용하는 임시 데이터 구조.
// HTML이나 JSX 대신 값만 전달하므로 목데이터와 API 응답에 같은 화면을 사용할 수 있다.
export type ChatReply = {
    id: string
    role: 'assistant'
    kind: ChatReplyKind

    // AI 말풍선 또는 분석 카드 상단에 표시할 답변 문구
    content: string

    // 일반 인사처럼 분석이 없는 응답에서는 null이다.
    analysis: {
        activity: {
            name: string
            // 레퍼런스에서 확신도를 제공한 경우에만 값을 넣는다.
            confidence: 'high' | 'medium' | 'low' | null
        }
        materialType: string
        stage: string | null
        summary: string

        // 중요 변화가 없으면 빈 배열. 오탈자 수정도 여기에 억지로 추가하지 않는다.
        changes: ChatChange[]
        files: AnalyzedFile[]

        // 일괄 업로드 결과의 자료 유형별 개수. 그 외 응답은 빈 배열이다.
        groups: { materialType: string; count: number }[]

        // 저장 버튼을 누르면 적용할 방식에 대한 제안이며, 저장 완료를 의미하지 않는다.
        suggestedSaveMode: 'record-change' | 'version-only' | 'archive'
    } | null
}
