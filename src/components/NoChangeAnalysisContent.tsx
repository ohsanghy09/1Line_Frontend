import { Info } from 'lucide-react'
import type { ChatReply } from '../types/chat'

// 원본의 변화 없음 카드. 판단 문구와 이유는 응답에서 읽고 저장 완료로 표현하지 않는다.
function NoChangeAnalysisContent({ reply }: { reply: ChatReply }) {
    const analysis = reply.analysis
    if (!analysis) return null

    return (
        <>
            <div className="font-semibold text-sm text-brand-text flex items-center gap-1.5">
                <Info className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
                {reply.content}
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-brand-border text-xs text-brand-muted space-y-1">
                <p className="font-medium text-slate-700">{analysis.noChangeMessage ?? '새로운 주요 변화가 발견되지 않았어요.'}</p>
                <p className="text-[11px]">{analysis.summary}</p>
            </div>

            {/* 저장·수정 API는 아직 미연결이므로 버튼은 비활성 상태를 유지한다. */}
            <div className="pt-1 flex items-center space-x-2">
                <button type="button" disabled title="저장 기능 준비 중" className="px-3 py-1.5 bg-brand-primary text-white rounded-lg text-xs font-medium">아카이브 저장</button>
                <button type="button" disabled title="수정 기능 준비 중" className="px-3 py-1.5 border border-brand-border rounded-lg text-xs text-slate-700 hover:bg-slate-50">수정</button>
            </div>
        </>
    )
}

export default NoChangeAnalysisContent
