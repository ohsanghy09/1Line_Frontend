import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { activityMetadata, archiveQuerySchema, editSchema, linkSchema, replySchema, saveSchema } from '../src/validation.js'
import { journeySchema } from '../src/journey.js'
const [replyExample, linkExample] = JSON.parse(readFileSync(new URL('./chat-examples.json', import.meta.url), 'utf8'))

// 실제 검증 스키마를 읽기만 한다. 기존 입력·응답·목 데이터는 변경하지 않는다.
const json = schema => {
  const { $schema: _dialect, ...result } = z.toJSONSchema(schema, { io: 'input' })
  return result
}
const str = (description) => ({ type: 'string', ...(description ? { description } : {}) })
const ref = name => ({ $ref: `#/components/schemas/${name}` })
const arr = items => ({ type: 'array', items })
const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required })
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] })
const date = { type: 'string', format: 'date-time' }
const count = { type: 'integer', minimum: 0 }
const enumeration = values => ({ type: 'string', enum: values })
const media = (schema, example) => ({ 'application/json': { schema, ...(example === undefined ? {} : { example }) } })
const response = (schema, description = '성공', example) => ({ description, content: media(schema, example) })
const body = (schema, example) => ({ required: true, content: media(schema, example) })
const parameter = (name, description = '대상 ID') => ({ name, in: 'path', required: true, description, schema: str() })
const metadata = json(activityMetadata)

const activity = obj({ id: str(), title: str(), category: str(), status: enumeration(['진행 중', '완료', '미설정']), role: str(), period: str('표시용 기간 문자열'), summary: str(), updatedAt: nullable(date), materialsCount: count })
const material = obj({ id: str('실제 파일 ID 또는 record:... 자료 ID. 모든 자료 ID가 다운로드 ID는 아니다.'), name: str(), type: str(), uploadedAt: date, summary: str('현재 기록 단위 요약'), content: str(), sourceUrl: nullable(str()), summaryScope: { const: 'record' }, kind: enumeration(['file', 'text', 'link']), originalFileId: nullable(str()), recordId: str(), recordPosition: count, savedAt: date, updatedAt: date })
const eventBase = { id: str(), occurredAt: date, title: str(), evidenceFileIds: arr(str()), evidenceLabels: arr(str()), change: obj({ before: str(), after: str() }) }
const attachment = obj({ id: str(), name: str(), size: count })
const resultProperties = { analysisId: str(), conversationId: str(), message: str(), attachments: arr(ref('Attachment')), reply: ref('ChatReply'), createdAt: date }
const progress = obj({ title: str(), steps: arr(obj({ label: str(), status: enumeration(['completed', 'working']) })) })
const running = obj({ jobId: str(), status: { const: 'running' }, progress: ref('Progress'), pollAfterMs: { const: 400 }, analysisProvider: { const: 'mock' } })

export const schemas = {
  Error: obj({ error: str() }),
  ActivityMetadata: metadata,
  ActivityOption: obj({ id: str(), name: str(), ...metadata.properties }),
  ChatReply: { ...json(replySchema), description: '현재 화면용 결과. 분석은 목 응답이며 AI 모델·공급자는 미정. existing 매칭은 실제 ID가 필요하고 new/unresolved는 ID가 없어야 한다.' },
  ChatChange: json(replySchema.shape.analysis.shape.changes.element),
  Attachment: attachment,
  Progress: progress,
  AnalysisResult: obj(resultProperties),
  ChatCompleted: obj({ ...resultProperties, analysisProvider: { const: 'mock' } }),
  JobRunning: running,
  JobCompleted: obj({ jobId: str(), status: { const: 'completed' }, progress: ref('Progress'), analysisProvider: { const: 'mock' }, result: ref('AnalysisResult') }),
  JobFailed: obj({ jobId: str(), status: { const: 'failed' }, error: str(), analysisProvider: { const: 'mock' } }),
  SaveRecordRequest: {
    ...json(saveSchema),
    description: 'analysisId/reply 중 정확히 하나, activityId/newActivity 중 정확히 하나 필요. activityUpdates는 기존 activityId에만 허용. null 메타정보는 기존 값을 삭제하지 않는다.',
    allOf: [
      { oneOf: [{ required: ['analysisId'], not: { required: ['reply'] } }, { required: ['reply'], not: { required: ['analysisId'] } }] },
      { oneOf: [{ required: ['activityId'], not: { required: ['newActivity'] } }, { required: ['newActivity'], not: { required: ['activityId'] } }] },
      { anyOf: [{ not: { required: ['activityUpdates'] } }, { required: ['activityId'] }] },
    ],
  },
  EditRecordRequest: { ...json(editSchema), minProperties: 1, description: '프론트는 현재 activityId·materialType·선택 activityUpdates만 전송한다. 서버는 나머지 필드도 지원한다.' },
  LinkRequest: { ...json(linkSchema), description: 'HTTP/HTTPS URL, 사용자명·암호 포함 불가. 현재 페이지 본문 수집 없음.' },
  Record: obj({ id: str(), activityId: str(), analysisId: nullable(str()), message: str(), reply: ref('ChatReply'), createdAt: date, updatedAt: date }),
  ArchiveActivity: activity,
  Material: material,
  TimelineEvent: { oneOf: [obj({ ...eventBase, isTurningPoint: { const: false }, description: str() }), obj({ ...eventBase, isTurningPoint: { const: true }, before: str(), after: str(), reason: str() })] },
  Folder: obj({ id: str(), name: str(), materialsCount: count, files: arr(ref('Material')) }),
  ActivityDetail: obj({ ...activity.properties, folders: arr(ref('Folder')), timeline: arr(ref('TimelineEvent')) }),
  MaterialDetail: obj({ activityId: str(), file: ref('Material'), events: arr(ref('TimelineEvent')), versionHistory: arr(obj({ fileId: str(), version: str() })) }),
  HomeRecent: obj({ activities: arr(ref('ArchiveActivity')), records: arr(obj({ id: str(), recordId: str(), activityId: str(), activityName: str(), title: str(), materialType: str(), savedAt: date, kind: enumeration(['file', 'text', 'link']) })) }),
  Journey: { ...json(journeySchema), description: 'DB에 저장된 실제 AI 성장 분석. analysis는 분석 시각·분석 기록 수·현재 기록 수·stale을 표시한다. 이벤트 날짜는 근거 기록의 저장 월이며 evidence는 실제 기록 ID와 인용문이다.' },
}

const errorResponses = Object.fromEntries([400, 404, 409, 500].map(status => [status, response(ref('Error'), ({ 400: '입력 오류', 404: '대상 또는 경로 없음', 409: '미완료 분석·중복 저장·활동명 충돌', 500: '서버 오류' })[status])]))
function operation(tag, operationId, summary, schema, options = {}) {
  const { status = 200, description = '', example, errors = [500], ...rest } = options
  return { tags: [tag], operationId, summary, description, responses: { [status]: response(schema, '성공', example), ...Object.fromEntries(errors.map(code => [code, errorResponses[code]])) }, ...rest }
}
replyExample.id = 'reply-example-001'
linkExample.id = 'reply-link-example-001'
schemas.ChatReply.examples = [replyExample, linkExample]
const emptyJourneyExample = { source: 'api', summary: { title: '아직 성장 분석이 없어요.', description: '기록 저장 후 분석해 주세요.' }, badges: [], typeOptions: [{ value: 'all', label: '전체' }], axisOptions: [{ value: 'all', label: '전체 분야' }], events: [], analysis: { id: null, generatedAt: null, stale: false, recordCount: 0, currentRecordCount: 0, model: null, promptVersion: null } }
schemas.Journey.examples = [emptyJourneyExample]

export const backendSpec = {
  openapi: '3.1.0',
  info: {
    title: '1Line 백엔드 API · 현재 개발 서버 계약', version: '0.1.0-draft',
    description: '현재 코드의 요청·응답값을 유지한 협의용 명세입니다. 실제 협업 백엔드의 최종 명세가 아닙니다. 분석·진행은 목 응답이고 AI 모델·공급자는 미정입니다. 인증·사용자별 권한은 미구현입니다. 이 문서는 DB·AI 연결 없이 표시되며 API 실행을 제공하지 않습니다. AI 입력·출력은 상단 AI 문서를 선택해 별도로 확인합니다.',
  },
  servers: [{ url: 'http://127.0.0.1:3001', description: '현재 로컬 개발 API (별도 실행)' }],
  tags: ['상태', '활동', '홈', '분석 접수·목 응답', '기록', '아카이브', '성장 분석 조회', '보조 API'].map(name => ({ name })),
  paths: {
    '/api/health': { get: operation('상태', 'health', '개발 서버 준비 상태', obj({ status: { const: 'ready' }, label: str(), analysisProvider: { const: 'mock' } }), { description: 'ready는 고정 응답이며 실제 AI 상태 확인이 아닙니다.' }) },
    '/api/activities': { get: operation('활동', 'activities', '활동 선택지 조회', arr(ref('ActivityOption'))) },
    '/api/home/recent': { get: operation('홈', 'recent', '최근 활동·자료 조회', ref('HomeRecent'), { description: '각 최대 3개. 활동은 변경순, 자료는 최초 확정 저장순. 다중 파일은 같은 recordId가 반복될 수 있습니다.' }) },
    '/api/journey': { get: operation('성장 분석 조회', 'journey', '저장된 성장 분석 조회', ref('Journey'), { description: '최신 저장 결과와 갱신 필요 상태를 조회한다. 모델 호출 없음. 필터는 프론트에서 처리한다.', example: emptyJourneyExample }) },
    '/api/journey/analyze': { post: { tags: ['성장 분석 조회'], operationId: 'generateJourney', summary: '확정 기록으로 실제 성장 분석·결과 저장', description: 'FastAPI 실제 AI 분석을 호출한 뒤 근거·스냅샷을 검증하고 결과를 저장한다. 기록 100개·문맥 250000자까지 지원한다. 기존 홈 기록·Timeline은 변경하지 않는다.', responses: { 200: response(ref('Journey')), ...Object.fromEntries([409, 422, 429, 502, 503, 504].map(code => [code, response(ref('Error'), '분석 실패·진행 중·기록 변경·문맥 한도·공급자 오류')])) } } },
    '/api/archive/activities': { get: operation('아카이브', 'archiveList', '활동 검색·필터·정렬', obj({ items: arr(ref('ArchiveActivity')), total: count }), { description: 'total은 조건 적용 전 전체 활동 수. q/category/status는 AND. oldest도 업데이트 기준. 파일 내부 본문 검색·페이지네이션 없음.', parameters: Object.entries(json(archiveQuerySchema).properties).map(([name, schema]) => ({ name, in: 'query', required: false, schema })) }) },
    '/api/archive/activities/{id}': { get: operation('아카이브', 'archiveDetail', '활동 상세·분류 폴더·Timeline', ref('ActivityDetail'), { parameters: [parameter('id')], errors: [404, 500], description: '확정 저장 기록만 조회. 폴더는 자료 유형 그룹. 표시용 날짜 라벨은 프론트 계산.' }) },
    '/api/archive/activities/{id}/materials/{fileId}': { get: operation('아카이브', 'materialDetail', '자료 상세 패널 데이터', ref('MaterialDetail'), { parameters: [parameter('id', '활동 ID'), parameter('fileId', '자료 ID')], errors: [404, 500], description: '해당 활동 내 자료만 조회. versionHistory는 현재 빈 배열. 요약은 기록 단위. 파일 본문 추출 없음.' }) },
    '/api/chat': { post: operation('분석 접수·목 응답', 'chat', '텍스트·파일 접수 및 목 분석', ref('ChatCompleted'), {
      status: 201, errors: [400, 500], description: '분석 초안·원본 파일 보관이며 확정 기록 저장은 별도. message 또는 파일 필요. 파일 + Prefer: respond-async일 때만 202. mode는 개발 목 제어값. 각 파일 최대 10MiB.',
      parameters: [{ name: 'Prefer', in: 'header', required: false, schema: { type: 'string', enum: ['respond-async'] }, description: '파일 비동기 요청 시 사용' }],
      requestBody: { required: true, content: { 'multipart/form-data': { schema: obj({ message: { type: 'string', maxLength: 20000, default: '' }, files: { type: 'array', maxItems: 10, items: { type: 'string', format: 'binary' } }, conversationId: { type: 'string', minLength: 1, maxLength: 200 }, mode: { type: 'string', enum: ['change', 'no-change'], default: 'no-change' } }, []) } } },
      responses: { 201: response(ref('ChatCompleted'), '동기 완료', { analysisId: 'analysis-example-001', conversationId: 'conversation-example-001', message: '사용자 인터뷰를 진행했습니다.', attachments: [], reply: replyExample, createdAt: '2026-11-05T00:00:00.000Z', analysisProvider: 'mock' }), 202: response(ref('JobRunning'), '파일 비동기 접수'), 400: errorResponses[400], 500: errorResponses[500] },
    }) },
    '/api/chat/links': { post: operation('분석 접수·목 응답', 'link', '링크 접수·목 분석 작업 생성', ref('JobRunning'), { status: 202, errors: [400, 500], requestBody: body(ref('LinkRequest'), { url: 'https://example.com' }), description: '실제 웹페이지 수집은 하지 않습니다.' }) },
    '/api/chat/jobs/{id}': { get: operation('분석 접수·목 응답', 'job', '작업 진행·완료·실패 조회', { oneOf: [ref('JobRunning'), ref('JobCompleted'), ref('JobFailed')] }, { parameters: [parameter('id', '작업 ID')], errors: [404, 500], description: '실패도 HTTP 200 + status=failed. 현재 진행은 시간 기반 목 단계. 400ms 순차 조회, 프론트 전체 폴링 제한 30초.' }) },
    '/api/records': { post: operation('기록', 'saveRecord', '기록 확정 저장', ref('Record'), { status: 201, errors: [400, 404, 409, 500], requestBody: body(ref('SaveRecordRequest'), { analysisId: 'analysis-example-001', activityId: 'activity-example-001', classification: { materialType: '사용자 경험 기록' } }), description: 'changes가 있으면 이벤트 함께 저장, 없으면 미생성. 현재 Turning Point는 false. 직접 reply 저장 허용 여부는 정식 연동 협의 대상.' }) },
    '/api/records/{id}': {
      get: operation('기록', 'record', '기록 조회', ref('Record'), { parameters: [parameter('id')], errors: [404, 500] }),
      patch: operation('기록', 'editRecord', '기록 수정·활동 이동', ref('Record'), { parameters: [parameter('id')], errors: [400, 404, 500], requestBody: body(ref('EditRecordRequest'), { activityId: 'activity-example-001', materialType: '회의록' }), description: 'changes 수정은 이벤트 삭제 후 재생성, []는 제거. null 활동 메타정보는 기존 값 유지.' }),
    },
    '/api/activities/{id}/records': { get: operation('기록', 'activityRecords', '활동의 확정 기록 조회', arr(ref('Record')), { parameters: [parameter('id')], errors: [404, 500] }) },
    '/api/activities/{id}/timeline': { get: operation('보조 API', 'rawTimeline', '원시 Timeline 조회', arr(obj({ id: str(), recordId: str(), change: ref('ChatChange'), isTurningPoint: { type: 'boolean' }, createdAt: date })), { parameters: [parameter('id')], errors: [404, 500], description: '현재 화면은 이 API 대신 활동 상세의 변환된 timeline을 사용합니다.' }) },
    '/api/conversations/{id}/messages': { get: operation('보조 API', 'messages', '대화 초안 목록', arr(obj({ analysisId: str(), message: str(), reply: ref('ChatReply'), createdAt: date, attachments: arr(ref('Attachment')) })), { parameters: [parameter('id')], description: '현재 화면 복원은 sessionStorage 사용. 알 수 없는 대화는 빈 배열.' }) },
    '/api/files/{id}': { get: { tags: ['보조 API'], operationId: 'download', summary: '실제 원본 파일 다운로드', description: '자료 패널 UI 미연결. 합성 자료 ID가 아닌 실제 파일 ID만 사용.', parameters: [parameter('id')], responses: { 200: { description: '파일 원본', headers: { 'Content-Disposition': { description: 'attachment와 원본 파일명', schema: str() } }, content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, 404: errorResponses[404], 500: errorResponses[500] } } },
  },
  components: { schemas },
}

// AI 모델·경로는 미정이다. 기존 Markdown 제안값만 스키마로 표현하고 실행 가능한 경로를 만들지 않는다.
const materialContext = obj({ id: str(), recordId: str(), activityId: str(), name: str(), materialType: str(), content: str(), sourceUrl: str() }, ['id', 'recordId', 'activityId', 'name'])
const recordContext = obj({ id: str(), activityId: str(), message: str(), summary: str(), materials: arr(ref('MaterialContext')) }, ['id', 'activityId'])
const activityContext = obj({ id: str(), name: str(), ...metadata.properties }, ['id', 'name'])
const aiContractDraft = {
  openapi: '3.1.0',
  info: { title: '1Line AI 입력·출력 · 모델 미정', version: '0.1.0-draft', description: 'AI 모델·공급자·주소·인증·호출 주체는 미정입니다. 기존 AI_API_계약.md의 값과 현재 화면용 결과를 그대로 문서화합니다. 아래 Schemas에서 요청·응답을 확인하세요. 미구현 경로를 만들어 확정 API처럼 표시하지 않으므로 실행할 operation은 없습니다. HomeAnalysisRequest·GrowthAnalysisRequest는 기존 요청 제안, ChatReply·Journey는 현재 화면용 응답입니다. 파일 내용 전달·문맥·분류 등 기존 미확정 항목은 그대로 남깁니다.' },
  paths: {},
  components: { schemas: {
    HomeAnalysisRequest: { ...obj({ requestId: str(), conversationId: str(), input: obj({ kind: enumeration(['text', 'files', 'link']), message: str(), files: arr(ref('FileInput')), url: str(), linkContent: str() }, ['kind']), context: obj({ activities: arr(ref('ActivityContext')), records: arr(ref('RecordContext')), messages: { type: 'array', items: {}, description: '기존 문서에서 역할·내용·시각 상세 계약 미정' } }, []) }, ['requestId', 'input']), description: '기존 제안. text는 message, files는 1개 이상 files, link는 url 필요. 비교·매칭 시 context 필요. 파일 본문 전달 방식은 미정.', examples: [{ requestId: 'request-example-001', input: { kind: 'text', message: '사용자 인터뷰를 반영해 기능 기획을 수정했습니다.' }, context: { activities: [{ id: 'activity-example-001', name: '예시 프로젝트' }], records: [] } }] },
    GrowthAnalysisRequest: { ...obj({ requestId: str(), context: obj({ activities: arr(ref('ActivityContext')), records: arr(ref('RecordContext')), materials: arr(ref('MaterialContext')) }), scope: { type: 'object', description: '기존 제안: 전체/기간/활동 범위. 상세 필드 미정' }, classification: { type: 'object', description: '기존 제안: 성장 유형·분야, 상세 필드 미정' } }, ['requestId', 'context']), description: '기존 제안. 확정 저장 기록만 포함하며 실제 요청 API는 아직 없습니다.' },
    FileInput: { ...obj({ id: str(), name: str(), mimeType: str(), size: { type: 'number' } }), description: '기존 필드 유지. 원본·임시 URL·추출문 중 본문 전달 방식 미정. 파일명만으로 본문을 분석하지 않습니다.' },
    ActivityContext: activityContext, RecordContext: recordContext, MaterialContext: materialContext,
    ChatReply: schemas.ChatReply, Journey: schemas.Journey,
  } },
}

// 실제 FastAPI 스키마 스냅샷을 사용한다. 생성은 ai-api-server/scripts/export_openapi.py.
const liveAiSpec = JSON.parse(readFileSync(new URL('./ai-openapi.json', import.meta.url), 'utf8'))
export const aiSpec = {
  ...liveAiSpec,
  info: { ...liveAiSpec.info, title: '1Line AI API · FastAPI / OpenAI',
    description: '홈 텍스트·파일·링크와 Growth Journey 실제 분석 API입니다. 신규 활동 생성은 AI 서버, 기록·성장 분석 결과 확정 저장은 백엔드가 담당합니다. 프롬프트는 app/prompts/home.md와 journey.md입니다. GrowthAnalysisRequest는 이전 초안이며 실제 성장 분석은 /api/analyze/journey를 사용합니다.' },
  components: { schemas: { ...aiContractDraft.components.schemas, ...liveAiSpec.components.schemas } },
}
backendSpec.info.description = '기록·자료 저장·수정·조회 API입니다. 홈·성장 분석은 FastAPI에서 처리하며 백엔드는 성장 결과를 검증해 저장합니다. 이전 백엔드 홈 분석 접수와 작업 조회는 항상 410입니다.'
backendSpec.paths['/api/health'].get.responses[200].content['application/json'].schema.properties.analysisProvider = { const: 'external' }
schemas.ChatReply.description = '실제 홈 카드 응답과 저장 검증 구조. 생성 완료된 신규 활동도 실제 ID와 match=existing으로 반환합니다. new/unresolved 후보는 ID가 없습니다.'
for (const route of ['/api/chat', '/api/chat/links']) {
  const operation = backendSpec.paths[route].post
  operation.deprecated = true
  operation.summary = '이전 분석 접수 — FastAPI로 이관'
  operation.description = '실제 개발 서버에서는 410을 반환합니다. AI 문서의 같은 경로를 사용하세요. 이전 목 계약은 회귀 테스트 전용입니다.'
  operation.responses = { 410: response(ref('Error'), '분석 접수는 FastAPI로 이관') }
}
const legacyJob = backendSpec.paths['/api/chat/jobs/{id}'].get
legacyJob.deprecated = true
legacyJob.summary = '이전 분석 진행 조회 — FastAPI로 이관'
legacyJob.description = 'FastAPI AI 서버의 작업 조회 경로를 사용하세요.'
legacyJob.responses = { 410: response(ref('Error'), '분석 진행 조회는 FastAPI로 이관') }
