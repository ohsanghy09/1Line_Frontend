import { Link } from 'react-router'
import type { ChatReply } from '../types/chat'

// 원본의 문구 순서를 유지하면서 제목·분류·안내 문구 전체에 맞춰 카드 너비를 정한다.
// 개수·활동명·분류·요약은 응답 데이터에서 읽어 실제 API 연결 후에도 같은 화면을 쓴다.
function BatchAnalysisContent({ reply }: { reply: ChatReply }) {
    const analysis = reply.analysis
    if (!analysis) return null

    return (
        <>
            <div className="font-bold text-sm text-brand-text leading-relaxed [word-break:keep-all]">{reply.content}</div>

            <div className="p-3 bg-slate-50 rounded-xl border border-brand-border text-xs space-y-2">
                <div className="flex flex-wrap gap-2 items-center justify-between border-b border-brand-border/60 pb-1.5">
                    <span className="font-bold text-brand-primary">{analysis.activity.name}</span>
                    <span className="px-2 py-0.5 bg-brand-primarySoft text-brand-primary rounded font-semibold text-[10px]">
                        {analysis.files.length}개 파일 자동 매칭
                    </span>
                </div>

                {/* 문구의 한 줄 너비를 확보한 뒤 남은 공간을 나눈다. 부족하면 박스 전체가 다음 행으로 이동한다. */}
                <div className="flex flex-wrap gap-2 text-center text-[11px]">
                    {analysis.groups.map((group) => (
                        <div key={group.materialType} className="min-w-0 max-w-full flex-auto overflow-x-auto whitespace-nowrap bg-white p-2 rounded border border-brand-border">
                            {group.materialType} <strong>{group.count}개</strong>
                        </div>
                    ))}
                </div>

                <p className="text-[11px] text-brand-muted leading-relaxed [word-break:keep-all]">💡 {analysis.summary}</p>
            </div>

            <div className="pt-1 flex items-center space-x-2">
                {/* 저장 API는 아직 미연결. 비활성 상태를 유지하되 원본의 색상과 크기는 유지한다. */}
                <button type="button" disabled title="저장 기능 준비 중" className="px-3.5 py-1.5 bg-brand-primary text-white rounded-lg text-xs font-medium hover:bg-brand-primaryHover">
                    전체 저장
                </button>
                <Link to="/archive" className="px-3.5 py-1.5 border border-brand-border rounded-lg text-xs text-slate-700 hover:bg-slate-50">
                    자료 확인
                </Link>
            </div>
        </>
    )
}

export default BatchAnalysisContent
