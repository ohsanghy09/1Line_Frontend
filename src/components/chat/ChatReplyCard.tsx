import { FileText, FolderGit2, Sparkles } from 'lucide-react'
import type { ChatReply } from '../../types/chat'
import BatchAnalysisContent from './BatchAnalysisContent'
import ChatMessageTime from './ChatMessageTime'
import FileAnalysisContent from './FileAnalysisContent'
import NoChangeAnalysisContent from './NoChangeAnalysisContent'
import RecordButtons from './RecordButtons'
import type { RecordActions } from './RecordButtons'
import type { ReactNode } from 'react'

// 서비스 응답과 복원한 카드 데이터를 표시한다.
function ChatReplyCard({ reply, now, actions, activityActions }: { reply: ChatReply & { createdAt: number }; now: number; actions?: RecordActions; activityActions?: ReactNode }) {
    const analysis = reply.analysis
    const isBatchAnalysis = reply.kind === 'batch-analysis'
    const needsActivityConfirmation = analysis?.activity.match === 'new' || analysis?.activity.match === 'unresolved'
    const isSingleFileAnalysis = (reply.kind === 'file-analysis' || reply.kind === 'no-change') && analysis?.files.length === 1
    // 파일명이 아닌 응답의 변화 배열로 선택한다. API가 file-analysis로 보내도 처리한다.
    const isNoChangeAnalysis = isSingleFileAnalysis && analysis?.changes.length === 0
    const confidenceLabels = { high: '높음', medium: '보통', low: '낮음' }

    return (
        <div className="flex gap-3">
            <div className="w-8 h-8 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" aria-hidden="true" />
            </div>

            {/* 모든 결과 카드의 최대 너비를 조금 줄이고 하단 안내 간격은 유지한다. */}
            <div className="min-w-0 space-y-2 max-w-[85%] sm:max-w-[80%]">
                <div className="bg-white border border-brand-border shadow-soft p-4 rounded-2xl rounded-tl-sm text-sm text-brand-text space-y-3 break-words">

                    {(needsActivityConfirmation || reply.activityCreated) && analysis ? <>
                        <div className="font-bold text-sm text-brand-primary">
                            {reply.activityCreated ? `${analysis.activity.name} · 활동 기록` : analysis.activity.match === 'new' ? `${analysis.activity.name} · 새 활동 제안` : '자료를 연결할 활동을 확인해 주세요'}
                        </div>
                        <p className="text-xs whitespace-pre-wrap">{reply.content}</p>
                        <div className="rounded-xl border border-brand-border bg-slate-50 p-3 text-xs space-y-2">
                            <p><span className="text-brand-muted">활동 유형:</span> {analysis.activity.category ?? '미분류'}</p>
                            <p><span className="text-brand-muted">자료 유형:</span> {analysis.materialType}</p>
                            <p className="leading-relaxed"><strong>AI 요약:</strong> {analysis.summary}</p>
                            {analysis.files.length > 0 && <ul className="space-y-1">{analysis.files.map((file, index) => <li key={index} className="break-all">{file.name}</li>)}</ul>}
                        </div>
                        {!reply.activityCreated && <p className="text-xs text-brand-muted">{analysis.activity.match === 'new' ? '이 활동으로 자료를 저장할까요? 새 활동으로 저장하거나 기존 활동에 연결할 수 있어요.' : '아직 연결할 활동을 정하지 못했어요. 기존 활동을 선택해 주세요.'}</p>}
                        {(!needsActivityConfirmation || !activityActions) && <div className="flex flex-wrap gap-2"><RecordButtons label="새 활동으로 저장" actions={actions} /></div>}
                    </> : isBatchAnalysis ? <BatchAnalysisContent reply={reply} actions={actions} /> : isNoChangeAnalysis ? <NoChangeAnalysisContent reply={reply} actions={actions} /> : isSingleFileAnalysis ? <FileAnalysisContent reply={reply} actions={actions} /> : (
                        <>

                    {/* AI가 연결한 활동과 분류 확신도 */}
                    {analysis && (
                        <div className="flex flex-wrap items-center justify-between gap-2 font-bold text-sm">
                            <span className="text-brand-primary flex items-center gap-1.5">
                                <FolderGit2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                                {analysis.activity.name} 활동 기록
                            </span>

                            {analysis.activity.confidence && (
                                <span className="text-[11px] font-normal text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                    확신도 {confidenceLabels[analysis.activity.confidence]}
                                </span>
                            )}
                        </div>
                    )}

                    <p className="text-xs whitespace-pre-wrap">{reply.content}</p>

                    {reply.kind === 'link-analysis' && analysis && (
                        <div className="p-3 bg-slate-50 rounded-xl border border-brand-border text-xs space-y-2">
                            {reply.sourceUrl && <a href={reply.sourceUrl} target="_blank" rel="noopener noreferrer" className="block text-brand-primary underline break-all">{reply.sourceUrl}</a>}
                            <p><span className="text-brand-muted">자료 유형:</span> <strong>{analysis.materialType}</strong></p>
                            <p><strong>AI 요약:</strong> {analysis.summary}</p>
                        </div>
                    )}

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

                    {/* 저장 상태와 수정 동작은 홈·미리보기에서 같은 API 흐름을 사용한다. */}
                    {analysis && (
                        <div className="pt-1 flex flex-wrap items-center gap-2">
                            <RecordButtons label={`${analysis.activity.name}에 기록`} actions={actions} otherActivity />
                        </div>
                    )}
                        </>
                    )}
                    {activityActions}
                </div>

                <p className="text-[10px] text-brand-muted pl-1">
                    <ChatMessageTime createdAt={reply.createdAt} now={now} /> · Growth AI
                </p>
            </div>
        </div>
    )
}

export default ChatReplyCard
