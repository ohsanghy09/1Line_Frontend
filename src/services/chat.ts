import type { ChatProgress, ChatReply, ChatServiceStatus } from '../types/chat'

// Home은 이 서비스로 로컬 REST API를 호출한다. 분석은 서버의 목 응답이다.
// 실제 AI 연결 시 서버에서 화면용 ChatReply로 변환하며 화면의 호출 구조는 유지한다.
type ChatRequestOptions = { conversationId?: string; signal?: AbortSignal; onProgress?: (progress: ChatProgress) => void; onJobStarted?: (jobId: string) => void }

export function isHttpUrl(value: string): boolean {
    try {
        const url = new URL(value)
        return value.length <= 4096 && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    } catch { return false }
}

export async function getLinkReply(url: string, options: ChatRequestOptions = {}): Promise<ChatReply> {
    options.signal?.throwIfAborted()
    const sourceUrl = url.trim()
    if (!isHttpUrl(sourceUrl)) throw new Error('HTTP 또는 HTTPS 링크를 입력해 주세요.')
    const data = await request('/chat/links', {
        method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl, conversationId: options.conversationId }),
    })
    return resolveChatReply(data, options)
}

export async function getChatReply(message: string, files: File[] = [], options: ChatRequestOptions = {}): Promise<ChatReply> {
    options.signal?.throwIfAborted()
    if (!message.trim() && !files.length) throw new Error('텍스트 또는 파일을 보내주세요.')
    if (message.length > 20_000 || files.length > 10 || files.some(file => file.size > 10 * 1024 * 1024)) throw new Error('텍스트는 20000자, 파일은 최대 10개·각 10MiB까지 보낼 수 있어요.')
    // multipart 경계와 Content-Type은 브라우저가 설정한다.
    const body = new FormData()
    body.set('message', message)
    if (options.conversationId) body.set('conversationId', options.conversationId)
    files.forEach(file => body.append('files', file))
    const data = await request('/chat', { method: 'POST', body, signal: options.signal, headers: files.length ? { Prefer: 'respond-async' } : undefined })
    return resolveChatReply(data, options)
}

// 재진입 시 파일을 재전송하지 않고 기존 작업만 조회한다.
export async function resumeChatReply(jobId: string, options: ChatRequestOptions = {}): Promise<ChatReply> {
    options.signal?.throwIfAborted()
    const data = await request(`/chat/jobs/${encodeURIComponent(jobId)}`, { signal: options.signal })
    if (!isObject(data) || data.jobId !== jobId) throw new Error('진행 응답의 작업 ID가 일치하지 않습니다.')
    return resolveChatReply(data, options)
}

async function resolveChatReply(initial: unknown, options: ChatRequestOptions): Promise<ChatReply> {
    let data = initial
    if (isObject(data) && typeof data.jobId === 'string') {
        const jobId = data.jobId
        options.onJobStarted?.(jobId)
        // 개별 HTTP 제한과 별개로 전체 폴링도 제한하며 초기화 시 대기까지 취소한다.
        const timeout = AbortSignal.timeout(30_000)
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
        try {
            while (true) {
                signal.throwIfAborted()
                if (!isObject(data) || data.jobId !== jobId) throw new Error('진행 응답 형식이 올바르지 않습니다.')
                if (data.status === 'failed') throw new Error(typeof data.error === 'string' ? data.error : '파일 분석을 완료하지 못했어요.')
                if (data.status === 'completed') { data = data.result; break }
                if (data.status !== 'running' || !isProgress(data.progress)) throw new Error('진행 응답 형식이 올바르지 않습니다.')
                options.onProgress?.(data.progress)
                await waitForPoll(signal)
                data = await request(`/chat/jobs/${encodeURIComponent(jobId)}`, { signal })
            }
        } catch (error) {
            if (timeout.aborted && !options.signal?.aborted) throw new Error('진행 상태 확인 시간이 초과됐어요. 서버에는 작업이 보관되어 있습니다.')
            throw error
        }
    }
    if (!isObject(data) || typeof data.analysisId !== 'string' || typeof data.conversationId !== 'string' || !isReply(data.reply)) throw new Error('서버 응답 형식을 확인할 수 없어요. 서버에서 처리됐을 수 있으니 확인해 주세요.')
    return { ...data.reply, analysisId: data.analysisId, conversationId: data.conversationId }
}

function isProgress(value: unknown): value is ChatProgress {
    return isObject(value) && typeof value.title === 'string' && Array.isArray(value.steps) && value.steps.length > 0
        && value.steps.every(step => isObject(step) && typeof step.label === 'string' && ['completed', 'working'].includes(String(step.status)))
}

function waitForPoll(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        signal.throwIfAborted()
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 400)
        signal.addEventListener('abort', abort, { once: true })
    })
}

// 로컬 서버 상태를 조회한다. 실제 AI API의 가용성을 의미하지 않는다.
export async function getChatServiceStatus(): Promise<ChatServiceStatus> {
    const data = await request('/health')
    if (!isObject(data) || !['ready', 'unavailable'].includes(String(data.status)) || typeof data.label !== 'string') throw new Error('상태 응답 형식이 올바르지 않습니다.')
    return { status: data.status as ChatServiceStatus['status'], label: data.label }
}

// 기본 /api는 Vite 프록시를 사용한다. 배포 환경에서는 API 기본 주소를 지정한다.
const apiBase = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '')

export async function request(path: string, init: RequestInit = {}): Promise<unknown> {
    const timeout = AbortSignal.timeout(30_000)
    try {
        const response = await fetch(`${apiBase}${path}`, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) throw new Error(isObject(data) && typeof data.error === 'string' ? data.error : '서버 요청을 처리하지 못했어요. API 서버 실행 상태를 확인해 주세요.')
        return data
    } catch (error) {
        if (init.signal?.aborted) throw error
        if (timeout.aborted) throw new Error('응답 시간이 초과됐어요. 서버에서 처리됐을 수 있으니 확인 후 다시 시도해 주세요.')
        if (error instanceof TypeError) throw new Error('API 서버에 연결하지 못했어요. 서버 실행 상태를 확인해 주세요.')
        throw error
    }
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

// 외부 JSON은 타입 선언과 별개로 카드에서 사용하는 필드를 확인한다.
export function isReply(value: unknown): value is ChatReply {
    if (!isObject(value) || typeof value.id !== 'string' || value.role !== 'assistant' || typeof value.content !== 'string') return false
    if (!['text-analysis', 'file-analysis', 'no-change', 'batch-analysis', 'link-analysis'].includes(String(value.kind))) return false
    if (value.sourceUrl !== undefined && (typeof value.sourceUrl !== 'string' || !isHttpUrl(value.sourceUrl))) return false
    const analysis = value.analysis
    if (!isObject(analysis) || !isObject(analysis.activity) || typeof analysis.activity.name !== 'string') return false
    if (analysis.activity.confidence !== null && !['high', 'medium', 'low'].includes(String(analysis.activity.confidence))) return false
    if (typeof analysis.materialType !== 'string' || typeof analysis.summary !== 'string' || !(analysis.stage === null || typeof analysis.stage === 'string')) return false
    if (analysis.noChangeMessage !== undefined && typeof analysis.noChangeMessage !== 'string') return false
    return Array.isArray(analysis.changes) && analysis.changes.every(change => isObject(change) && typeof change.before === 'string' && typeof change.after === 'string' && typeof change.category === 'string' && Array.isArray(change.evidence) && change.evidence.every(item => typeof item === 'string'))
        && Array.isArray(analysis.files) && analysis.files.every(file => isObject(file) && typeof file.name === 'string' && typeof file.materialType === 'string' && (file.previousVersion === null || typeof file.previousVersion === 'string'))
        && Array.isArray(analysis.groups) && analysis.groups.every(group => isObject(group) && typeof group.materialType === 'string' && Number.isInteger(group.count) && Number(group.count) > 0)
        && ['record-change', 'version-only', 'archive'].includes(String(analysis.suggestedSaveMode))
}
