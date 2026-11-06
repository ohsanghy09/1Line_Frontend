import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { stripTypeScriptTypes } from 'node:module'
import { createServer } from 'vite'
import { openDatabase } from '../api-server/src/database.js'

// 수동 통합 검사: 임시 DB·합성 자료를 실제 모델로 분석한다. 기본 2회, --extended/--journey는 추가 호출이다.
const root = fileURLToPath(new URL('../', import.meta.url))
const directory = await mkdtemp(path.join(tmpdir(), '1line-live-ai-'))
const databasePath = path.join(directory, 'test.db')
openDatabase(databasePath).close()
const children = []
const originalFetch = globalThis.fetch
let vite
async function freePort() {
    const server = net.createServer()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = server.address().port
    await new Promise(resolve => server.close(resolve))
    return port
}
function start(command, args, options) {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...options })
    children.push(child)
    let output = ''
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-4000) })
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-4000) })
    child.on('error', error => { output = error.message })
    child.startupOutput = () => output
    return child
}
async function ready(url, child) {
    for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error(`검증용 서버 시작 실패: ${child.startupOutput()}`)
        try { if ((await originalFetch(url)).ok) return } catch { /* 서버 시작 대기 */ }
        await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error('검증용 서버 시작 대기 초과')
}
try {
    const backendPort = await freePort()
    const aiPort = await freePort()
    const api = start(process.execPath, ['api-server/src/server.js'], { cwd: root, env: { ...process.env, PORT: String(backendPort), DB_PATH: databasePath, AI_API_BASE_URL: `http://127.0.0.1:${aiPort}` } })
    await ready(`http://127.0.0.1:${backendPort}/api/health`, api)
    const python = path.join(root, 'ai-api-server', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
    const ai = start(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(aiPort)], {
        cwd: path.join(root, 'ai-api-server'), env: { ...process.env, AI_DB_PATH: databasePath },
    })
    await ready(`http://127.0.0.1:${aiPort}/api/chat/health`, ai)
    vite = await createServer({ server: { host: '127.0.0.1', port: 0, proxy: {
        '/api': `http://127.0.0.1:${backendPort}`,
        '/ai-api': { target: `http://127.0.0.1:${aiPort}`, rewrite: value => value.replace(/^\/ai-api/, '/api') },
    } } })
    await vite.listen()
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`
    globalThis.fetch = (url, init) => originalFetch(new URL(url, base), init)
    const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
    const chatUrl = moduleUrl(stripTypeScriptTypes(await readFile(path.join(root, 'src/services/chat.ts'), 'utf8')))
    const chat = await import(chatUrl)
    const recordsSource = stripTypeScriptTypes(await readFile(path.join(root, 'src/services/records.ts'), 'utf8')).replace("from './chat'", `from '${chatUrl}'`)
    const records = await import(moduleUrl(recordsSource))
    assert.equal((await chat.getChatServiceStatus()).status, 'ready')
    assert.equal((await fetch('/api/chat', { method: 'POST' })).status, 410)
    assert.equal((await fetch('/')).status, 200)
    const conversationId = crypto.randomUUID()
    let firstJob
    const first = await chat.getChatReply('새로운 활동인 달빛도서관 북클럽을 시작했습니다. 기존 해커톤이나 연구와는 별개의 독서 모임입니다. 오늘은 첫 모임 일정만 정했고 중요한 변경은 없었습니다.', [], {
        conversationId, onJobStarted: id => { firstJob = id },
    })
    assert.ok(first.analysisId)
    assert.ok(firstJob.startsWith('ai-'))
    const activityId = first.analysis.activity.id
    assert.ok(activityId)
    assert.ok((await records.getActivities()).some(activity => activity.id === activityId))
    const firstSaved = await records.saveRecord(first, activityId)
    assert.equal(firstSaved.activityId, activityId)
    await assert.rejects(records.saveRecord(first, activityId), /이미 기록/)
    assert.equal((await chat.resumeChatReply(firstJob)).analysisId, first.analysisId)
    console.log('PASS: 실제 모델 → 활동 생성/연결 → 분석 초안 → 프론트 서비스 → 백엔드 확정 저장·중복 방지·작업 복원')

    const content = process.argv.includes('--journey')
        ? `${first.analysis.activity.name} 진행 회고입니다. 처음 준비할 때는 독서 토론 진행 경험이 없어 질문을 즉석에서 정했습니다. 이번에는 토론 진행법을 학습하고 사전 질문지를 직접 설계해 6명의 토론을 진행했습니다. 발언 순서와 시간을 조율해 이전 60분 걸리던 토론을 30분에 마쳤고 참여자 전원이 한 번 이상 의견을 냈습니다. 새로 배운 진행 방법을 실제 모임에 적용한 경험입니다.`
        : `${first.analysis.activity.name} 회의록입니다. 오늘은 첫 독서 모임의 다음 날짜를 확인했습니다. 기존 계획이나 역할에 변화는 없었습니다.`
    const bytes = new TextEncoder().encode(content)
    const fileReply = await chat.getChatReply(`${first.analysis.activity.name} 활동의 회의록입니다.`, [new File([bytes], '실제본문_회의록.txt', { type: 'text/plain' })], { conversationId })
    assert.equal(fileReply.analysis.activity.id, activityId)
    assert.equal(fileReply.analysis.files[0].name, '실제본문_회의록.txt')
    const saved = await records.saveRecord(fileReply, activityId)
    const changed = await records.updateRecord(saved.id, activityId, '검증 회의록')
    assert.equal(changed.reply.analysis.materialType, '검증 회의록')
    const detail = await (await fetch(`/api/archive/activities/${activityId}`)).json()
    const fileId = detail.folders.flatMap(folder => folder.files).find(file => file.originalFileId)?.originalFileId
    assert.ok(fileId)
    const downloaded = new Uint8Array(await (await fetch(`/api/files/${fileId}`)).arrayBuffer())
    assert.deepEqual(downloaded, bytes)
    console.log('PASS: 실제 파일 본문 분석 → 원본 보관 → 기록 저장·분류 수정 → 아카이브 조회·다운로드 바이트 일치')

    if (process.argv.includes('--journey')) {
        const journeySource = stripTypeScriptTypes(await readFile(path.join(root, 'src/services/journey.ts'), 'utf8')).replace("from './chat'", `from '${chatUrl}'`)
        const journey = await import(moduleUrl(journeySource))
        const before = await journey.getGrowthJourney()
        assert.equal(before.source, 'api')
        assert.equal(before.analysis.id, null)
        assert.deepEqual(before.events, [])
        const result = await journey.generateGrowthJourney()
        assert.ok(result.analysis.id)
        assert.equal(result.analysis.recordCount, 2)
        assert.equal(result.analysis.stale, false)
        assert.ok(result.summary.evidence.length)
        assert.ok(result.events.length > 0, '성장 근거가 있는 테스트 기록에서 이벤트를 확인한다.')
        const categoryIds = new Set(result.typeOptions.filter(option => option.value !== 'all').map(option => option.value))
        assert.ok(categoryIds.size > 0)
        assert.ok(result.typeOptions.filter(option => option.value !== 'all').every(option => option.icon && option.label))
        assert.ok(result.events.every(event => categoryIds.has(event.type)))
        assert.ok(result.badges.every(badge => badge.icon))
        assert.deepEqual(await journey.getGrowthJourney(), result)
        const context = await (await fetch('/ai-api/journey/context')).json()
        assert.equal(context.recordCount, 2)
        const ids = new Set(context.records.map(record => record.id))
        for (const item of [...result.summary.evidence, ...result.events.flatMap(event => event.evidence), ...result.badges.flatMap(badge => badge.evidence)]) {
            assert.ok(ids.has(item.recordId))
            const record = context.records.find(record => record.id === item.recordId)
            assert.ok([record.message, record.summary].some(value => value?.includes(item.quote)))
        }
        await records.updateRecord(changed.id, activityId, '갱신 필요 검사')
        const stale = await journey.getGrowthJourney()
        assert.equal(stale.analysis.stale, true)
        assert.equal(stale.analysis.id, result.analysis.id)
        console.log('PASS: 실제 성장 분석 → 확정 기록/근거 검증 → 백엔드 DB 저장 → 프론트 조회 → 기록 수정 후 갱신 필요')
    }

    if (process.argv.includes('--extended')) {
        const batch = await chat.getChatReply(`${first.analysis.activity.name} 자료 두 개입니다.`, [
            new File([content], '회의록1.txt', { type: 'text/plain' }),
            new File([content], '회의록2.txt', { type: 'text/plain' }),
        ], { conversationId })
        assert.equal(batch.kind, 'batch-analysis')
        assert.equal(batch.analysis.files.length, 2)
        assert.equal(batch.analysis.groups.reduce((sum, group) => sum + group.count, 0), 2)
        await records.saveRecord(batch, activityId)
        const link = await chat.getLinkReply('https://example.com', { conversationId })
        assert.equal(link.kind, 'link-analysis')
        assert.equal(link.sourceUrl, 'https://example.com')
        await records.saveRecord(link, activityId)
        console.log('PASS: 다중 파일 실제 분석·그룹 합계·저장, 공개 링크 실제 본문 수집·분석·저장')
    }
    console.log('PASS: 임시 DB 기반 개발 환경 통합 검증 완료. 기존 사용자 DB 변경 없음.')
} catch (error) {
    // data: 모듈의 긴 소스 URL이나 키를 포함할 수 있는 원본 공급자 로그는 출력하지 않는다.
    console.error(`FAIL: ${error.message}`)
    process.exitCode = 1
} finally {
    globalThis.fetch = originalFetch
    if (vite) await vite.close()
    for (const child of [...children].reverse()) {
        if (child.exitCode === null) {
            const closed = new Promise(resolve => child.once('exit', resolve))
            child.kill()
            await closed
        }
    }
    const cleanupTarget = path.resolve(directory)
    if (path.dirname(cleanupTarget) === path.resolve(tmpdir()) && path.basename(cleanupTarget).startsWith('1line-live-ai-')) {
        await rm(cleanupTarget, { recursive: true, force: true })
    } else {
        console.error('검증용 임시 경로 범위가 올바르지 않아 정리하지 않았습니다.')
        process.exitCode = 1
    }
}
