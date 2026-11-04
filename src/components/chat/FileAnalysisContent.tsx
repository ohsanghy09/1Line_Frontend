import type { ChatReply } from '../../types/chat'
import RecordButtons from './RecordButtons'
import type { RecordActions } from './RecordButtons'

// 원본의 단일 파일 결과: 제목 → 분류 → AI 요약 → 비교 → 저장·수정.
function FileAnalysisContent({ reply, actions }: { reply: ChatReply; actions?: RecordActions }) {
    const analysis = reply.analysis
    if (!analysis) return null
    const file = analysis.files[0]
    if (!file) return null

    return (
        <>
            <div className="font-bold text-sm text-brand-text flex flex-wrap items-center justify-between gap-2">
                <span>분석이 끝났어요. <span className="text-brand-primary break-all">{file.name}</span></span>
                {analysis.changes.length > 0 && (
                    <span className="px-2 py-0.5 text-[10px] bg-brand-primarySoft text-brand-primary font-semibold rounded-md">
                        새로운 변화 {analysis.changes.length}개 발견
                    </span>
                )}
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-brand-border">
                <div className="min-w-0"><span className="text-brand-muted">활동:</span> <strong className="text-brand-text">{analysis.activity.name}</strong></div>
                <div className="min-w-0"><span className="text-brand-muted">자료 유형:</span> <strong>{analysis.materialType}</strong></div>
                <div><span className="text-brand-muted">단계:</span> <strong>{analysis.stage ?? '—'}</strong></div>
                <div className="min-w-0 break-words"><span className="text-brand-muted">관련 자료:</span> <strong className="text-slate-600">{file.previousVersion ?? '없음'}</strong></div>
            </div>

            <p className="text-xs text-brand-text leading-relaxed"><strong>AI 요약:</strong> {analysis.summary}</p>

            {analysis.changes.map((change, index) => (
                <div key={index} className="grid grid-cols-2 gap-2 p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl text-xs">
                    <div className="min-w-0">
                        <span className="text-[10px] text-brand-muted block font-semibold">BEFORE</span>
                        <p className="text-slate-600">{change.before}</p>
                    </div>
                    <div className="min-w-0 border-l border-indigo-100 pl-2.5">
                        <span className="text-[10px] text-brand-primary block font-semibold">AFTER</span>
                        <p className="font-bold text-brand-primary">{change.after}</p>
                    </div>
                </div>
            ))}

            {/* 원본 버튼 배치를 유지하며 실제 저장·수정 동작을 전달한다. */}
            <div className="pt-1 flex items-center space-x-2">
                <RecordButtons label="저장" actions={actions} wide />
            </div>
        </>
    )
}

export default FileAnalysisContent
