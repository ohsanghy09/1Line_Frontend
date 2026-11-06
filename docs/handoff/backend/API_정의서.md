# 백엔드 API 정의서

기준일: 2026-11-06. [공통 응답 객체](../common/공통_데이터_계약.md) · [오류](../common/상태와_오류_처리.md)

Base는 백엔드가 제공하는 HTTPS 주소이며 /api까지 포함한다. 프론트 담당자가 연결 설정에 반영한다. 아래는 Base 뒤에 붙이는 경로다. 현재 Authorization·사용자 식별·credentials 설정 없음. JSON 본문은 Content-Type: application/json. id는 경로에 URL 인코딩한다. 정상 JSON은 별도 data wrapper 없이 반환한다. 아래 목록은 현재 프론트에 필요한 공개 계약이다. 개발용 진단·원시 조회·직접 카드 JSON 저장 경로는 요구하지 않는다.

## 현재 프론트 요청 전체 목록

| 메서드·경로 | 기능 ID | 요청 | 정상 상태·응답 | 주요 실패 |
| --- | --- | --- | --- | --- |
| GET /activities | HOME-04~06 | 없음 | 200 ActivityOption[] (id,name + nullable 메타정보) | 500 |
| POST /records | HOME-04,05 | 아래 SaveInput | 201 SavedRecord | 400/404/409 |
| PATCH /records/:id | HOME-06 | 아래 EditInput | 200 SavedRecord | 400/404 |
| GET /records/:id | HOME-08 | 없음 | 200 SavedRecord, 서버 카드 복구 | 404 |
| POST /activities/apply-chat-update | HOME-07 | analysisId 필수 비빈 string ≤20000, 추가 키 금지 | 200 {analysisId,conversationId,reply:general} | 400/404/409 |
| GET /home/recent | HOME-09 | 없음 | 200 {activities:ActivitySummary[],records:RecentMaterial[]} 각 최대 3 | 500 |
| GET /activities/:id/analysis | META-01 | 없음 | 200 ActivityAnalysis | 404 |
| POST /activities/:id/analyze | META-01 | 본문 없음 | 202 ActivityAnalysis | 404/422(기록 없음)/503(예약 실패) |
| GET /archive/activities | ARCHIVE-01 | 아래 query | 200 {items:ActivitySummary[],total,categories:string[]} | 400 |
| GET /archive/activities/:id | ARCHIVE-02,TIMELINE-01 | 없음 | 200 ActivityDetail | 404 |
| GET /archive/activities/:id/materials/:fileId | ARCHIVE-03 | 실제 file ID 또는 record:ID | 200 {activityId,file,events,versionHistory:[]} | 404 |
| DELETE /archive/activities/:id | ARCHIVE-04 | {confirmation:정확한 활동명} | 200 {deleted:true} | 400/404/409 |
| DELETE /archive/activities/:id/materials/:fileId | ARCHIVE-05 | 현재 서비스는 빈 객체 {} 전송 | 200 {deleted:true} | 404/409/502 |
| GET /journey | JOURNEY-01 | 없음 | 200 GrowthJourney + analysis | 500(손상 저장값 등) |
| POST /journey/analyze | JOURNEY-02 | 본문 없음 | 200 GrowthJourney + analysis | 409/422/429/502/503/504 |
| POST /settings/reset-data | SETTINGS-01 | {confirmation:"전체 삭제"}, 앞뒤 공백도 불허 | 200 {deleted:true} | 400/409 |

### 저장 입력 SaveInput

| 필드 | 필수·자료형·제약 |
| --- | --- |
| analysisId | 필수 비빈 string ≤20000. 백엔드가 실제 완료 초안·원본을 조회한다. 클라이언트의 직접 reply 저장은 필수 계약에서 제외 |
| activityId / newActivity | 정확히 하나 필수. activityId 비빈 string ≤20000, newActivity는 name와 ActivityMetadataValues 전체 키 필수 |
| activityUpdates | 선택 ActivityMetadataValues, activityId가 있을 때만 허용. 각 필드의 null은 기존 정보 보존 |
| classification | 선택 {materialType:비빈 string ≤20000}. 현재 서비스는 항상 전송 |
| message | 프론트는 보내지 않음. 기록 원문은 analysisId의 초안에서 취득. 파일·링크는 기록 원문을 빈 문자열로 저장 |

추가 최상위 키 금지. newActivity의 이름 중복은 409. 초안 없음 404, 미완료·실패 작업 또는 동일 analysisId의 기존 기록은 409. 저장 전 선택 활동은 실제 ID로 검증한다. 일반 대화·삭제로 퇴역된 general 초안은 분석 reply 검증에서 거절한다.

기존 활동 저장 예시(실제 DB에 존재하는 ID로 대체):

```json
{"analysisId":"draft-01","activityId":"activity-01","classification":{"materialType":"경험 기록"}}
```

신규 활동 저장:

```json
{"analysisId":"draft-01","newActivity":{"name":"북클럽봄","category":"동아리","status":null,"role":null,"period":null,"summary":null},"classification":{"materialType":"경험 기록"}}
```

SavedRecord는 id,activityId,analysisId,message,reply,createdAt,updatedAt을 반환한다. ID는 비빈 문자열이며 시각은 UTC ISO 문자열이다. 현재 프론트는 id·activityId·reply를 추려 보관한다. 완전한 성공 예시:

```json
{"id":"record-01","activityId":"activity-01","analysisId":"draft-01","message":"북클럽봄을 시작했어요.","reply":{"id":"reply-draft-01","role":"assistant","kind":"text-analysis","content":"북클럽봄 활동에 자료를 기록했어요.","activityCreated":true,"analysis":{"activity":{"id":"activity-01","name":"북클럽봄","match":"existing","confidence":"high","category":"동아리","status":null,"role":null,"period":null,"summary":null},"materialType":"경험 기록","stage":null,"summary":"북클럽봄을 시작했어요.","changes":[],"files":[],"groups":[],"suggestedSaveMode":"archive"}},"createdAt":"2026-11-06T09:00:00.000Z","updatedAt":"2026-11-06T09:00:00.000Z"}
```

### 기록 수정 EditInput

현재 프론트는 `{activityId,materialType}`를 보낸다. 두 값은 각각 비빈 string ≤20000이다. 필수 구현 범위는 기존 활동 연결과 자료 유형 수정이다. 개발 서버가 과거 허용했던 summary/content/changes 직접 편집 확장은 프론트 필수 계약에서 제외한다.

```json
{"activityId":"activity-02","materialType":"회의록"}
```

변경된 자료 유형은 모든 파일과 그룹에도 반영한다. 분류·활동 이동만으로 기존 변화 내용을 다시 생성하지 않는다. 활동 이동은 기존·새 활동 updated_at과 종합 예약에 영향을 준다.

### 검색 query와 반환 의미

q: string 최대 500 기본 '', category: trim 비빈 string 최대 200 기본 all, status: all/진행 중/완료 기본 all, sort: recent/materials/oldest 기본 recent. 추가 query 키 금지. 페이지네이션 없음.

`total`은 **필터 적용 전 전체 활동 수**다. `items.length`는 현재 조건의 결과 수, categories는 전체 활동에서 얻은 유형 목록(검색 조건과 무관)이다. 파일 BLOB은 검색하지 않는다. 검색 대상은 활동명·전체 요약·독립 텍스트 원문·확정 기록 요약·자료명이다. 파일/링크에 함께 보낸 채팅은 검색에서 제외한다.

```json
{"items":[],"total":2,"categories":["동아리","프로젝트"]}
```

### 최근 목록

RecentMaterial은 id,recordId,activityId,activityName,title,materialType,kind(file/link),savedAt 필수다. 프론트 호환 검증은 text도 허용하지만 현재 서버는 텍스트를 최근 자료로 반환하지 않는다. 최근 활동은 activities.updated_at 내림차순, 최근 자료는 records.created_at 내림차순이고 각 3개다. 다중 파일은 한 기록에서 여러 항목이 나올 수 있다.

```json
{"activities":[],"records":[]}
```

### 활동·자료 상세 예시

한 파일을 확정한 뒤 활동 종합 전인 상태의 완전한 예시다. 실제 ID·시각은 서버가 발급한다. 활동의 summary는 전체 요약이고 파일의 summary는 해당 기록 요약이다.

```json
{"id":"activity-01","title":"북클럽봄","category":"동아리","status":"미설정","role":"미설정","period":"미설정","summary":"활동 전체 요약이 아직 없습니다.","updatedAt":"2026-11-06T09:00:00.000Z","materialsCount":1,"recordsCount":1,"metadataAnalysis":{"status":"queued","error":null,"updatedAt":null,"stale":true},"folders":[{"id":"activity-01:%ED%9A%8C%EC%9D%98%EB%A1%9D","name":"회의록","materialsCount":1,"files":[{"id":"file-01","name":"회의록.md","type":"회의록","kind":"file","originalFileId":"file-01","recordId":"record-01","recordPosition":0,"savedAt":"2026-11-06T09:00:00.000Z","uploadedAt":"2026-11-06T08:59:00.000Z","updatedAt":"2026-11-06T09:00:00.000Z","summary":"다음 모임의 책을 정했어요.","sourceUrl":null,"summaryScope":"record"}]}],"timeline":[]}
```

자료 상세는 위 files 항목 하나를 file로 가져오고 events=[]·versionHistory=[]·activityId를 붙이는 구조다. 프론트 서비스가 *Label 날짜 표시를 추가한다.
