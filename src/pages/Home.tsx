import { Bot, ChevronRight, FileText, FolderGit2, History, Link, MessageSquare, Paperclip, RotateCcw, Send, Sparkles } from 'lucide-react'
import { Link as RouterLink } from 'react-router'
import { mockRecentActivities } from '../mocks/Home/recentActivities'
import { mockRecentRecords } from '../mocks/Home/records'

function Home() {
    return (
        <section className="space-y-6">

            {/* 페이지 제목과 설명 영역 */}
            <div>

                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-brand-text">
                    오늘 어떤 경험을 기록해볼까요?
                </h2>

                <p className="text-sm text-brand-muted mt-1">
                    파일이나 링크를 올리거나, 오늘 있었던 일을 간단히 적어보세요. Growth AI가 기존 기록과 연결해 정리해드려요.
                </p>

            </div>



            {/* Growth AI 채팅 영역 */}
            <div className="bg-brand-surface rounded-2xl border border-brand-border shadow-soft flex flex-col h-[520px] overflow-hidden">

                {/* 채팅 헤더: AI 이름, 준비 상태, 대화 초기화 버튼 */}
                <div className="px-5 py-3.5 border-b border-brand-border bg-slate-50/50 flex items-center justify-between">

                    <div className="flex items-center space-x-2.5">
                        <div className="w-7 h-7 rounded-lg bg-brand-primary/10 flex items-center justify-center text-brand-primary">
                            <Sparkles className="w-4 h-4" aria-hidden="true" />
                        </div>

                        <span className="font-semibold text-sm text-brand-text">Growth AI</span>

                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5"></span>
                            기록 정리 준비됨
                        </span>
                    </div>

                    <button type="button" className="text-xs text-brand-muted hover:text-brand-text flex items-center gap-1">
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        대화 초기화
                    </button>

                </div>



                {/* 메시지 영역: 원본의 초기 AI 인사만 표시 */}
                <div className="flex-1 p-5 overflow-y-auto space-y-4">

                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4" aria-hidden="true" />
                        </div>

                        <div className="space-y-2 max-w-[85%]">
                            <div className="bg-slate-100/80 p-3.5 rounded-2xl rounded-tl-sm text-sm text-brand-text leading-relaxed">
                                안녕하세요! 오늘 만든 자료나 기록하고 싶은 경험을 남겨주세요.
                                <br />
                                어떤 활동인지 제가 먼저 확인하고 기존 기록과 연결해볼게요.
                            </div>

                            <p className="text-[10px] text-brand-muted pl-1">방금 전</p>
                        </div>
                    </div>

                </div>



                {/* 시연 시나리오 영역: 버튼 모양만 표시하며 클릭 동작은 연결하지 않음 */}
                <div className="px-4 py-2 bg-slate-50 border-t border-brand-border/60 flex flex-wrap gap-2 text-xs">

                    <span className="text-brand-muted self-center text-[11px] font-medium mr-1">💡 시연 시나리오:</span>

                    <button type="button" className="px-2.5 py-1 bg-white border border-brand-border rounded-lg hover:border-brand-primary text-slate-700 transition">
                        1. 텍스트 경험 입력 (기능 축소)
                    </button>

                    <button type="button" className="px-2.5 py-1 bg-white border border-brand-border rounded-lg hover:border-brand-primary text-slate-700 transition">
                        2. 파일 업로드 (wireframe_v2)
                    </button>

                    <button type="button" className="px-2.5 py-1 bg-white border border-brand-border rounded-lg hover:border-brand-primary text-slate-700 transition">
                        3. 변화 없음 파일 (typo_fix)
                    </button>

                    <button type="button" className="px-2.5 py-1 bg-white border border-brand-border rounded-lg hover:border-brand-primary text-slate-700 transition">
                        4. 다중 파일 일괄 업로드 (5개)
                    </button>

                </div>



                {/* 입력 영역: 전송과 Enter 입력 시 새로고침을 방지하고 메시지는 변경하지 않음 */}
                <div className="p-3 bg-brand-surface border-t border-brand-border">

                    <form onSubmit={(event) => event.preventDefault()} className="relative flex items-center bg-slate-50 border border-brand-border rounded-xl focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primarySoft transition">

                        {/* 파일 첨부용 input: 현재 버튼과 연결하지 않음 */}
                        <input type="file" multiple className="hidden" />

                        <button type="button" className="p-2.5 text-brand-muted hover:text-brand-primary rounded-lg transition ml-1" title="파일 업로드" aria-label="파일 업로드">
                            <Paperclip className="w-5 h-5" aria-hidden="true" />
                        </button>

                        <button type="button" className="p-2.5 text-brand-muted hover:text-brand-primary rounded-lg transition" title="링크 추가" aria-label="링크 추가">
                            <Link className="w-5 h-5" aria-hidden="true" />
                        </button>

                        <input type="text" aria-label="채팅 메시지" placeholder="오늘 있었던 일을 적거나 자료를 추가해보세요." className="w-full bg-transparent px-3 py-3 text-sm focus:outline-none text-brand-text placeholder-brand-muted" />

                        <button type="button" className="m-1.5 p-2 bg-brand-primary hover:bg-brand-primaryHover text-white rounded-lg transition flex items-center justify-center shrink-0" aria-label="메시지 전송">
                            <Send className="w-4 h-4" aria-hidden="true" />
                        </button>

                    </form>

                </div>

            </div>



            {/* 하단 영역: 모바일 1열, 데스크톱 3열 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* 최근 활동 영역: 데스크톱에서 2열 차지 */}
                <div className="lg:col-span-2 bg-brand-surface rounded-2xl border border-brand-border p-5 shadow-soft">

                    {/* 최근 활동 제목과 전체 보기 링크 */}
                    <div className="flex items-center justify-between mb-4">

                        <h3 className="font-bold text-base text-brand-text flex items-center gap-2">
                            <FolderGit2 className="w-4 h-4 text-brand-primary" aria-hidden="true" />
                            최근 활동
                        </h3>

                        <RouterLink to="/archive" className="text-xs text-brand-primary font-medium hover:underline flex items-center gap-1">
                            전체 보기
                            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                        </RouterLink>

                    </div>



                    {/* 활동 카드 목록: 원본처럼 앞의 3개 표시, 모바일 1열 / md 이상 3열 */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                        {mockRecentActivities.slice(0, 3).map((activity) => (
                            <RouterLink key={activity.id} to="/archive" className="group bg-white p-4 rounded-xl border border-brand-border hover:border-brand-primary hover:shadow-cardHover transition cursor-pointer flex flex-col justify-between">

                                {/* 카드 상단: 활동명, 상태, 유형, 요약 */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="font-bold text-sm text-brand-text group-hover:text-brand-primary transition">
                                            {activity.title}
                                        </span>

                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${activity.status === '진행 중' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}`}>
                                            {activity.status === '진행 중' ? '🟢 진행 중' : '✓ 완료'}
                                        </span>
                                    </div>

                                    <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-semibold mb-2">
                                        {activity.category}
                                    </span>

                                    <p className="text-xs text-brand-muted line-clamp-2 leading-relaxed mb-3">
                                        {activity.summary}
                                    </p>
                                </div>


                                {/* 카드 하단: 자료 개수와 업데이트 시각 */}
                                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-brand-muted">
                                    <span>자료 {activity.materialsCount}개</span>
                                    <span>{activity.updatedAt}</span>
                                </div>

                            </RouterLink>
                        ))}

                    </div>

                </div>



                {/* 최근 추가된 기록 영역: 데스크톱에서 1열 차지 */}
                <div className="bg-brand-surface rounded-2xl border border-brand-border p-5 shadow-soft flex flex-col">

                    {/* 최근 추가된 기록 제목 */}
                    <h3 className="font-bold text-base text-brand-text mb-4 flex items-center gap-2">
                        <History className="w-4 h-4 text-brand-secondary" aria-hidden="true" />
                        최근 추가된 기록
                    </h3>



                    {/* 기록 목록: 목데이터의 아이콘 종류에 따라 파일 또는 대화 아이콘 표시 */}
                    <div className="space-y-3 flex-1 overflow-y-auto">

                        {mockRecentRecords.map((record) => (
                            <RouterLink key={record.id} to="/archive" className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-brand-border/60 transition cursor-pointer flex items-center space-x-3">

                                {/* 기록 아이콘 */}
                                <div className="w-8 h-8 rounded-lg bg-white border border-brand-border flex items-center justify-center text-brand-primary shrink-0">
                                    {record.icon === 'file-text'
                                        ? <FileText className="w-4 h-4" aria-hidden="true" />
                                        : <MessageSquare className="w-4 h-4" aria-hidden="true" />}
                                </div>


                                {/* 기록 이름과 소속 활동 / 자료 유형 */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-brand-text truncate">{record.title}</p>
                                    <p className="text-[10px] text-brand-muted truncate">{record.meta}</p>
                                </div>


                                {/* 기록 추가 시각 */}
                                <span className="text-[10px] text-brand-muted shrink-0">{record.time}</span>

                            </RouterLink>
                        ))}

                    </div>

                </div>

            </div>

        </section>
    )
}

export default Home
