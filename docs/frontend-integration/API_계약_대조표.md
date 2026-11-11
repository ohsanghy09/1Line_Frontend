# API 계약 대조표

작성일: 2026-11-09 · 2026-11-11 공개 API 20개 코드 대조 완료

## 기준과 판정 방법

[백엔드 handoff](../backend/handoff/API_정의서.md)와 [AI handoff](../ai/handoff/API_정의서.md)를 기준으로 한다. 아래 경로는 `/api`까지 포함하는 각 서버 Base 뒤에 붙이는 경로다. 개발용 `/ai-api`는 실제 AI 서버 접두사가 아니다.

`목록 확인`은 서비스 코드에서 호출 위치를 찾았다는 뜻이며 본문·응답·화면 동작의 일치를 보장하지 않는다. 상세 판정은 `미점검 / 일치 / 차이 / 명세 확인 필요`로 기록한다. 차이는 원인·기능 영향·수정 제안·사용자 확인 상태를 함께 남긴다.

현재 동작하는 프론트 기능은 보존한다. 차이를 발견했다고 계약에 맞춰 기능을 변경하지 않는다. 충돌이나 기능 손상 가능성이 있으면 현재 동작·명세·영향·기능 보존 방향을 사용자에게 보고하고, 확인 전 해당 기능의 변경·제거를 보류한다. 상세 원칙은 [작업 기준](README.md)의 현재 기능 보존과 충돌 보고 원칙을 따른다.

## 공개 API 시작 목록

기존 호환성 문서의 백엔드 16개·AI 4개를 기준으로 삼는다. 아래 목록은 초기 호출 위치 조사이며 최신 판정은 이어지는 상세 대조 결과에 있다.

| ID | 담당 | 메서드·경로 | 프론트 확인 위치 | 현재 확인 상태 |
| --- | --- | --- | --- | --- |
| BE-01 | 백엔드 | GET /activities | `src/services/records.ts` | 목록 확인 |
| BE-02 | 백엔드 | POST /records | `src/services/records.ts` | 목록 확인, C-01 후보 |
| BE-03 | 백엔드 | PATCH /records/:id | `src/services/records.ts` | 목록 확인, C-02 후보 |
| BE-04 | 백엔드 | GET /records/:id | `src/components/chat/ConnectedChatReplyCard.tsx` | 저장 카드 마운트·기록 변경 이벤트의 직접 호출 확인 |
| BE-05 | 백엔드 | POST /activities/apply-chat-update | `src/services/chat.ts` | 목록 확인 |
| BE-06 | 백엔드 | GET /home/recent | `src/services/home.ts` | 목록 확인 |
| BE-07 | 백엔드 | GET /activities/:id/analysis | `src/services/activityAnalysis.ts` | 목록 확인 |
| BE-08 | 백엔드 | POST /activities/:id/analyze | `src/services/activityAnalysis.ts` | 목록 확인 |
| BE-09 | 백엔드 | GET /archive/activities | `src/services/footprints.ts` | 목록 확인 |
| BE-10 | 백엔드 | GET /archive/activities/:id | `src/services/footprints.ts` | 목록 확인 |
| BE-11 | 백엔드 | GET /archive/activities/:id/materials/:fileId | `src/services/footprints.ts` | 목록 확인 |
| BE-12 | 백엔드 | DELETE /archive/activities/:id | `src/services/footprints.ts` | 목록 확인 |
| BE-13 | 백엔드 | DELETE /archive/activities/:id/materials/:fileId | `src/services/footprints.ts` | 목록 확인 |
| BE-14 | 백엔드 | GET /journey | `src/services/journey.ts` | 목록 확인 |
| BE-15 | 백엔드 | POST /journey/analyze | `src/services/journey.ts` | 목록 확인 |
| BE-16 | 백엔드 | POST /settings/reset-data | `src/services/settings.ts` | 목록 확인 |
| AI-01 | AI | GET /chat/health | `src/services/chat.ts` | 목록 확인 |
| AI-02 | AI | POST /chat | `src/services/chat.ts` | 목록 확인 |
| AI-03 | AI | POST /chat/links | `src/services/chat.ts` | 목록 확인 |
| AI-04 | AI | GET /chat/jobs/:jobId | `src/services/chat.ts` | 목록 확인, C-03 후보 |

## 상세 대조 결과

판정은 handoff와 현재 프론트의 실제 호출 및 해당 개발 서버 코드에 근거한다. ‘일치’는 표에 적힌 공개 호출 범위의 코드 판정이다. 분리 서버 의존성은 공개 인터페이스 판정과 함께 별도로 기재했다. 서버 실행, 실제 HTTPS·CORS·인증, AI 모델 및 사용자 데이터 변경은 이번 대조에서 수행하지 않았다. 기존 호환성 검사의 실행 결과는 [이전 검증 기록](../common/integration/handoff/프론트_호환성_점검결과.md)을 참조한다.

공통 요청 경계는 `src/services/chat.ts`의 `request`다. 백엔드·AI Base는 각각 환경 변수로 지정하며 로컬 Vite는 `/api`를 백엔드로, `/ai-api`를 AI의 `/api`로 프록시한다. 프론트는 인증 헤더를 추가하지 않고 JSON 본문이 있는 요청에만 JSON 헤더를 명시한다. 공통 요청 처리는 2xx와 오류를 나누고, 오류의 `error` 문자열과 HTTP 상태를 사용한다. 일반 제한은 30초다. 성공 상태 코드를 개별 비교하지 않는 호출은 서버가 handoff의 상태 코드를 보내는지를 서버 라우트에서 확인했다.

### 백엔드 16개

| ID | handoff 계약 | 프론트 호출·처리 | 백엔드 개발 서버 및 판정 |
| --- | --- | --- | --- |
| BE-01 | 본문 없음. 200 활동 선택 배열, 500 오류 | 카드 저장 및 수정에서 `records.ts`로 조회. ID·이름·메타정보 검사, 누락 메타정보는 null로 정규화. 실패는 카드에 표시 | `app.js → activities.js`가 id/name과 nullable 메타정보를 반환. **일치** |
| BE-02 | analysisId 필수, 기존 활동 ID/신규 활동 중 하나. 선택 classification·기존 활동 activityUpdates. 201 SavedRecord, 400/404/409 | 홈의 AI 완료 카드는 analysisId를 보낸다. 유효한 ID가 없으면 저장 요청 전에 중단한다. 카드 잠금으로 중복 실행을 막고 성공 뒤 기록 ID를 반영한다 | `app.js → validation.js, activities.js`가 초안·완료·중복·대상을 검사하고 저장한다. **프론트 요청 일치**. 개발 서버의 직접 reply 저장 확장은 C-01 참조. 정상 저장과 원본 연결은 완료 초안이 백엔드에서 조회 가능해야 한다 |
| BE-03 | activityId·materialType, 200 SavedRecord, 400/404. 파일·그룹 자료 유형 반영, 기존 변화 보존 | 저장 카드의 수정 적용은 두 값만 보낸다. 성공 응답으로 카드와 활동·기록 목록 갱신 | `app.js`가 활동 연결·파일·그룹을 갱신한다. 개발 editSchema는 한 필드만 보낸 수정과 과거 직접 편집도 허용. **현재 화면 호출 일치**, 개발 확장 C-02 |
| BE-04 | 본문 없음. 200 SavedRecord, 404 | `ConnectedChatReplyCard.tsx`가 저장 카드 마운트 및 기록 변경 이벤트에서 호출. reply·activityId 반영, 404는 삭제 안내, 다른 오류는 기존 카드 유지 | `app.js`의 record 조회가 전체 객체 반환. 과거 직접 저장 기록은 analysisId=null일 수 있음. **현재 저장 흐름 일치**, 과거 데이터 C-01 |
| BE-05 | analysisId만 전송, 200 analysisId/conversationId/general reply, 400/404/409 | `chat.ts`가 activity-update 중간 응답을 받으면 적용 요청. 400/404/409/422는 확정 실패로 처리 | `activity-chat-update.js`가 완료·첨부 없는 chat과 수정 필드를 검증하고 완료 응답을 재사용. **공개 형식 일치**, 분리 서버에서는 완료 초안과 변경된 reply의 정본 연동 필요 |
| BE-06 | 본문 없음. 200 activities/records 각 최대 3, 500 | `home.ts`가 배열·필드 검사, 순서·개수 유지. 자료 이동용 id와 recordId를 구분. text도 호환 허용 | `home.js`가 활동 갱신/기록 생성 시각 기준 내림차순 각 3개 이하 반환. 파일·링크만 자료로 집계. **일치** |
| BE-07 | 본문 없음. 200 ActivityAnalysis, 404 | `activityAnalysis.ts`가 상태·error·시각·stale 검사. UI는 queued/running 동안 1500ms 순차 조회 | `activity-metadata.js`가 저장 상태와 stale 반환. 활동이 없으면 404. **일치** |
| BE-08 | 본문 없음. 202 ActivityAnalysis, 404/422/503 | 재분석 버튼에서 POST. 응답 본문은 사용하지 않고 상태 GET으로 화면 갱신 | `app.js`가 기록 존재와 예약 여부 검사 후 202. **공개 형식 일치**, 개발 큐의 AI 호출은 문맥 본문 없이 활동 ID에 의존 |
| BE-09 | q/category/status/sort, 200 items/total/categories, 400 | 발자국에서 네 조건을 인코딩하고 이전 요청을 취소. total을 필터 전 전체 수로 사용 | `archive-search.js`가 메타정보·확정 텍스트·요약·자료명 검색 및 정렬, 전체 유형·필터 전 total 반환. `validation.js`가 추가 query 거절. **일치** |
| BE-10 | 본문 없음. 200 ActivityDetail, 404 | 활동 상세·Timeline이 같은 응답 사용. 요청 ID·폴더·이벤트를 검사하고 404는 없음 표시 | `archive.js`가 확정 기록의 자료 그룹과 Timeline 반환. **일치**. 프론트의 과거 호환 검증은 일부 handoff 필드 누락을 수용 |
| BE-11 | 원본 file ID 또는 record:ID. 200 activityId/file/events/versionHistory, 404 | Drawer에서 두 ID를 인코딩하고 응답과 대조. 404는 자료 없음 | `archive.js`가 일치 자료와 관련 이벤트 반환. 개발 DB는 ID 기반 버전 관계가 없어 빈 versionHistory 반환. **일치** |
| BE-12 | 정확한 활동명 confirmation. 200 deleted:true, 400/404/409 | 활동 삭제 확인 모달이 JSON을 보내고 deleted:true 확인 뒤 목록 갱신 | `archive-delete.js`가 활동명 확인과 연관 기록·자료 정리를 트랜잭션에서 수행. `app.js`의 진행 중 홈 작업 검사는 공유 DB 기반. **공개 형식 일치**, 분리 서버의 작업 충돌 확인 필요 |
| BE-13 | 빈 JSON 객체. 200 deleted:true, 404/409/502 | 자료 삭제에서 {} 전송, 165초 제한. 성공 확인 후 목록 갱신 | `archive-delete.js`는 남은 파일이 있으면 {fileId}만 AI에 보내 공유 DB를 사용하고, 불일치·실패 시 삭제 중단. **공개 형식 일치**, 분리 서버 요청에는 기록·활동·남은 원본까지 필요 |
| BE-14 | 본문 없음. 200 GrowthJourney와 analysis, 500 | 화면 진입 시 저장 결과 조회. 필드·필터 참조·비교 구조 검사, 월 오름차순 표시. 과거 호환으로 analysis 생략 허용 | `journey.js`가 저장 결과 또는 빈 결과에 analysis와 stale을 추가. **일치** |
| BE-15 | 본문 없음. 200 GrowthJourney와 analysis, 409/422/429/502/503/504 | 수동 분석, 145초 제한·중복 방지. 실패 뒤 GET으로 마지막 결과 확인 | `journey.js`가 AI를 135초 제한으로 호출하고 fingerprint·근거 검사 후 저장. 개발 서버 내부 POST는 본문 없이 공유 DB에 의존하고 중복 잠금은 프로세스 범위. **공개 형식 일치**, 분리 서버는 JSON 스냅샷과 공유 잠금 필요 |
| BE-16 | 정확한 confirmation ‘전체 삭제’. 200 deleted:true, 400/409 | `SettingsModal.tsx → settings.ts`. 정확히 일치할 때 제출, 성공 후 현재 탭 세션 제거 | `app.js`에서 정확한 문구와 진행 상태 검사 후 관련 테이블을 트랜잭션에서 정리. **공개 형식 일치**, 분리 서버는 공유 작업 상태와 저장소 범위의 원자성 필요 |

### AI 4개

FastAPI의 공개 경로는 `ai-api-server/app/chat.py`에 있고 `main.py`에서 등록한다. 요청·응답 모델은 `home_schemas.py`, 작업 저장은 `database.py`에서 확인했다.

| ID | handoff 계약 | 프론트 호출·처리 | AI 개발 서버 및 판정 |
| --- | --- | --- | --- |
| AI-01 | checkConnection 선택, 기본 false. 200 ready/unavailable, label, analysisProvider, 선택 network | 홈 상태 배지는 query 없이 조회해 status·label 사용, 오류 상태 표시 | 기본 호출은 설정·DB 스키마 확인. network는 명시 요청에서만 추가. **일치** |
| AI-02 | multipart message/files/ID와 Prefer. 기본 202, 파일 없는 sync 200, JobResponse. 파일 10개·개별 10MiB·합계 25MiB 등 | 브라우저 FormData, 파일이면 async 30초·텍스트면 sync 150초. 응답 실패 envelope를 처리. 사전 검사는 글자 수·개수·개별 크기 중심 | 서버는 파일 합계·빈 파일·확장자도 확인하고 완료/실패 envelope 생성. **현재 호출 일치**. 일부 multipart 파싱 오류는 도메인 오류 형식 대신 프레임워크 응답이 될 수 있음. 분리 서버는 완료 응답 전 정본 게시 필요 |
| AI-03 | JSON url, 선택 conversationId/requestId 문자열. 202 JobResponse, 400/422/409/503 | URL 검증·trim, UUID 생성, JSON 전송. 비동기 결과 처리 | 추가 키를 거절하고 URL 검증 후 접수. 개발 LinkRequest는 ID에 명시적 null도 허용하며 공백 문자열을 trim해서 거절하지 않는다. **현재 호출 일치**, 입력 경계 **차이**. FastAPI 422 기본 detail은 프론트 일반 오류로 표시 |
| AI-04 | ai- 작업 ID. 200 JobResponse, 404 job_missing | ID 인코딩·응답 ID 대조, 400ms 순차 조회·전체 120초. failed는 확정 실패 처리. 과거 non-ai 작업은 백엔드 조회 | AI는 ai- ID를 발급하고 세 상태의 envelope 반환. **공개 AI 경로 일치**. 과거 백엔드 작업 재조회는 개발 백엔드가 410을 반환하므로 **복원 차이 C-03** |

### JSON 예시와 필드 정의

[백엔드 API 정의서](../backend/handoff/API_정의서.md), [AI API 정의서](../ai/handoff/API_정의서.md), [공통 데이터 계약](../common/handoff/공통_데이터_계약.md), [서버 간 데이터 전달 계약](../common/handoff/서버간_데이터_전달_계약.md)에 있는 JSON 코드 블록은 각각 7·8·1·1개이며 17개 모두 JSON 파싱을 확인했다. 저장 요청·응답, 수정 요청, 검색·최근·상세 조회, 링크 요청, AI 작업 상태, 빈 Journey, 내부 문맥 등의 예시다. 필수·선택·nullable·열거값·길이·추가 키 제한은 본문과 공통 계약에 분산돼 있다. 예시 ID·시각·해시는 설명용이다. 예시가 없는 API의 스키마는 해당 API 표와 공통 객체 정의를 함께 사용한다. `POST /chat` 요청 본문은 multipart이고 응답은 JSON이다.

## 상세 대조 항목

각 API마다 다음을 채운다. 필수·선택·생략·null을 구분하고, 실제 호출 화면까지 추적한다.

- 기준 문서의 절, 프론트 호출 함수와 화면, 개발 서버의 대응 코드.
- Base·메서드·경로·인코딩·헤더·본문·query와 파일 제한.
- 정상 상태 코드·응답 필드·응답 검증·오류 상태와 메시지 처리.
- ID 생성·보관·재사용, 화면 복원, 영속 저장 시점, 중복 요청·취소·시간 초과.
- 계약과의 차이, 현재 동작을 유지해야 하는 이유, 제안과 기능 영향, 검증 방법.

## 차이의 영향과 기능 보존 방향

| ID | 확인한 사실 | 추가 확인과 기능 영향 | 변경 상태 |
| --- | --- | --- | --- |
| C-01 | handoff는 analysisId를 요구한다. 프론트가 ID 없는 카드에서 직접 reply를 보냈던 분기를 제거했다. 개발 백엔드는 직접 reply 저장을 허용한다 | 이전 카드의 표시는 유지한다. 유효한 ID가 없는 미저장 카드에서 저장을 시도하면 서버에 POST하지 않고 원본을 다시 분석하라는 안내를 표시한다 | 프론트 저장 요청 수정. 개발 서버 확장 유지 |
| C-02 | 현재 카드 PATCH는 activityId·materialType만 전송한다. 서비스의 선택 activityUpdates와 개발 백엔드의 summary/content/changes 편집 확장은 현재 카드 호출 밖에 있다 | 현재 UI의 계약 충돌은 확인되지 않았다. 저장 POST에서 기존 활동의 비어 있는 category를 보완하는 activityUpdates는 별도 계약으로 보존한다 | 미수정 |
| C-03 | 프론트는 non-ai 작업 ID를 복원해 백엔드에 조회하지만 개발 백엔드의 해당 경로는 410이고 handoff 공개 목록에도 없다 | 과거 진행 작업을 이 경로로 복구할 수 없다. 이전 세션의 보존·안내 방식을 협의하고 현재 ai- 작업의 재조회 동작을 유지한다 | 미수정 |

분리 환경에서는 완료 작업을 백엔드에 게시하기 전에 AI가 완료 응답을 보내면 저장·직접 수정이 404/409로 실패할 수 있다. 현재 개발 서버의 공유 DB가 대신하는 기능을 handoff의 내부 문맥·작업 게시 계약으로 구현해야 한다. 활동 종합·성장 분석·남은 파일 분석의 내부 본문도 별도로 전환해야 한다. 이 변경은 공개 프론트 요청을 그대로 유지하는 방향이다.

## 기존 Swagger와 개발 서버 대조 결과

`api-server/src/app.js`의 명시적 API 등록은 메서드·경로 조합 24개이고, 기존 `backendSpec`은 19개다. 문서 전용 서버·테스트 대역·자동 CORS 처리는 이 개수에서 제외했다. 아래 5개가 기존 명세에서 누락되어 있다.

- POST /api/activities/apply-chat-update
- GET /api/activities/:id/analysis
- POST /api/activities/:id/analyze
- DELETE /api/archive/activities/:id
- DELETE /api/archive/activities/:id/materials/:fileId

이는 기존 Swagger가 불완전하다는 초기 근거다. 새 Swagger의 범위를 개발 서버 24개 전체로 정한다는 뜻은 아니다. 새 명세는 handoff를 기준으로 작성한다.

## 서버 간 내부 계약

[서버 간 전달 계약](../common/handoff/서버간_데이터_전달_계약.md)의 문맥 조회, 작업 게시·재조회, 활동·성장·남은 파일 분석을 별도 대조한다. 내부 계약은 공유 DB 없이 구현하기 위한 규격이며 기존 개발 서버가 모두 지원한다는 뜻은 아니다. 이 영역의 상세 조사와 Swagger 반영은 아직 수행하지 않았다.
