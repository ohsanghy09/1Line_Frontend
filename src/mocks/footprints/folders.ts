import type { FootprintFolder } from '../../types/footprints'

// 원본 HTML에 실제로 존재하는 폴더와 파일만 옮겼다.
// 폴더별 표시 총계를 맞추기 위해 예시 파일을 추가하지 않는다.
export const mockFootprintFolders: Record<string, FootprintFolder[]> = {
    'line1-hackathon': [
        {
            id: 'line1-planning', name: '기획', materialsCount: 4,
            files: [
                { id: 'line1-idea-candidates', name: 'idea_candidates.pdf', type: '아이디어 기획', uploadedAtLabel: '10/23', summary: '초기 후보 서비스 아이디어 3종 정리문서' },
                { id: 'line1-service-planning-v1', name: 'service_planning_v1.pdf', type: '기획안', uploadedAtLabel: '10/25', summary: '기능 6개가 포함된 초기 상세 기획안' },
                { id: 'line1-service-planning-final', name: 'service_planning_final.pdf', type: '기획안', uploadedAtLabel: '10/26', summary: '핵심 기능 3개로 축소 및 AI 강조 기획안' },
                { id: 'line1-feature-spec', name: 'feature_spec.pdf', type: '기능 명세', uploadedAtLabel: '10/27', summary: '상세 기능 목록 및 AI 프롬프트 파이프라인 명세' },
            ],
        },
        {
            id: 'line1-design', name: '디자인', materialsCount: 3,
            files: [
                { id: 'line1-wireframe-v1', name: 'wireframe_v1.pdf', type: '디자인 · 와이어프레임', uploadedAtLabel: '10/25', summary: '대시보드 중심의 초기 화면 와이어프레임', version: 'v1' },
                { id: 'line1-wireframe-v2', name: 'wireframe_v2.pdf', type: '디자인 · 와이어프레임', uploadedAtLabel: '10/26', summary: 'Growth Journey 및 Growth AI 메인 인터페이스 구체화', version: 'v2' },
                { id: 'line1-final-ui', name: 'final_ui.fig', type: '디자인 · 피그마', uploadedAtLabel: '11/08', summary: '최종 배포용 컴포넌트 시스템 및 완성 UI', version: 'final' },
            ],
        },
        {
            id: 'line1-collaboration', name: '협업', materialsCount: 2,
            files: [
                { id: 'line1-meeting-1026', name: 'meeting_1026.docx', type: '회의록', uploadedAtLabel: '10/26', summary: '기능 범위 축소 및 챗봇 우선순위 합의 회의' },
                { id: 'line1-team-feedback', name: 'team_feedback.pdf', type: '멘토링 피드백', uploadedAtLabel: '10/28', summary: 'AI 근거 제시 UI 명확화에 관한 피드백' },
            ],
        },
        {
            id: 'line1-development', name: '개발', materialsCount: 3,
            files: [
                { id: 'line1-architecture', name: 'architecture.png', type: '시스템 구조도', uploadedAtLabel: '10/27', summary: '클라이언트 단일 실행 구조 및 AI Mock 파이프라인' },
            ],
        },
        {
            id: 'line1-results', name: '발표 / 결과', materialsCount: 2,
            files: [
                { id: 'line1-presentation-typo-fix', name: 'presentation_typo_fix.pdf', type: '발표자료', uploadedAtLabel: '10/29', summary: '1호선톤 발표자료 오탈자 수정본' },
            ],
        },
    ],
    'computer-vision': [
        {
            id: 'computer-vision-lectures', name: '강의자료', materialsCount: 5,
            files: [
                { id: 'computer-vision-segmentation', name: 'segmentation.pdf', type: '강의노트', uploadedAtLabel: '10/25', summary: 'Semantic Segmentation 및 U-Net 구조 정리' },
            ],
        },
    ],
    'scent-orbit': [],
    'data-vis': [],
    'ai-contest': [],
    'cvis-learning': [],
}
