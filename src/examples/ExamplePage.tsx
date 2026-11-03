import { useState } from 'react'
import { Link } from 'react-router'
import ChatReplyCard from '../components/ChatReplyCard'
import FileAnalysisProgress from '../components/FileAnalysisProgress'
import ChatServiceStatusBadge from '../components/ChatServiceStatusBadge'
import { mockBatchAnalysisReply, mockFileAnalysisProgress, mockFileAnalysisReply, mockNoChangeReply, mockTextAnalysisReply } from '../mocks/Home/chat'
import { mockChatServiceStatus } from '../mocks/Home/chatStatus'
import type { ChatReply } from '../types/chat'

// 홈에서 쓰는 목 응답과 실제 카드 컴포넌트를 재사용하여 수정 결과를 같은 화면에서 비교한다.
const cardExamples: {
    title: string
    description: string
    reply: ChatReply
    source: string
    buttons: { label: string; behavior: string }[]
}[] = [
    {
        title: '텍스트 경험 분석',
        description: '활동 분류·확신도·Before/After·변화 근거를 표시하는 카드입니다.',
        reply: mockTextAnalysisReply,
        source: 'ChatReplyCard.tsx',
        buttons: [
            { label: '1호선톤에 기록', behavior: '비활성 · 기록 저장 미연결' },
            { label: '수정', behavior: '비활성 · 분류 수정 미연결' },
            { label: '다른 활동 선택', behavior: '비활성 · 활동 변경 미연결' },
        ],
    },
    {
        title: '단일 파일 분석 · 변화 있음',
        description: '파일 정보·AI 요약·새로운 변화와 전후 비교를 표시하는 카드입니다.',
        reply: mockFileAnalysisReply,
        source: 'FileAnalysisContent.tsx',
        buttons: [
            { label: '저장', behavior: '비활성 · 저장 미연결' },
            { label: '수정', behavior: '비활성 · 분류 수정 미연결' },
        ],
    },
    {
        title: '단일 파일 분석 · 변화 없음',
        description: '변화 없음 안내와 사유를 표시하며 Before/After를 만들지 않는 카드입니다.',
        reply: mockNoChangeReply,
        source: 'NoChangeAnalysisContent.tsx',
        buttons: [
            { label: '아카이브 저장', behavior: '비활성 · 아카이브 저장 미연결' },
            { label: '수정', behavior: '비활성 · 분류 수정 미연결' },
        ],
    },
    {
        title: '다중 파일 분석',
        description: '자료 유형별 개수와 파일의 버전 관계를 요약하는 카드입니다.',
        reply: mockBatchAnalysisReply,
        source: 'BatchAnalysisContent.tsx',
        buttons: [
            { label: '전체 저장', behavior: '비활성 · 일괄 저장 미연결' },
            { label: '자료 확인', behavior: '클릭 시 /archive로 이동 · 자료 저장은 하지 않음' },
        ],
    },
]

function ExamplePage() {
    // 카드 비교 중 시간만 달라지지 않도록 페이지를 연 시각을 미리보기 기준으로 고정한다.
    const [previewTime] = useState(() => Date.now())

    return (
        <main className="min-h-screen bg-brand-bg text-brand-text p-4 sm:p-6 lg:p-8">
            <div className="max-w-[1400px] mx-auto space-y-6">
                <header className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-2">
                        <p className="text-xs font-semibold text-brand-primary">컴포넌트 미리보기 · /example</p>
                        <h1 className="text-2xl font-bold tracking-tight">채팅 카드 모음</h1>
                        <p className="text-sm text-brand-muted">홈과 같은 컴포넌트로 카드·버튼·목 응답을 확인할 수 있습니다.</p>
                    </div>
                    <Link to="/" className="px-4 py-2 text-sm font-medium bg-white border border-brand-border rounded-xl hover:border-brand-primary">홈으로 돌아가기</Link>
                </header>

                <div className="bg-white border border-brand-border rounded-xl px-4 py-3 text-sm text-brand-muted leading-relaxed">
                    분석 내용은 모두 목데이터입니다. 저장·수정·활동 선택은 아직 연결되지 않아 실제 채팅과 동일하게 비활성입니다.
                    현재 홈의 단일 파일 목 모드와 관계없이 이 페이지에서는 변화 있음·없음을 함께 표시합니다.
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                    {cardExamples.map((example, index) => (
                        <section key={example.reply.id} aria-labelledby={`card-example-${example.reply.id}`} className="min-w-0 bg-white border border-brand-border rounded-2xl overflow-hidden">
                            <div className="p-5 border-b border-brand-border space-y-2">
                                <h2 id={`card-example-${example.reply.id}`} className="font-bold text-base">{index + 1}. {example.title}</h2>
                                <p className="text-xs text-brand-muted leading-relaxed">{example.description}</p>
                                <p className="text-[11px] text-brand-muted">본문 컴포넌트: <code>{example.source}</code></p>
                            </div>

                            {/* 별도 복제한 디자인이 아니라 실제 홈 카드이므로 공통 컴포넌트 수정이 즉시 반영된다. */}
                            <div className="p-4 sm:p-5 bg-brand-bg">
                                <ChatReplyCard reply={{ ...example.reply, createdAt: previewTime }} now={previewTime} />
                            </div>

                            <div className="p-5 space-y-4">
                                <div className="space-y-2">
                                    <h3 className="text-xs font-semibold">버튼 동작</h3>
                                    <ul className="space-y-2 text-xs">
                                        {example.buttons.map((button) => (
                                            <li key={button.label} className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                                                <span className="font-medium">{button.label}</span>
                                                <span className="text-brand-muted">{button.behavior}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                <details className="border border-brand-border rounded-xl overflow-hidden">
                                    <summary className="px-3 py-2.5 text-xs font-medium cursor-pointer hover:bg-slate-50">이 카드의 응답 데이터 보기</summary>
                                    <pre className="p-3 text-[11px] leading-relaxed bg-slate-50 border-t border-brand-border whitespace-pre-wrap break-all max-h-96 overflow-y-auto">{JSON.stringify(example.reply, null, 2)}</pre>
                                </details>
                            </div>
                        </section>
                    ))}
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                    <section className="min-w-0 bg-white border border-brand-border rounded-2xl p-5 space-y-4" aria-labelledby="file-progress-example">
                        <div className="space-y-2">
                            <h2 id="file-progress-example" className="font-bold text-base">5. 파일 분석 진행</h2>
                            <p className="text-xs text-brand-muted">현재 목 진행 상태 한 장면입니다. 홈에서는 분석 결과 카드가 나오면 사라집니다.</p>
                        </div>
                        <div className="bg-brand-bg rounded-xl p-4">
                            <FileAnalysisProgress progress={mockFileAnalysisProgress} />
                        </div>
                        <details className="border border-brand-border rounded-xl overflow-hidden">
                            <summary className="px-3 py-2.5 text-xs font-medium cursor-pointer hover:bg-slate-50">진행 데이터 보기</summary>
                            <pre className="p-3 text-[11px] bg-slate-50 border-t border-brand-border whitespace-pre-wrap break-all">{JSON.stringify(mockFileAnalysisProgress, null, 2)}</pre>
                        </details>
                    </section>

                    <section className="min-w-0 bg-white border border-brand-border rounded-2xl p-5 space-y-4" aria-labelledby="service-status-example">
                        <div className="space-y-2">
                            <h2 id="service-status-example" className="font-bold text-base">6. 채팅 준비 상태</h2>
                            <p className="text-xs text-brand-muted">헤더 배지의 준비됨·사용 불가·조회 중·조회 실패 모습을 비교합니다.</p>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            <ChatServiceStatusBadge status={mockChatServiceStatus} hasError={false} />
                            <ChatServiceStatusBadge status={{ status: 'unavailable', label: '일시적으로 사용할 수 없어요' }} hasError={false} />
                            <ChatServiceStatusBadge status={null} hasError={false} />
                            <ChatServiceStatusBadge status={null} hasError />
                        </div>
                    </section>
                </div>
            </div>
        </main>
    )
}

export default ExamplePage
