import type { ActivityProposal, ChatProgress, ChatReply, ChatServiceStatus } from '../types/chat'

// 홈 분석은 FastAPI, 기록 저장·조회는 기존 백엔드로 요청한다.
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
    const data = await aiRequest('/chat/links', {
        method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: sourceUrl, conversationId: options.conversationId, requestId: crypto.randomUUID() }),
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
    body.set('requestId', crypto.randomUUID())
    if (options.conversationId) body.set('conversationId', options.conversationId)
    files.forEach(file => body.append('files', file))
    const data = await aiRequest('/chat', { method: 'POST', body, signal: options.signal,
        headers: { Prefer: files.length ? 'respond-async' : 'respond-sync' } }, files.length ? 30_000 : 150_000)
    // 텍스트 완료 응답에는 진행 콜백·폴링을 사용하지 않는다.
    if (!files.length) {
        if (isObject(data) && typeof data.jobId === 'string' && !['completed', 'failed'].includes(String(data.status))) throw new Error('텍스트 응답이 완료되지 않았어요. AI 서버를 최신 버전으로 재시작해 주세요.')
        return resolveChatReply(data, { ...options, onProgress: undefined })
    }
    return resolveChatReply(data, options)
}

// 재진입 시 파일을 재전송하지 않고 기존 작업만 조회한다.
export async function resumeChatReply(jobId: string, options: ChatRequestOptions = {}): Promise<ChatReply> {
    options.signal?.throwIfAborted()
    if (!jobId.startsWith('ai-')) throw Object.assign(
        new Error('이전 분석 작업을 복원할 수 없어요. 다시 전송해 주세요.'),
        { terminalChatJob: true, jobId },
    )
    const data = await aiRequest(`/chat/jobs/${encodeURIComponent(jobId)}`, { signal: options.signal })
    if (!isObject(data) || data.jobId !== jobId) throw new Error('진행 응답의 작업 ID가 일치하지 않습니다.')
    return resolveChatReply(data, options)
}

async function resolveChatReply(initial: unknown, options: ChatRequestOptions): Promise<ChatReply> {
    let data = initial
    if (isObject(data) && typeof data.jobId === 'string') {
        const jobId = data.jobId
        options.onJobStarted?.(jobId)
        // 개별 HTTP 제한과 별개로 전체 폴링도 제한하며 초기화 시 대기까지 취소한다.
        const timeout = AbortSignal.timeout(120_000)
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
        try {
            while (true) {
                signal.throwIfAborted()
                if (!isObject(data) || data.jobId !== jobId) throw new Error('진행 응답 형식이 올바르지 않습니다.')
                if (data.status === 'failed') throw Object.assign(
                    new Error(typeof data.error === 'string' ? data.error : '분석을 완료하지 못했어요.'),
                    { terminalChatJob: true, jobId, code: typeof data.code === 'string' ? data.code : undefined },
                )
                if (data.status === 'completed') { data = data.result; break }
                if (data.status !== 'running' || !isProgress(data.progress)) throw new Error('진행 응답 형식이 올바르지 않습니다.')
                options.onProgress?.(data.progress)
                await waitForPoll(signal)
                data = await aiRequest(`/chat/jobs/${encodeURIComponent(jobId)}`, { signal })
            }
        } catch (error) {
            if (timeout.aborted && !options.signal?.aborted) throw new Error('진행 상태 확인 시간이 초과됐어요. 서버에는 작업이 보관되어 있습니다.')
            throw error
        }
    }
    if (isObject(data) && typeof data.analysisId === 'string' && isObject(data.reply) && data.reply.kind === 'activity-update') {
        // AI가 만든 SQL/값을 클라이언트에서 실행하지 않고 서버에 보관된 완료 요청 ID만 전달한다.
        try {
            data = await request('/activities/apply-chat-update', { method: 'POST', signal: options.signal,
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ analysisId: data.analysisId }) })
        } catch (error) {
            // 확정 거절은 대기를 해제해 사용자가 다시 말할 수 있게 한다. 통신 실패는 작업 재조회로 확인한다.
            if (isObject(error) && [400, 404, 409, 422].includes(Number(error.status))) throw Object.assign(error, { terminalChatJob: true })
            throw error
        }
    }
    if (!isObject(data) || typeof data.analysisId !== 'string' || typeof data.conversationId !== 'string' || !isReply(data.reply)) throw new Error('서버 응답 형식을 확인할 수 없어요. 서버에서 처리됐을 수 있으니 확인해 주세요.')
    if (data.reply.updatedActivityId && typeof window !== 'undefined') window.dispatchEvent(new Event('1line:activities-changed'))
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

// 키·모델·DB 설정 상태를 조회한다. 이 요청 자체는 모델을 호출하지 않는다.
export async function getChatServiceStatus(): Promise<ChatServiceStatus> {
    const data = await aiRequest('/chat/health')
    if (!isObject(data) || !['ready', 'unavailable'].includes(String(data.status)) || typeof data.label !== 'string') throw new Error('상태 응답 형식이 올바르지 않습니다.')
    return { status: data.status as ChatServiceStatus['status'], label: data.label }
}

// 기본 /api는 Vite 프록시를 사용한다. 배포 환경에서는 API 기본 주소를 지정한다.
const apiBase = (import.meta.env?.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
const aiBase = (import.meta.env?.VITE_AI_API_BASE_URL || '/ai-api').replace(/\/$/, '')

function aiRequest(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<unknown> {
    return request(path, init, aiBase, timeoutMs)
}

export async function request(path: string, init: RequestInit = {}, base = apiBase, timeoutMs = 30_000): Promise<unknown> {
    const timeout = AbortSignal.timeout(timeoutMs)
    try {
        const response = await fetch(`${base}${path}`, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout })
        const data: unknown = await response.json().catch(() => null)
        if (!response.ok) throw Object.assign(new Error(isObject(data) && typeof data.error === 'string' ? data.error : '서버 요청을 처리하지 못했어요. API 서버 실행 상태를 확인해 주세요.'), { status: response.status })
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

// 확정 실패는 재조회해도 성공으로 바뀌지 않는다. 통신 실패·시간 초과와 구분한다.
export function isTerminalChatFailure(error: unknown): boolean {
    return isObject(error) && error.terminalChatJob === true
}

// 외부 JSON은 타입 선언과 별개로 카드에서 사용하는 필드를 확인한다.
export function isActivityProposal(value: unknown): value is ActivityProposal {
    if (!isObject(value) || typeof value.name !== 'string' || !value.name.trim()
        || !(value.confidence === null || ['high', 'medium', 'low'].includes(String(value.confidence)))) return false
    if (value.id !== undefined && value.id !== null && (typeof value.id !== 'string' || !value.id.trim())) return false
    if (value.match !== undefined && !['existing', 'new', 'unresolved'].includes(String(value.match))) return false
    if (value.match === 'existing' && !value.id || ['new', 'unresolved'].includes(String(value.match)) && value.id != null) return false
    for (const key of ['category', 'role', 'summary']) {
        if (value[key] !== undefined && value[key] !== null && (typeof value[key] !== 'string' || !value[key].trim())) return false
    }
    if (value.status !== undefined && value.status !== null && !['진행 중', '완료'].includes(String(value.status))) return false
    if (value.period !== undefined && value.period !== null) {
        if (!isObject(value.period)) return false
        for (const key of ['start', 'end']) {
            const date = value.period[key]
            if (date === null) continue
            if (typeof date !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?$/.test(date)) return false
            const day = date.length === 7 ? `${date}-01` : date
            const parsed = new Date(`${day}T00:00:00Z`)
            if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) return false
        }
        const { start, end } = value.period
        if (typeof start === 'string' && typeof end === 'string'
            && (start.slice(0, 7) > end.slice(0, 7) || start.length === 10 && end.length === 10 && start > end)) return false
    }
    return true
}

export function isReply(value: unknown): value is ChatReply {
    if (!isObject(value) || typeof value.id !== 'string' || value.role !== 'assistant' || typeof value.content !== 'string') return false
    if (value.activityCreated !== undefined && typeof value.activityCreated !== 'boolean') return false
    if (value.updatedActivityId !== undefined && (typeof value.updatedActivityId !== 'string' || !value.updatedActivityId)) return false
    if (value.kind === 'general') return value.analysis === null
    if (!['text-analysis', 'file-analysis', 'no-change', 'batch-analysis', 'link-analysis'].includes(String(value.kind))) return false
    if (value.sourceUrl !== undefined && (typeof value.sourceUrl !== 'string' || !isHttpUrl(value.sourceUrl))) return false
    const analysis = value.analysis
    if (!isObject(analysis) || !isActivityProposal(analysis.activity)) return false
    if (typeof analysis.materialType !== 'string' || typeof analysis.summary !== 'string' || !(analysis.stage === null || typeof analysis.stage === 'string')) return false
    if (analysis.noChangeMessage !== undefined && typeof analysis.noChangeMessage !== 'string') return false
    return Array.isArray(analysis.changes) && analysis.changes.every(change => isObject(change) && typeof change.before === 'string' && typeof change.after === 'string' && typeof change.category === 'string' && Array.isArray(change.evidence) && change.evidence.every(item => typeof item === 'string'))
        && Array.isArray(analysis.files) && analysis.files.every(file => isObject(file) && typeof file.name === 'string' && typeof file.materialType === 'string' && (file.previousVersion === null || typeof file.previousVersion === 'string'))
        && Array.isArray(analysis.groups) && analysis.groups.every(group => isObject(group) && typeof group.materialType === 'string' && Number.isInteger(group.count) && Number(group.count) > 0)
        && ['record-change', 'version-only', 'archive'].includes(String(analysis.suggestedSaveMode))
}
