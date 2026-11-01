import { Bot, ChevronRight, FileText, FolderGit2, History, Link, MessageSquare, Paperclip, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, SubmitEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import { mockRecentActivities } from '../mocks/Home/recentActivities'
import { mockRecentRecords } from '../mocks/Home/records'
import { mockGreetingReply } from '../mocks/Home/chat'
import ChatReplyCard from '../components/ChatReplyCard'
import { getChatReply } from '../services/chat'
import type { ChatMessage } from '../types/chat'

function Home() {
    // 입력 중인 내용과 전송한 메시지 목록
    const [chatInput, setChatInput] = useState('')
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [isReplying, setIsReplying] = useState(false)
    const [replyError, setReplyError] = useState('')

    // 전송 전 첨부 목록. 같은 이름의 파일도 구별하고 개별 삭제할 수 있도록 ID를 부여한다.
    const [pendingFiles, setPendingFiles] = useState<{ id: string; file: File }[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    // 입력 영역 안의 자식 요소를 지나갈 때도 드롭 강조가 깜빡이지 않도록 진입 횟수를 센다.
    const [isDraggingFiles, setIsDraggingFiles] = useState(false)
    const dragDepthRef = useRef(0)


    // 파일 선택창과 드래그 앤 드롭에서 같은 방식으로 첨부 목록을 추가한다.
    function addPendingFiles(selectedFiles: File[]) {
        setPendingFiles((previousFiles) => [
            ...previousFiles,
            ...selectedFiles.map((file) => ({ id: crypto.randomUUID(), file })),
        ])
    }


    // 파일 선택은 첨부 목록에만 반영하고, 실제 전송은 보내기 버튼에서 처리한다.
    function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
        addPendingFiles(Array.from(event.target.files ?? []))

        // 삭제 후 같은 파일을 다시 선택해도 change 이벤트가 발생하도록 비운다.
        event.target.value = ''
    }


    // 파일을 끌어온 경우만 처리하므로 일반 텍스트의 드래그 입력은 유지한다.
    function handleDragEnter(event: DragEvent<HTMLDivElement>) {
        if (!event.dataTransfer.types.includes('Files')) return

        event.preventDefault()
        dragDepthRef.current += 1
        setIsDraggingFiles(true)
    }

    function handleDragOver(event: DragEvent<HTMLDivElement>) {
        if (!event.dataTransfer.types.includes('Files')) return

        // 브라우저가 이 영역에 파일을 놓을 수 있도록 허용한다.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
    }

    function handleDragLeave() {
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)

        if (dragDepthRef.current === 0) setIsDraggingFiles(false)
    }

    function handleFileDrop(event: DragEvent<HTMLDivElement>) {
        if (!event.dataTransfer.types.includes('Files')) return

        // 파일을 브라우저에서 여는 기본 동작을 막고, 전송 전 첨부 목록에만 추가한다.
        event.preventDefault()
        dragDepthRef.current = 0
        setIsDraggingFiles(false)
        addPendingFiles(Array.from(event.dataTransfer.files))
    }

    // 응답 대기 중 중복 전송을 막고, 초기화 이전의 늦은 응답을 구별한다.
    const pendingRequestRef = useRef(false)
    const requestIdRef = useRef(0)

    useEffect(() => {
        return () => { requestIdRef.current += 1 }
    }, [])

    // 새 메시지가 추가되면 채팅 영역의 맨 아래로 이동
    const chatContainerRef = useRef<HTMLDivElement>(null)

    // 메시지 배열이 바뀔 때마다 실행 -> 스크롤을 맨 아래로 내려줌
    useEffect(() => {
        const container = chatContainerRef.current

        if (container) {
            container.scrollTop = container.scrollHeight
        }
    }, [messages, isReplying, replyError])


    // 전송 버튼과 Enter 입력을 같은 폼 제출 동작으로 처리
    async function handleChatSubmit(event: SubmitEvent<HTMLFormElement>) {
        
        // 폼 제출 시 브라우저가 기본으로 하는 페이지 이동·새로고침을 막음.
        event.preventDefault()

        const content = chatInput.trim()

        // 글 없이 파일만 선택한 경우에도 전송할 수 있다.
        if ((!content && pendingFiles.length === 0) || pendingRequestRef.current) return

        const filesToSend = pendingFiles.map(({ file }) => file)
        const attachments = pendingFiles.map(({ id, file }) => ({ id, name: file.name, size: file.size }))

        // 기존 메시지 배열에 id, content 추가
        setMessages((previousMessages) => [
            ...previousMessages,
            { id: crypto.randomUUID(), role: 'user', content, attachments },
        ])

        // 입력 중인 내용을 빈 문자열로 수정
        setChatInput('')
        setPendingFiles([])

        // 사용자 말풍선을 추가한 뒤 AI 응답을 기다린다.
        pendingRequestRef.current = true
        const requestId = ++requestIdRef.current
        setIsReplying(true)
        setReplyError('')

        try {
            const reply = await getChatReply(content, filesToSend)

            if (requestId !== requestIdRef.current) return

            setMessages((previousMessages) => [...previousMessages, reply])
        } catch {
            if (requestId === requestIdRef.current) {
                setReplyError('답변을 받아오지 못했어요. 메시지를 다시 보내주세요.')
            }
        } finally {
            if (requestId === requestIdRef.current) {
                pendingRequestRef.current = false
                setIsReplying(false)
            }
        }
    }


    // 대화를 비우고, 초기화 전에 요청한 응답은 화면에 추가하지 않는다.
    function handleResetChat() {
        requestIdRef.current += 1
        pendingRequestRef.current = false
        setMessages([])
        setChatInput('')
        setPendingFiles([])
        if (fileInputRef.current) fileInputRef.current.value = ''
        dragDepthRef.current = 0
        setIsDraggingFiles(false)
        setIsReplying(false)
        setReplyError('')
    }


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

                    <button type="button" onClick={handleResetChat} className="text-xs text-brand-muted hover:text-brand-text flex items-center gap-1">
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        대화 초기화
                    </button>

                </div>



                {/* 메시지 영역: 초기 AI 인사와 전송한 사용자 메시지 표시 */}
                <div ref={chatContainerRef} role="log" aria-label="채팅 대화" aria-live="polite" className="flex-1 min-h-0 p-5 overflow-y-auto space-y-4">

                    <div className="flex gap-3">
                        <div className="w-8 h-8 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                            <Bot className="w-4 h-4" aria-hidden="true" />
                        </div>

                        <div className="space-y-2 max-w-[85%]">
                            <div className="bg-slate-100/80 p-3.5 rounded-2xl rounded-tl-sm text-sm text-brand-text leading-relaxed whitespace-pre-wrap">
                                {mockGreetingReply.content}
                            </div>

                            <p className="text-[10px] text-brand-muted pl-1">방금 전</p>
                        </div>
                    </div>

                    {/* 한 배열을 순회하며 사용자 말풍선과 AI 카드를 대화 순서대로 표시 */}
                    {messages.map((message) => message.role === 'assistant' ? (
                        <ChatReplyCard key={message.id} reply={message} />
                    ) : (
                        <div key={message.id} className="flex justify-end">
                            <div className="min-w-0 max-w-[85%] space-y-2">
                                <div className="bg-brand-primary p-3.5 rounded-2xl rounded-tr-sm text-sm text-white leading-relaxed break-words space-y-2">
                                    {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}

                                    {/* 전송한 파일명은 사용자 말풍선에 고정해 첨부 목록과 분리한다. */}
                                    {!!message.attachments?.length && (
                                        <div className="space-y-2">
                                            <p className="text-xs font-semibold">첨부 파일 {message.attachments.length}개</p>
                                            <ul className="space-y-1.5">
                                                {message.attachments.map((attachment) => (
                                                    <li key={attachment.id} className="flex items-start gap-2 rounded-lg bg-white/10 p-2">
                                                        <FileText className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
                                                        <span className="min-w-0 break-all">{attachment.name}</span>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>

                                <p className="text-[10px] text-brand-muted text-right pr-1">나</p>
                            </div>
                        </div>
                    ))}

                    {/* 원본과 같은 AI 아이콘과 점 3개. 응답이 도착하면 분석 카드로 교체한다. */}
                    {isReplying && (
                        <div role="status" className="flex gap-3">
                            <span className="sr-only">Growth AI가 답변을 작성하고 있어요.</span>

                            <div className="w-8 h-8 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
                                <Bot className="w-4 h-4" aria-hidden="true" />
                            </div>

                            <div aria-hidden="true" className="bg-slate-100 p-3.5 rounded-2xl rounded-tl-sm flex items-center space-x-1.5">
                                <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot"></span>
                                <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot"></span>
                                <span className="w-2 h-2 rounded-full bg-slate-400 typing-dot"></span>
                            </div>
                        </div>
                    )}

                    {replyError && <p role="alert" className="text-sm text-red-600">{replyError}</p>}

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



                {/* 입력 영역: 전송 버튼 또는 Enter로 사용자 메시지 추가 */}
                <div
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleFileDrop}
                    className={`relative p-3 bg-brand-surface border-t border-brand-border shrink-0 ${isDraggingFiles ? 'ring-2 ring-inset ring-brand-primary' : ''}`}
                >

                    {/* 파일을 끌고 있는 동안 놓을 위치를 안내한다. 이벤트는 아래 입력 영역에서 받는다. */}
                    {isDraggingFiles && (
                        <div className="absolute inset-0 z-10 pointer-events-none flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-brand-primary bg-brand-primarySoft/95 text-sm font-medium text-brand-primary">
                            <Paperclip className="w-5 h-5" aria-hidden="true" />
                            파일을 여기에 놓아 첨부하세요
                        </div>
                    )}

                    {/* 전송 전 첨부 미리보기: 여러 번 선택해 추가하거나 개별 삭제할 수 있다. */}
                    {pendingFiles.length > 0 && (
                        <div className="mb-3 rounded-xl border border-brand-border bg-slate-50 p-3">
                            <p className="text-xs font-medium text-brand-muted mb-2">첨부 파일 {pendingFiles.length}개</p>

                            <ul aria-label="전송할 첨부 파일" className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                                {pendingFiles.map(({ id, file }) => (
                                    <li key={id} className="min-w-0 max-w-full flex items-center gap-2 bg-white border border-brand-border rounded-lg py-1.5 pl-2.5 pr-1">
                                        <FileText className="w-4 h-4 text-brand-primary shrink-0" aria-hidden="true" />
                                        <span className="text-xs text-brand-text truncate" title={file.name}>{file.name}</span>
                                        <button
                                            type="button"
                                            onClick={() => setPendingFiles((previousFiles) => previousFiles.filter((item) => item.id !== id))}
                                            aria-label={`${file.name} 첨부 삭제`}
                                            className="p-1 text-brand-muted hover:text-brand-text shrink-0"
                                        >
                                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    <form onSubmit={handleChatSubmit} className="relative flex items-center bg-slate-50 border border-brand-border rounded-xl focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primarySoft transition">

                        {/* 클립 버튼으로 파일 선택창을 열며 여러 파일을 한 번에 선택 가능 */}
                        <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />

                        <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2.5 text-brand-muted hover:text-brand-primary rounded-lg transition ml-1" title="파일 업로드" aria-label="파일 업로드">
                            <Paperclip className="w-5 h-5" aria-hidden="true" />
                        </button>

                        <button type="button" className="p-2.5 text-brand-muted hover:text-brand-primary rounded-lg transition" title="링크 추가" aria-label="링크 추가">
                            <Link className="w-5 h-5" aria-hidden="true" />
                        </button>

                        {/* 한글 조합을 확정하는 Enter가 메시지까지 전송하지 않도록 처리 */}
                        <input
                            type="text"
                            value={chatInput}
                            onChange={(event) => setChatInput(event.target.value)}
                            onKeyDown={(event) => {

                                // enter를 눌렀고, 만약 글자가 조합 중일 때 
                                if (event.key === 'Enter' && event.nativeEvent.isComposing) {
                                    
                                    // 폼 제출 방지 -> onKeyDown에서는 아예 폼 제출 방지
                                    event.preventDefault()
                                }
                            }}
                            aria-label="채팅 메시지"
                            placeholder="오늘 있었던 일을 적거나 자료를 추가해보세요."
                            className="w-full min-w-0 bg-transparent px-3 py-3 text-sm focus:outline-none text-brand-text placeholder-brand-muted"
                        />

                        <button type="submit" disabled={isReplying || (!chatInput.trim() && pendingFiles.length === 0)} className="m-1.5 p-2 bg-brand-primary hover:bg-brand-primaryHover text-white rounded-lg transition flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="메시지 전송">
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
