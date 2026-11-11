import { Bot, ChevronRight, FileText, FolderGit2, History, Link, MessageSquare, Paperclip, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, SubmitEvent } from 'react'
import { Link as RouterLink } from 'react-router'
import { useHomeRecent } from '../hooks/useHomeRecent'
import { formatRecentActivityTime } from '../utils/recentActivityTime'
import ConnectedChatReplyCard from '../components/chat/ConnectedChatReplyCard'
import LinkInputModal from '../components/chat/modals/LinkInputModal'
import ChatMessageTime from '../components/chat/ChatMessageTime'
import FileAnalysisProgress from '../components/chat/FileAnalysisProgress'
import ChatServiceStatusBadge from '../components/chat/ChatServiceStatusBadge'
import { getChatReply, getLinkReply, getChatServiceStatus, resumeChatReply, isTerminalChatFailure } from '../services/chat'
import type { ChatMessage, ChatProgress, ChatServiceStatus } from '../types/chat'
import { appendChatReply, readChatSession, writeChatSession } from '../utils/chatSession'
import type { PendingChatJob } from '../utils/chatSession'

function Home() {
    const { data: recent, loading: recentLoading, error: recentError, retry: retryRecent } = useHomeRecent()
    // 탭의 저장값은 처음 한 번만 읽어 새로고침·홈 재진입 시 같은 대화를 복원한다.
    const [restoredSession] = useState(() => readChatSession())
    const [sessionError, setSessionError] = useState('')
    // 입력 중인 내용과 전송한 메시지 목록
    const [chatInput, setChatInput] = useState('')
    const [isLinkModalOpen, setIsLinkModalOpen] = useState(false)
    const [linkDraft, setLinkDraft] = useState('')
    const [messages, setMessages] = useState<ChatMessage[]>(() => restoredSession?.messages ?? [])
    const [pendingJob, setPendingJob] = useState<PendingChatJob | null>(restoredSession?.pendingJob ?? null)
    const [isReplying, setIsReplying] = useState(Boolean(restoredSession?.pendingJob))
    const [replyError, setReplyError] = useState(restoredSession?.pending && !restoredSession.pendingJob ? '작업 ID를 받기 전에 응답 확인이 중단됐어요. 전송 내역은 복원했지만 요청은 자동 재전송하지 않습니다.' : '')
    const [analysisProgress, setAnalysisProgress] = useState<ChatProgress | null>(null)

    // 헤더의 준비 상태는 별도 서비스에서 조회한다. 응답 전에는 준비 완료로 표시하지 않는다.
    const [serviceStatus, setServiceStatus] = useState<ChatServiceStatus | null>(null)
    const [hasServiceStatusError, setHasServiceStatusError] = useState(false)

    useEffect(() => {
        let isActive = true

        void getChatServiceStatus().then(
            (status) => { if (isActive) setServiceStatus(status) },
            () => { if (isActive) setHasServiceStatusError(true) },
        )

        // 홈을 떠난 뒤 도착한 상태 응답은 화면에 반영하지 않는다.
        return () => { isActive = false }
    }, [])

    // 초기 인사 시각과 현재 시각. 메시지가 추가되지 않아도 상대 시간을 갱신한다.
    const [greetingCreatedAt, setGreetingCreatedAt] = useState(() => restoredSession?.greetingCreatedAt ?? Date.now())
    const [currentTime, setCurrentTime] = useState(() => Date.now())

    useEffect(() => {
        const timer = window.setInterval(() => setCurrentTime(Date.now()), 30_000)
        return () => window.clearInterval(timer)
    }, [])

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
    const pendingRequestRef = useRef(Boolean(restoredSession?.pendingJob))
    const requestIdRef = useRef(0)
    // 화면의 전송을 같은 대화로 보관하고 초기화하면 새 대화를 시작한다.
    const conversationIdRef = useRef(restoredSession?.conversationId ?? crypto.randomUUID())
    const requestControllerRef = useRef<AbortController | null>(null)

    // File 원본·전송 전 첨부·요청 객체는 저장하지 않고 표시 데이터만 JSON으로 보관한다.
    useEffect(() => {
        const stored = writeChatSession({
            version: 1, conversationId: conversationIdRef.current, greetingCreatedAt, messages, pending: isReplying, pendingJob,
        })
        setSessionError(stored ? '' : '브라우저에 대화를 보관하지 못했어요. 새로고침하면 최근 내역이 사라질 수 있어요.')
    }, [messages, greetingCreatedAt, isReplying, pendingJob])

    function resumeJob(job: PendingChatJob) {
        requestControllerRef.current?.abort()
        const controller = new AbortController()
        requestControllerRef.current = controller
        const requestId = ++requestIdRef.current
        pendingRequestRef.current = true
        void resumeChatReply(job.jobId, {
            signal: controller.signal,
            onProgress: progress => { if (requestId === requestIdRef.current && job.showProgress !== false) setAnalysisProgress(progress) },
        }).then(reply => {
            if (requestId !== requestIdRef.current) return
            setMessages(current => appendChatReply(current, { ...reply, createdAt: Date.now() }))
            setPendingJob(null)
        }).catch(error => {
            if (requestId === requestIdRef.current) {
                setReplyError(error instanceof Error ? error.message : '진행 상태를 확인하지 못했어요.')
                // 확정 실패를 대기 작업에서 해제해 다음 입력을 보낼 수 있게 한다.
                if (isTerminalChatFailure(error)) setPendingJob(null)
            }
        }).finally(() => {
            if (requestId !== requestIdRef.current) return
            pendingRequestRef.current = false
            requestControllerRef.current = null
            setIsReplying(false); setAnalysisProgress(null)
        })
    }

    // 복원 작업을 재개하고, 복원 여부와 관계없이 화면 해제 시 진행 요청을 무효화한다.
    useEffect(() => {
        if (restoredSession?.pendingJob) resumeJob(restoredSession.pendingJob)
        return () => { requestIdRef.current += 1; requestControllerRef.current?.abort() }
    }, [restoredSession])

    // 새 메시지가 추가되면 채팅 영역의 맨 아래로 이동
    const chatContainerRef = useRef<HTMLDivElement>(null)

    // 메시지 배열이 바뀔 때마다 실행 -> 스크롤을 맨 아래로 내려줌
    useEffect(() => {
        const container = chatContainerRef.current

        if (container) {
            container.scrollTop = container.scrollHeight
        }
    }, [messages, isReplying, replyError, analysisProgress])


    // 전송 버튼과 Enter 입력을 같은 폼 제출 동작으로 처리
    function handleChatSubmit(event: SubmitEvent<HTMLFormElement>) {
        
        // 폼 제출 시 브라우저가 기본으로 하는 페이지 이동·새로고침을 막음.
        event.preventDefault()

        void sendChatMessage(chatInput.trim(), pendingFiles.map(({ file }) => file))
    }

    // 실제 입력과 첨부만 공통 서비스로 전송하고 비동기 보호를 적용한다.
    async function sendChatMessage(content: string, filesToSend: File[], sourceUrl?: string) {

        // 글 없이 파일만 선택한 경우에도 전송할 수 있다.
        if ((!content && filesToSend.length === 0) || pendingRequestRef.current || pendingJob) return

        // 사용자가 선택한 파일명과 크기를 그대로 말풍선에 표시한다.
        const attachments = filesToSend.map((file) => ({ id: crypto.randomUUID(), name: file.name, size: file.size }))
        const sentAt = Date.now()
        const userMessageId = crypto.randomUUID()

        // 기존 메시지 배열에 id, content 추가
        setMessages((previousMessages) => [
            ...previousMessages,
            { id: userMessageId, role: 'user', content, attachments, createdAt: sentAt },
        ])

        // 링크 모달에서 보낸 경우에는 기존 입력 글과 첨부를 그대로 둔다.
        if (!sourceUrl) {
            setChatInput('')
            setPendingFiles([])
        }

        // 사용자 말풍선을 추가한 뒤 AI 응답을 기다린다.
        pendingRequestRef.current = true
        const requestId = ++requestIdRef.current
        setIsReplying(true)
        setReplyError('')
        setAnalysisProgress(null)

        const controller = new AbortController()
        requestControllerRef.current = controller
        // 접수 여부는 이 전송에만 속한다. 콜백과 오류 처리에서 같은 요청 상태를 읽는다.
        const requestStatus = { jobAccepted: false }

        try {
            // 파일·링크는 접수 즉시 작업 ID를 보관한다. 텍스트는 한 요청의 최종 결과를 기다린다.
            const requestOptions = {
                conversationId: conversationIdRef.current,
                signal: controller.signal,
                onJobStarted: (jobId: string) => {
                    if (requestId !== requestIdRef.current) return
                    requestStatus.jobAccepted = true
                    setPendingJob({ jobId, userMessageId, showProgress: Boolean(filesToSend.length || sourceUrl) })
                },
                onProgress: (progress: ChatProgress) => {
                    if (requestId === requestIdRef.current && (filesToSend.length > 0 || sourceUrl)) setAnalysisProgress(progress)
                },
            }
            const reply = await (sourceUrl ? getLinkReply(sourceUrl, requestOptions) : getChatReply(content, filesToSend, requestOptions))

            if (requestId !== requestIdRef.current) return

            // AI 메시지는 응답이 실제로 도착한 시각을 저장한다.
            const receivedAt = Date.now()
            setMessages(current => appendChatReply(current, { ...reply, createdAt: receivedAt }))
            setPendingJob(null)
        } catch (error) {
            if (requestId === requestIdRef.current) {
                setReplyError(error instanceof Error ? error.message : '답변을 받아오지 못했어요. 메시지를 다시 보내주세요.')
                const terminalFailure = isTerminalChatFailure(error)
                if (terminalFailure) setPendingJob(null)
                // 실패한 입력은 다시 보낼 수 있게 복원하되 새로 작성한 글은 덮어쓰지 않는다.
                if ((!requestStatus.jobAccepted || terminalFailure) && !sourceUrl) {
                    setChatInput(current => current || content)
                    setPendingFiles(current => [...filesToSend.map(file => ({ id: crypto.randomUUID(), file })), ...current])
                }
            }
        } finally {
            if (requestId === requestIdRef.current) {
                pendingRequestRef.current = false
                setIsReplying(false)
                setAnalysisProgress(null)
                requestControllerRef.current = null
            }
        }
    }


    // 대화를 비우고, 초기화 전에 요청한 응답은 화면에 추가하지 않는다.
    function handleResetChat() {
        setIsLinkModalOpen(false)
        setLinkDraft('')
        setPendingJob(null)
        requestIdRef.current += 1
        requestControllerRef.current?.abort()
        requestControllerRef.current = null
        conversationIdRef.current = crypto.randomUUID()
        pendingRequestRef.current = false
        setMessages([])
        setGreetingCreatedAt(Date.now())
        setCurrentTime(Date.now())
        setChatInput('')
        setPendingFiles([])
        if (fileInputRef.current) fileInputRef.current.value = ''
        dragDepthRef.current = 0
        setIsDraggingFiles(false)
        setIsReplying(false)
        setReplyError('')
        setAnalysisProgress(null)
    }


    return (
        <section className="space-y-6">
            {isLinkModalOpen && <LinkInputModal initialUrl={linkDraft} onClose={() => setIsLinkModalOpen(false)} onSubmit={url => {
                setLinkDraft(url)
                setIsLinkModalOpen(false)
                void sendChatMessage(url, [], url)
            }} />}

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

                        <ChatServiceStatusBadge status={serviceStatus} hasError={hasServiceStatusError} />
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
                                {'안녕하세요! 오늘 만든 자료나 기록하고 싶은 경험을 남겨주세요.\n어떤 활동인지 제가 먼저 확인하고 기존 기록과 연결해볼게요.'}
                            </div>

                            <p className="text-[10px] text-brand-muted pl-1">
                                <ChatMessageTime createdAt={greetingCreatedAt} now={currentTime} />
                            </p>
                        </div>
                    </div>

                    {/* 한 배열을 순회하며 사용자 말풍선과 AI 카드를 대화 순서대로 표시 */}
                    {messages.map((message) => message.role === 'assistant' ? (
                        <ConnectedChatReplyCard key={message.id} reply={message} now={currentTime} onChange={reply => setMessages(current => current.map(item => item.id === message.id ? { ...reply, id: message.id, createdAt: message.createdAt } : item))} />
                    ) : (
                        <div key={message.id} className="flex justify-end gap-3">
                            {/* 원본처럼 말풍선은 오른쪽에 붙이고 하단 시각과는 4px 간격을 둔다. */}
                            <div className="min-w-0 max-w-[80%] space-y-1 text-right">
                                <div className="bg-brand-primary p-3.5 rounded-2xl rounded-tr-sm text-sm text-white leading-relaxed inline-block text-left break-words space-y-2 max-w-full">
                                    {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}

                                    {/* 전송한 파일명은 사용자 말풍선에 고정해 첨부 목록과 분리한다. */}
                                    {message.attachments?.length === 1 ? (
                                        <div className="flex items-center gap-2">
                                            <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
                                            <span className="min-w-0 break-all">{message.attachments[0].name}</span>
                                        </div>
                                    ) : !!message.attachments?.length && (
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

                                <p className="text-[10px] text-brand-muted pr-1">
                                    <ChatMessageTime createdAt={message.createdAt} now={currentTime} />
                                </p>
                            </div>
                        </div>
                    ))}

                    {/* 원본과 같은 AI 아이콘과 점 3개. 응답이 도착하면 분석 카드로 교체한다. */}
                    {isReplying && (analysisProgress ? <FileAnalysisProgress progress={analysisProgress} /> : (
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
                    ))}

                    {replyError && <p role="alert" className="text-sm text-red-600">{replyError}</p>}
                    {pendingJob && !isReplying && <button type="button" onClick={() => { setIsReplying(true); setReplyError(''); resumeJob(pendingJob) }} className="text-xs text-brand-primary hover:underline">진행 상태 다시 확인</button>}
                    {sessionError && <p role="alert" className="text-sm text-red-600">{sessionError}</p>}

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

                        <button type="button" onClick={() => setIsLinkModalOpen(true)} disabled={isReplying || Boolean(pendingJob)} className="p-2.5 text-brand-muted hover:text-brand-primary rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed" title="링크 추가" aria-label="링크 추가">
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

                        <button type="submit" disabled={isReplying || Boolean(pendingJob) || (!chatInput.trim() && pendingFiles.length === 0)} className="m-1.5 p-2 bg-brand-primary hover:bg-brand-primaryHover text-white rounded-lg transition flex items-center justify-center shrink-0 disabled:opacity-50 disabled:cursor-not-allowed" aria-label="메시지 전송">
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



                    {/* DB에서 변경 시각이 최신인 활동 최대 3개. 로딩·오류·빈 결과를 구분한다. */}
                    {recentLoading && <p role="status" className="text-xs text-brand-muted">최근 활동을 불러오고 있어요.</p>}
                    {recentError && <div role="alert" className="text-xs text-brand-muted space-y-2"><p>{recentError}</p><button type="button" onClick={retryRecent} className="text-brand-primary underline">최근 목록 다시 불러오기</button></div>}
                    {!recentLoading && !recentError && recent?.activities.length === 0 && <p className="text-xs text-brand-muted">최근 변경된 활동이 없어요.</p>}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                        {recent?.activities.map((activity) => (
                            <RouterLink key={activity.id} to={`/archive/${encodeURIComponent(activity.id)}`} className="group bg-white p-4 rounded-xl border border-brand-border hover:border-brand-primary hover:shadow-cardHover transition cursor-pointer flex flex-col justify-between min-w-0">

                                {/* 카드 상단: 활동명, 상태, 유형, 요약 */}
                                <div>
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <span className="flex-1 min-w-0 font-bold text-sm text-brand-text group-hover:text-brand-primary transition wrap-anywhere">
                                            {activity.title}
                                        </span>

                                        <span className={`shrink-0 whitespace-nowrap text-[10px] px-2 py-0.5 rounded-full font-medium ${activity.status === '진행 중' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'}`}>
                                            {activity.status === '진행 중' ? '🟢 진행 중' : activity.status === '완료' ? '✓ 완료' : '상태 미설정'}
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
                                <div className="pt-2 border-t border-slate-100 flex flex-wrap gap-1 items-center justify-between text-[11px] text-brand-muted">
                                    <span>자료 {activity.materialsCount}개</span>
                                    <time dateTime={activity.updatedAt}>{formatRecentActivityTime(activity.updatedAt, currentTime)}</time>
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



                    {/* 기록은 최초 저장 시각순이며, 실제 자료 ID로 Drawer에 연결한다. */}
                    <div className="space-y-3 flex-1 overflow-y-auto">
                        {recentLoading && <p role="status" className="text-xs text-brand-muted">최근 기록을 불러오고 있어요.</p>}
                        {recentError && <div className="text-xs text-brand-muted space-y-2"><p>최근 기록을 불러오지 못했어요.</p><button type="button" onClick={retryRecent} className="text-brand-primary underline">최근 목록 다시 불러오기</button></div>}
                        {!recentLoading && !recentError && recent?.records.length === 0 && <p className="text-xs text-brand-muted">아직 추가된 기록이 없어요.</p>}

                        {recent?.records.map((record) => (
                            <RouterLink key={record.id} to={`/archive/${encodeURIComponent(record.activityId)}?file=${encodeURIComponent(record.id)}`} className="p-3 bg-slate-50 hover:bg-slate-100/80 rounded-xl border border-brand-border/60 transition cursor-pointer flex flex-wrap gap-3 items-center">

                                {/* 기록 아이콘 */}
                                <div className="w-8 h-8 rounded-lg bg-white border border-brand-border flex items-center justify-center text-brand-primary shrink-0">
                                    {record.kind === 'file'
                                        ? <FileText className="w-4 h-4" aria-hidden="true" />
                                        : record.kind === 'link' ? <Link className="w-4 h-4" aria-hidden="true" /> : <MessageSquare className="w-4 h-4" aria-hidden="true" />}
                                </div>


                                {/* 기록 이름과 소속 활동 / 자료 유형 */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-brand-text truncate">{record.title}</p>
                                    <p className="text-[10px] text-brand-muted truncate">{record.activityName} · {record.materialType}</p>
                                </div>


                                {/* 기록 추가 시각 */}
                                <time dateTime={record.savedAt} className="text-[10px] text-brand-muted shrink-0">{formatRecentActivityTime(record.savedAt, currentTime)}</time>

                            </RouterLink>
                        ))}

                    </div>

                </div>

            </div>

        </section>
    )
}

export default Home
