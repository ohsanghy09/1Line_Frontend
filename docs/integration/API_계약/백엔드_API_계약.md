# 백엔드 API 요청·응답 계약

최신 홈 연동: 분석 접수는 FastAPI로 이관했으며 아래 백엔드 POST `/api/chat`, `/api/chat/links`는 기본 410이다. 새 분석은 ai_chat_jobs가 completed인 경우에만 POST `/api/records`에서 확정 저장한다. 기존 기록·자료 조회와 분류 수정은 유지한다. [최신 기능 흐름·명세](../../../ai-api-server/docs/홈_실제_AI_연동.md)를 참고한다. 이전 목 접수 계약은 명시적인 테스트용 합성 입력에서만 사용한다.

작성일: 2026-11-05. 상태: 협의용 초안. [공통 전제·미확정 항목](문서_안내.md)을 먼저 읽는다.

## 적용 기준

이 문서의 경로·상태 코드·필드는 **현재 로컬 개발 서버 구현**이다. 정식 백엔드의 최종 명세는 아니다. 2026-11-06 사용자가 확정한 실제 구현 방향은 홈 분석의 프론트→AI 서비스 직접 요청, 프론트→백엔드의 결과·자료 저장, 백엔드에서 나의 발자국·Timeline·Journey 조회다. Journey 분석 생성·저장은 백엔드·AI가 담당한다. 아래 로컬 분석 접수 API를 최종 홈 분석 경로로 고정하지 않는다.

- 기본 주소는 `VITE_API_BASE_URL` 또는 `/api`다. 개발 프록시는 `http://127.0.0.1:3001`이다.
- 별도 표기가 없으면 JSON 요청·응답이다. GET은 본문 없이 경로·쿼리로 받는다.
- `필수`는 현재 요청/응답 기준, `선택`은 생략 가능, `null 허용`은 값 자체가 null일 수 있다는 뜻이다.
- 목록 없음은 빈 배열이다. 조회 실패를 빈 성공이나 목 데이터로 대체하지 않는다.
- 사용자 인증·권한은 현재 미구현이다. 아래 요청에 userId가 없다고 공용 데이터로 운영하는 계약은 아니다.

## 공통 데이터

### 활동 메타정보 `ActivityMetadata`

| 필드 | 타입 | 필수 여부·의미 |
| --- | --- | --- |
| category | string 또는 null | 객체에 포함 시 필수. 활동 유형 |
| status | `진행 중` / `완료` 또는 null | 객체에 포함 시 필수 |
| role | string 또는 null | 객체에 포함 시 필수. 사용자 역할 |
| period | `{start: string 또는 null, end: string 또는 null}` 또는 null | 객체에 포함 시 필수. 날짜는 YYYY-MM 또는 YYYY-MM-DD |
| summary | string 또는 null | 객체에 포함 시 필수. 활동 전체 요약 |

`ActivityMetadata` 객체를 보낼 때 위 5개 키를 모두 포함한다. `newActivity`는 여기에 필수 `name: string`을 추가한다. 현재 기존 활동 적용에서 null은 기존 값을 지우지 않는다. 명시적인 값 삭제 계약은 별도 협의가 필요하다.

### 활동 선택지 `ActivityOption`

`{id: string, name: string, category, status, role, period, summary}`. 메타정보 5개는 위와 같이 null을 허용한다. 화면 목록용 `title`, 표시 문자열 `period`와 구분한다.

### 저장 기록 `Record`

| 필드 | 타입 | 필수 여부·의미 |
| --- | --- | --- |
| id / activityId | string | 필수. 기록·활동 ID |
| analysisId | string 또는 null | 필수. 원본 분석 초안 연결 |
| message | string | 필수. 실제 입력 글 또는 URL |
| reply | ChatReply | 필수. [AI 계약의 화면용 분석 결과](AI_API_계약.md#홈-분석-결과의-화면용-구조) |
| createdAt / updatedAt | string | 필수. 서버가 발급한 ISO 시각 |

## 1. 준비 상태·활동 선택지

| API | 요청받는 값 | 반환값 |
| --- | --- | --- |
| GET `/api/health` | 없음 | `{status: "ready", label: string, analysisProvider: "mock"}` |
| GET `/api/activities` | 없음 | `ActivityOption[]` |

성공은 200이다. health의 ready는 서버 고정값이며 실제 AI 가용성을 확인한 결과가 아니다.

## 2. 분석 접수·작업 조회 — 현재 서버의 결합 경계

현재 서버가 입력 보관·작업 생성·목 분석을 함께 처리한다. 아래 계약을 AI 서비스 경로로 그대로 확정하지 않는다. 실제 AI 입력·결과 요구사항은 [AI 계약](AI_API_계약.md)에서 별도로 정의한다.

### POST `/api/chat`

요청은 `multipart/form-data`다. Content-Type의 boundary는 브라우저가 설정한다.

| 요청 필드 | 타입 | 필수 여부·제약 |
| --- | --- | --- |
| message | string | 선택, 기본 빈 문자열. 최대 20,000자. 글 또는 파일 중 하나는 필요 |
| files | File[] | 선택. 같은 키로 반복 첨부, 최대 10개·각 10MiB |
| conversationId | string | 선택. 생략 시 서버 발급, 최대 200자 |
| mode | `change` / `no-change` | 선택. 기본 no-change. 개발 목 제어값이며 일반 프론트는 보내지 않음 |

파일이 있을 때 `Prefer: respond-async` 헤더로 비동기를 요청한다. 텍스트 전용 또는 비동기를 요청하지 않은 경우 201로 완료 응답을 반환한다.

| 완료 응답 필드 | 타입 | 의미 |
| --- | --- | --- |
| analysisId / conversationId | string | 필수. 분석 초안·대화 ID |
| message | string | 필수. 접수한 입력 |
| attachments | `{id: string, name: string, size: number}[]` | 필수. 실제 저장 파일, size는 byte |
| reply | ChatReply | 필수. 현재는 목 분석 |
| createdAt | string | 필수. ISO 시각 |
| analysisProvider | `mock` | 필수. 현재 공급자 |

비동기 접수는 202로 `{jobId, status, progress, pollAfterMs: 400, analysisProvider: "mock"}`를 반환한다.

### POST `/api/chat/links`

| 요청 필드 | 타입 | 필수 여부·제약 |
| --- | --- | --- |
| url | string | 필수. HTTP/HTTPS, 최대 4,096자. URL 내 사용자명·암호 불허 |
| conversationId | string | 선택. 생략 시 서버 발급, 최대 200자 |

응답은 위와 같은 202 비동기 접수다. 현재 URL을 보관하지만 페이지 내용 수집은 하지 않는다.

### GET `/api/chat/jobs/:id`

경로 `id: string`은 필수 작업 ID다. 성공 200이며 상태별 응답은 다음과 같다.

| 상태 | 필수 응답 필드 |
| --- | --- |
| running | `jobId: string`, `status: "running"`, `progress`, `pollAfterMs: 400`, `analysisProvider: "mock"` |
| completed | `jobId: string`, `status: "completed"`, `progress`, `analysisProvider: "mock"`, `result` |
| failed | `jobId: string`, `status: "failed"`, `error: string`, `analysisProvider: "mock"` |

`progress = {title: string, steps: {label: string, status: "completed" | "working"}[]}`다. 완료 `result`는 완료 응답의 `analysisId`, `conversationId`, `message`, `attachments`, `reply`, `createdAt`이며 result 내부에는 analysisProvider가 없다.

현재 진행은 시간 기반 목 진행이다. 프론트는 400ms 간격 조회·전체 폴링 30초 제한을 사용한다. 실제 처리 시간·취소·재개·실패 상태 계약은 협의 대상이다.

## 3. 기록 확정 저장

### POST `/api/records`

| 요청 필드 | 타입 | 필수 여부·의미 |
| --- | --- | --- |
| analysisId | string | reply와 정확히 하나 필수. 현재 보관된 분석 초안 |
| reply | ChatReply | analysisId와 정확히 하나 필수. 현재 서버는 직접 결과 저장도 허용 |
| activityId | string | newActivity와 정확히 하나 필수. 기존 활동 |
| newActivity | ActivityMetadata + `{name: string}` | activityId와 정확히 하나 필수. 확인한 새 활동 |
| activityUpdates | ActivityMetadata | 선택. 기존 활동 ID가 있을 때만 사용 |
| classification | `{materialType: string}` | 선택. 사용자가 확인한 자료 유형 |
| message | string | 선택, 기본 빈 문자열·최대 20,000자. analysisId 사용 시 서버 초안 입력을 사용 |

성공 201: `Record`를 반환한다. 분석 초안 사용 시 서버가 초안의 reply·입력을 읽어 원본 파일 연결을 유지한다. 사용자 분류·활동 선택을 적용하고 기록과 변화 이벤트를 트랜잭션으로 저장한다.

```json
{
  "analysisId": "analysis-example-001",
  "activityId": "activity-example-001",
  "classification": { "materialType": "사용자 경험 기록" }
}
```

- changes가 비어 있으면 이벤트를 생성하지 않는다. 현재 생성 이벤트의 Turning Point는 false다.
- 분석 미완료·동일 분석 중복 저장·같은 이름의 신규 활동은 409다. 없는 분석·활동은 404다.
- `reply` 직접 제출은 현재 개발 서버 기능이다. 프론트가 AI 서비스를 직접 호출할 경우에도 이 방식을 그대로 허용할지는 미확정이다. 분석 소유권·결과 검증·원본 파일 연결 계약이 필요하다.

## 4. 저장 기록 수정·조회

### PATCH `/api/records/:id`

경로 `id: string` 필수. 아래 필드는 모두 선택이지만 최소 한 개는 필요하다.

| 요청 필드 | 타입 | 의미 |
| --- | --- | --- |
| activityId | string | 이동할 기존 활동 |
| materialType | string | 기록 내 자료 유형 변경 |
| activityUpdates | ActivityMetadata | 기존 활동 정보의 명시적 적용 |
| summary / content | string | 기록 요약·응답 문구 수정 |
| changes | `{before: string, after: string, category: string, evidence: string[]}[]` | 변화 교체, 빈 배열은 이벤트 제거 |

성공 200: `Record`. 현재 일반 프론트 `updateRecord()`는 activityId·materialType·선택 activityUpdates만 보낸다. summary·content·changes는 서버 지원 범위다. changes 수정 시 이벤트를 삭제 후 재생성하므로 최종 이벤트 ID 보존 정책은 별도 합의한다.

| 조회 API | 요청받는 값 | 성공 200 반환값 |
| --- | --- | --- |
| GET `/api/records/:id` | 기록 ID | Record |
| GET `/api/activities/:id/records` | 활동 ID | Record[] |

현재 삭제 API는 없다.

## 5. 아카이브 목록·상세·자료

### 목록 요청

GET `/api/archive/activities`

| 쿼리 | 타입 | 필수 여부·기본값 |
| --- | --- | --- |
| q | string | 선택, 빈 문자열. 최대 500자 |
| category | string | 선택, all. 화면은 all·해커톤·전공수업·프로젝트·공모전 사용 |
| status | `all` / `진행 중` / `완료` | 선택, all |
| sort | `recent` / `materials` / `oldest` | 선택, recent |

성공 200: `{items: ArchiveActivity[], total: number}`. total은 조건 적용 전 전체 활동 수다. 검색·유형·상태는 AND, 정렬은 서버 처리다. 페이지네이션은 없다. 검색 대상은 활동·자료명·입력 글/URL·저장 요약이며 파일 내부 본문은 제외한다.

### 조회용 객체

아래는 프론트가 사용하는 주요 필수 필드다. 현재 서버의 추가 필드는 다음 단락에 별도로 적는다. 표시용 `updatedAtLabel`, `uploadedAtLabel`, `dateLabel`, `savedAtLabel`은 프론트에서 계산하며 API 필드가 아니다.

| 객체 | 필드·타입 |
| --- | --- |
| ArchiveActivity | `id`, `title`, `category`, `role`, `period`, `summary`: string. `status`: 진행 중/완료/미설정. `materialsCount`: 0 이상 정수. `updatedAt`: ISO string 또는 null |
| Folder | `id`, `name`: string. `materialsCount`: 0 이상 정수. `files`: Material[] |
| Material | `id`, `name`, `type`, `summary`: string. `uploadedAt`: ISO string. 선택 `content`: string, `sourceUrl`: string 또는 null, `summaryScope`: record, `version`: string |
| Timeline 공통 | `id`, `title`: string. `occurredAt`: ISO string. `evidenceFileIds`: string[]. 선택 `evidenceLabels`: string[], `change`: {before: string, after: string} |
| 일반 Timeline | 공통 필드 + `isTurningPoint: false`, `description: string` |
| Turning Point | 공통 필드 + `isTurningPoint: true`, `before`, `after`, `reason`: string |

현재 서버 Material은 추가로 `kind: file/text/link`, `originalFileId: string 또는 null`, `recordId: string`, `recordPosition: number`, `savedAt`, `updatedAt`: ISO string을 반환한다. content·sourceUrl·summaryScope도 현재 서버는 포함한다. 프론트 검증에서 선택인 것과 서버가 현재 반환하는 범위를 구분한다.

| API | 필수 경로값 | 성공 200 반환값 |
| --- | --- | --- |
| GET `/api/archive/activities/:id` | 활동 ID | ArchiveActivity + `{folders: Folder[], timeline: Timeline[]}` |
| GET `/api/archive/activities/:id/materials/:fileId` | 활동·자료 ID | `{activityId: string, file: Material, events: Timeline[], versionHistory: {fileId: string, version: string}[]}` |

- 자료 수는 확정 파일 수 + 파일 없는 텍스트/링크 기록 수다. 미저장 초안은 제외한다.
- 폴더는 현재 자료 유형별 그룹이며 폴더 CRUD는 없다.
- 자료 ID는 실제 파일 ID 또는 `record:...` 합성 ID일 수 있다. 자료 ID를 모두 다운로드 API의 파일 ID로 사용하면 안 된다.
- 요약은 현재 기록 단위다. 다중 파일도 공유할 수 있다. versionHistory는 현재 빈 배열이다.
- 자료는 해당 활동 안에서만 조회한다. 근거는 같은 기록 내 유일하게 해결되는 이름만 ID로 연결한다. 실제 ID 기반 근거 계약은 후속이다.
- 없는 활동·자료는 404다. 활동 이동 후 예전 자료 주소도 404다.

### 별도 Timeline API

GET `/api/activities/:id/timeline` → `{id: string, recordId: string, change: ChatChange, isTurningPoint: boolean, createdAt: string}[]`.

현재 화면은 이 API 대신 활동 상세의 변환된 timeline을 사용한다. 두 응답 구조를 같은 것으로 취급하지 않는다.

## 6. 홈 최근 목록

GET `/api/home/recent`. 요청값 없음. 성공 200:

- `activities: ArchiveActivity[]`: 최대 3개, 활동 변경 시각순.
- `records: RecentMaterial[]`: 최대 3개, 최초 확정 저장순. 다중 파일 기록은 자료별 항목이므로 같은 recordId가 반복될 수 있다.
- RecentMaterial 필수 필드: `id`, `recordId`, `activityId`, `activityName`, `title`, `materialType`, `savedAt`: string. `kind`: file/text/link. savedAt은 ISO 시각이다.

저장·수정 성공 후 프론트가 재조회한다. 서버 실시간 구독은 없다.

## 7. 성장 분석 결과 조회

GET `/api/journey`. 요청값 없음. 성공 200: [AI 계약의 Journey 화면용 결과](AI_API_계약.md#성장-분석-결과의-화면용-구조).

현재는 서버 목 응답 조회이며 DB·AI 분석 실행·결과 저장은 없다. 프론트 필터 변경은 재요청하지 않는다. 확정된 실제 구현 방향은 백엔드·AI가 생성·저장한 결과를 프론트가 백엔드에서 조회하는 것이다. 분석 실행·갱신 시점은 협의가 필요하며 GET 조회를 분석 실행 API로 간주하지 않는다.

## 8. 서버 지원 보조 API

| API | 요청값 | 성공 200 응답·현재 사용 여부 |
| --- | --- | --- |
| GET `/api/conversations/:id/messages` | 대화 ID | `{analysisId, message, reply, createdAt, attachments}[]`. 현재 화면 복원은 sessionStorage 사용 |
| GET `/api/files/:id` | 실제 파일 ID | 원본 바이너리, attachment 헤더. 자료 패널 다운로드 UI에는 미연결 |

대화 응답의 analysisId·message·createdAt은 string, reply는 ChatReply, attachments는 `{id: string, name: string, size: number}[]`다.

## 오류·실제 연동 협의

현재 오류 본문은 `{error: string}`이다. 입력·스키마·업로드 제한 오류는 400, 없는 대상·경로는 404, 저장 충돌은 409, 내부 오류는 500이다. 작업 실패는 작업 조회의 HTTP 200 + `status: failed`로 구분한다.

구조화된 오류 코드·필드별 오류·401/403·요청 제한·재시도 가능 여부는 아직 정식 계약이 없다. 프론트 요청 시간 초과나 연결 취소가 서버 처리 취소·저장 실패를 보장하지 않으므로 재시도 전 상태 확인·중복 방지 정책을 정해야 한다.

## 근거

[서버 라우트](../../../api-server/src/app.js), [입력 검증](../../../api-server/src/validation.js), [활동 저장](../../../api-server/src/activities.js), [아카이브](../../../api-server/src/archive.js), [홈 집계](../../../api-server/src/home.js), [프론트 서비스](../../../src/services/chat.ts), [저장 서비스](../../../src/services/records.ts), [아카이브 서비스](../../../src/services/footprints.ts).
