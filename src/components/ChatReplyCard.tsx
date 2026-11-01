import { FileText, FolderGit2, Sparkles } from 'lucide-react'
import type { ChatReply } from '../types/chat'
import BatchAnalysisContent from './BatchAnalysisContent'

// API 또는 목데이터로 받은 값을 카드로 표시하는 컴포넌트
function ChatReplyCard({ reply }: { reply: ChatReply }) {
    const analysis = reply.analysis
    const isBatchAnalysis = reply.kind === 'batch-analysis'
    const confidenceLabels = { high: '높음', medium: '보통', low: '낮음' }

    return (
        <div className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
            </div>

            {/* 다중 파일 카드는 전체 내용에 맞춰 늘어나며, 최대 28rem과 채팅 영역 너비 안에서 줄바꿈한다. */}
            <div className={`min-w-0 space-y-2 ${isBatchAnalysis ? 'w-fit max-w-[min(28rem,calc(100%-2.75rem))]' : 'max-w-[90%] sm:max-w-[85%]'}`}>
                <div className="bg-white border border-brand-border shadow-soft p-4 rounded-2xl rounded-tl-sm text-sm text-brand-text space-y-3 break-words">

                    {isBatchAnalysis ? <BatchAnalysisContent reply={reply} /> : (
                        <>

                    {/* AI가 연결한 활동과 분류 확신도 */}
                    {analysis && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold text-brand-primary flex items-center gap-1.5">
                                <FolderGit2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                                {analysis.activity.name} 활동 기록
                            </span>

                            {analysis.activity.confidence && (
                                <span className="text-[11px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                    확신도 {confidenceLabels[analysis.activity.confidence]}
                                </span>
                            )}
                        </div>
                    )}

                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{reply.content}</p>

                    {/* 파일 응답은 실제 첨부 이름과 유형별 개수를 함께 표시한다. */}
                    {!!analysis?.files.length && (
                        <div className="p-3 bg-slate-50 rounded-xl border border-brand-border text-xs space-y-3">
                            <p className="text-brand-muted leading-relaxed">{analysis.summary}</p>

                            {analysis.groups.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                                    {analysis.groups.map((group) => (
                                        <span key={group.materialType} className="bg-white border border-brand-border px-2 py-1 rounded-lg">
                                            {group.materialType} <strong>{group.count}개</strong>
                                        </span>
                                    ))}
                                </div>
                            )}

                            <ul className="space-y-2">
                                {analysis.files.map((file, index) => (
                                    <li key={index} className="flex items-start gap-2">
                                        <FileText className="w-4 h-4 text-brand-primary shrink-0" aria-hidden="true" />
                                        <div className="min-w-0">
                                            <p className="break-all font-medium">{file.name}</p>
                                            <p className="text-brand-muted">{file.materialType}</p>
                                            {file.previousVersion && <p className="text-brand-primary break-all">버전 연결: {file.previousVersion} → {file.name}</p>}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* 변화가 있는 경우에만 Before/After와 판단 근거 표시 */}
                    {analysis?.changes.map((change, index) => (
                        <div key={index} className="space-y-3">
                            <div className="grid grid-cols-2 gap-2 p-3 bg-slate-50 rounded-xl border border-brand-border text-xs">
                                <div className="min-w-0 space-y-1">
                                    <span className="text-[10px] font-bold text-brand-muted block">Before</span>
                                    <p className="font-medium text-slate-700">{change.before}</p>
                                </div>

                                <div className="min-w-0 space-y-1 border-l border-brand-border pl-2.5">
                                    <span className="text-[10px] font-bold text-brand-primary block">After</span>
                                    <p className="font-bold text-brand-primary">{change.after}</p>
                                </div>
                            </div>

                            <div className="space-y-1 text-xs text-brand-muted">
                                <p>· <strong>변화 유형:</strong> {change.category}</p>
                                <p>· <strong>근거:</strong> {change.evidence.join(', ')}</p>
                            </div>
                        </div>
                    ))}

                    {/* 현재 단계는 응답 표시까지 구현. 저장·수정 기능 연결 전에는 비활성화한다. */}
                    {analysis && (
                        <div className="pt-1 flex flex-wrap items-center gap-2">
                            <button type="button" disabled title="저장 기능 준비 중" className="px-3 py-1.5 bg-brand-primary text-white rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                                {analysis.activity.name}에 기록
                            </button>
                            <button type="button" disabled title="수정 기능 준비 중" className="px-3 py-1.5 border border-brand-border rounded-lg text-xs disabled:opacity-50 disabled:cursor-not-allowed">수정</button>
                            <button type="button" disabled title="활동 선택 기능 준비 중" className="px-3 py-1.5 text-brand-muted text-xs disabled:opacity-50 disabled:cursor-not-allowed">다른 활동 선택</button>
                        </div>
                    )}
                        </>
                    )}
                </div>

                <p className="text-[10px] text-brand-muted pl-1">
                    {isBatchAnalysis ? '방금 전 · Growth AI 분석 완료' : 'Growth AI · 목 응답'}
                </p>
            </div>
        </div>
    )
}

export default ChatReplyCard
