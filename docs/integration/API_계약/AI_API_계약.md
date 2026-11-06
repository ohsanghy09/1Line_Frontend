# AI API 요청·응답 계약

작성일: 2026-11-05. 상태: 화면용 요구사항과 요청 초안. [호출 구조·협의사항](문서_안내.md)을 먼저 읽는다.

2026-11-06 실제 개발 구현: FastAPI `POST /api/analyze/text`에서 OpenAI `gpt-5.6-sol` 텍스트 분석을 연결하고 실제 호출 1회를 확인했다. 현재 개발 요청·응답·오류는 [텍스트 분석 API](../../../ai-api-server/docs/텍스트_분석_API.md)를 따른다. 요청 문맥만 분석하며 DB 조회·신규 활동 생성·영속 분석 ID·프론트 연결은 아직 없다. 아래 전체 홈 분석 계약과 `ChatReply`는 후속 연결 요구사항이며 현재 FastAPI 응답과 구분한다. 기존 정적 Swagger는 아직 이 엔드포인트를 반영하지 않았고 FastAPI `/docs`·`/openapi.json`에서 현재 명세를 제공한다.

## 적용 기준

2026-11-06 사용자 확정: 홈 분석은 프론트가 AI 담당자의 서비스 API에 직접 요청한다. 결과·자료 확정 저장과 나의 발자국·Timeline 조회는 백엔드에 요청한다. Growth Journey는 백엔드·AI가 성장 분석 결과를 생성·저장하며 프론트는 백엔드에서 조회한다. 이는 앞으로 구현할 방향이며 현재 호출 코드가 전환된 것은 아니다. 모델·공급자·실제 경로·인증·파일 전달 상세는 미정이다.

기존 프론트 홈은 여전히 Express 목 분석을 사용한다. 별도 FastAPI 텍스트 분석만 실제 OpenAI에 연결했다. 이 문서의 아래 내용은 프론트 또는 백엔드가 **AI 서비스에 제공해야 할 값**과 **분석 결과로 받아야 할 값**을 호출 경로와 별개로 정리한다.

- 아래 요청 필드명은 제안이며 현재 운영되는 AI 엔드포인트가 아니다. URL·메서드·인증·전송 형식·작업 상태는 담당자 협의 후 확정한다.
- 응답은 현재 화면이 소비하는 구조다. AI 모델이 UI ID·선택지·모든 키를 직접 생성해야 한다는 뜻은 아니다. AI 서비스 또는 호출 측 변환 계층에서 검증·변환할 수 있다.
- 요청 ID·사용자 범위·기록/활동/자료 ID는 신뢰할 수 있는 시스템에서 제공한다. AI가 존재하지 않는 ID를 만들어 반환하지 않는다.
- 분석은 저장 완료와 다르다. AI 응답만으로 사용자 기록 확정 저장이나 기존 활동 메타정보 덮어쓰기를 수행하지 않는다.

## 1. 홈 입력 분석 — 요청 제안

현재 목 함수 입력은 message·업로드 파일 메타정보·개발 mode·DB 활동 목록이다. 실제 기존 기록 조회·파일 본문 추출·링크 수집은 없다. 다음 표는 **실제 분석을 위한 제안**이며 기존 요청 구현으로 기록하지 않는다.

| 요청 필드(제안) | 타입 | 필요 조건·의미 |
| --- | --- | --- |
| requestId | string | 필수 제안. 추적·중복 처리용, 발급 주체 협의 |
| conversationId | string | 선택. 이전 대화 문맥을 연결할 경우 사용. ID만으로 AI가 DB에 접근할 수 있는 것은 아님 |
| input.kind | text / files / link | 필수. 입력 종류 구분 |
| input.message | string | 텍스트 입력은 필수. 파일과 함께 입력한 글도 보존 |
| input.files | FileInput[] | 파일 입력은 필수·1개 이상. 실제 원본 또는 읽을 수 있는 내용 전달 필요 |
| input.url | string | 링크 입력은 필수. 실제 입력 URL |
| input.linkContent | string | 선택. 호출 측이 수집한 경우 제공. 생략 시 수집 담당·접근 실패 처리 합의 필요 |
| context.activities | ActivityContext[] | 기존 활동 매칭 시 필요. 빈 배열도 허용 |
| context.records | RecordContext[] | 기존 내용과 비교 시 필요. 근거가 없으면 비교·변화를 추측하지 않음 |
| context.messages | 대화 메시지 배열 | 선택 제안. 연속 대화 분석을 지원할 경우 역할·내용·시각 계약 추가 |

### 입력 문맥 객체 — 제안

| 객체 | 필드·타입·필수 여부 |
| --- | --- |
| FileInput | 필수 `id`, `name`, `mimeType`: string, `size`: number(byte). 내용 전달은 바이너리·임시 접근 URL·추출 텍스트 중 하나 이상을 협의. id는 입력 참조 ID이며 영속 자료 ID인지 별도 구분 |
| ActivityContext | 필수 `id`, `name`: string. 선택 `category`, `status`, `role`, `period`, `summary`: 백엔드 활동 메타정보와 같은 의미·null 허용 |
| RecordContext | 필수 `id`, `activityId`: string. 선택 `message`, `summary`: string, `materials`: MaterialContext[]. 비교할 원문·시각의 범위는 협의 |
| MaterialContext | 필수 `id`, `recordId`, `activityId`, `name`: string. 선택 `materialType`, `content`, `sourceUrl`: string. 원문·추출문 여부와 실제 시각을 구분할 스키마 추가 필요 |

파일명과 URL만으로 본문을 읽었다고 판단하지 않는다. 확정된 호출 구조 안에서 활동 후보·과거 기록·원본 접근을 누가 준비하고 어떻게 전달하는지는 별도로 결정한다. 필요한 기존 문맥이 없으면 수집·요청 추가 또는 분석 범위 제한으로 처리한다.

```json
{
  "requestId": "request-example-001",
  "input": {
    "kind": "text",
    "message": "사용자 인터뷰를 반영해 기능 기획을 수정했습니다."
  },
  "context": {
    "activities": [{ "id": "activity-example-001", "name": "예시 프로젝트" }],
    "records": []
  }
}
```

이 예시는 입력 구조 제안이다. 과거 기록이 없으므로 기존 상태와 비교한 Before 값을 임의로 만들면 안 된다.

## 홈 분석 결과의 화면용 구조

현재 로컬 `/api/chat` 완료 응답의 `reply`에 해당한다. 순수 AI 판단값과 시스템·화면 필드를 구분한다.

| 필드 | 타입·필수 여부 | 의미·생성 범위 |
| --- | --- | --- |
| id | string, 필수 | 응답 ID. 시스템 발급 가능 |
| role | assistant, 필수 | 화면용 고정값 |
| kind | text-analysis / file-analysis / no-change / batch-analysis / link-analysis, 필수 | 결과 카드 분기. 입력·분석 결과를 변환해 결정 가능 |
| content | string, 필수 | 일반 텍스트 답변·카드 안내. HTML 아님 |
| sourceUrl | string, 선택 | 링크의 원본 URL. 시스템이 입력에서 보존 가능 |
| analysis | object, 필수 | 현재 전송 API에서는 null 불허 |
| analysis.activity | ActivityProposal, 필수 | 활동 매칭·확신도·선택적 메타정보 |
| analysis.materialType | string, 필수 | 자료 유형 |
| analysis.stage | string 또는 null, 필수 | 확인된 활동 단계. 모르면 null |
| analysis.summary | string, 필수 | 해당 기록 분석 요약. 활동 전체 요약과 구분 |
| analysis.noChangeMessage | string, 선택 | 변화 없음 안내·사유 |
| analysis.changes | ChatChange[], 필수 | 중요 변화가 없으면 빈 배열 |
| analysis.files | AnalyzedFile[], 필수 | 파일 분류 결과. 텍스트는 빈 배열 |
| analysis.groups | Group[], 필수 | 다중 파일 유형별 집계, 그 외 빈 배열 |
| analysis.suggestedSaveMode | record-change / version-only / archive, 필수 | 저장 방식 제안. 저장 완료를 뜻하지 않음 |

### 하위 객체

| 객체·필드 | 타입·필수 여부·의미 |
| --- | --- |
| ActivityProposal.name | string, 필수. 활동 후보 표시명 |
| ActivityProposal.confidence | high / medium / low 또는 null, 필수 |
| ActivityProposal.id | string 또는 null, 선택. 제공된 실제 기존 활동 ID만 사용 |
| ActivityProposal.match | existing / new / unresolved, 선택. existing은 ID 필요, new/unresolved는 ID 없음 |
| ActivityProposal 메타정보 | 선택 category·status·role·period·summary. [백엔드 메타정보](백엔드_API_계약.md#공통-데이터)와 같은 의미·null 허용. activity.summary는 활동 전체 요약 제안 |
| ChatChange | before·after·category: string, evidence: string[] 모두 필수. 현재 근거는 이름 문자열 |
| AnalyzedFile | name·materialType: string, previousVersion: string 또는 null 모두 필수. previousVersion은 이름 안내이며 확정된 버전 관계 ID가 아님 |
| Group | materialType: string, count: 양의 정수 모두 필수 |

파일 이름·개수는 실제 입력과 일치해야 한다. 이름 중복이 가능하므로 최종 계약에서는 입력 참조 ID·자료 ID를 보존하는 필드가 필요하다. 현재 화면 타입에는 파일별 ID·근거 객체가 없어 계약 확장과 화면 변환을 함께 해야 한다.

analysisId·conversationId·recordId·activityId는 분석 초안·저장 연결용 시스템 필드다. 모델이 생성할 의미 판단 필드와 구분한다. 현재 ChatReply 타입에는 greeting/general 및 analysis: null도 있지만 서버·서비스의 전송 결과 검증은 받지 않으므로 일반 대화 지원은 별도 확장이다.

### 변화 없음 응답 예시 — 화면용

```json
{
  "id": "reply-example-001",
  "role": "assistant",
  "kind": "text-analysis",
  "content": "경험을 정리했어요. 연결할 활동을 확인해주세요.",
  "analysis": {
    "activity": { "name": "확인할 활동", "confidence": null, "id": null, "match": "unresolved" },
    "materialType": "사용자 경험 기록",
    "stage": null,
    "summary": "사용자 인터뷰를 반영해 기획을 수정한 경험입니다.",
    "noChangeMessage": "기존 기록과의 전후 비교 근거가 충분하지 않습니다.",
    "changes": [],
    "files": [],
    "groups": [],
    "suggestedSaveMode": "archive"
  }
}
```

확인할 활동은 예시 표시명이며 실제 활동 ID가 아니다. 분석 실패를 변화 없음 성공으로 반환하지 않는다. 중요한 변화가 없다는 판단과 비교 자료 부족 사유는 문구와 후속 상태 계약에서 구분한다.

## 2. 성장 분석 — 요청 제안

현재 GET `/api/journey`는 고정 목 결과를 읽는다. 아래 분석 요청과 실행 API는 아직 없다.

| 요청 필드(제안) | 타입 | 필요 조건·의미 |
| --- | --- | --- |
| requestId | string | 필수 제안. 추적·중복 처리 |
| context.activities | ActivityContext[] | 필수. 실제 분석 대상 활동 |
| context.records | RecordContext[] | 필수. 확정 저장 기록만 포함, 미저장 초안 제외 |
| context.materials | MaterialContext[] | 필수 제안. 근거 연결용 실제 ID와 읽을 수 있는 내용. 빈 배열 허용 |
| scope | object | 선택 제안. 전체/기간/활동 범위, 상세 필드와 기본값 협의 |
| classification | object | 제안. 허용 성장 유형·분야 ID와 의미. 최종 분류 합의 후 확정 |

기록에는 분석에 필요한 실제 시각과 내용 출처가 필요하다. 현재 목 입력에는 이 문맥이 없으므로 조회·추출·갱신 구현이 선행돼야 한다. 여러 활동의 Timeline 이벤트를 합치는 것만으로 전체 성장 분석을 대체하지 않는다.

## 성장 분석 결과의 화면용 구조

| 필드 | 타입·필수 여부 | 의미 |
| --- | --- | --- |
| source | mock / api, 필수 | 목/실제 분석 구분. HTTP 호출 여부가 아님 |
| summary | {title: string, description: string}, 필수 | 전체 성장 흐름. 결과 없으면 분석된 흐름이 없다는 안내 |
| badges | {id: string, label: string}[], 필수 | 확인된 첫 경험만 포함. 없으면 빈 배열 |
| typeOptions / axisOptions | {value: string, label: string}[], 필수 | 필터 선택지. all 포함, 시스템·도메인 설정으로 관리 가능 |
| events | JourneyEvent[], 필수 | 전체 성장 이벤트. 없으면 빈 배열 |

| JourneyEvent 필드 | 타입·필수 여부·의미 |
| --- | --- |
| id | string, 필수. 안정적인 ID를 시스템에서 발급·보존하는 정책 필요 |
| occurredAt | string, 필수. 현재 YYYY-MM. 확인되지 않은 일자를 덧붙이지 않음 |
| activity | {id: string 또는 null, name: string}, 필수. 실제 분석은 확인된 대상 ID로 연결 |
| type / axis | string, 필수. 선택지에 존재하는 값, all 불허 |
| title / description | string, 필수. 확인된 성장 제목·설명 |
| comparison | {before: string, after: string, evidence: string[]}, 선택. 양쪽 비교가 있을 때만 포함 |

현재 화면 호환 분류는 유형 ability·achievement·experience·efficiency·transfer, 분야 planning·technology·data·collaboration이다. 기능명세와 차이가 있어 최종 AI 분류로 확정하지 않는다.

- 필터는 프론트에서 처리한다. 필터 변경으로 AI를 재호출하거나 요약·배지를 다시 생성하지 않는다.
- 현재 evidence는 문자열이다. 실제 자료 이동을 위해서는 `{activityId, recordId, materialId, label}` 같은 근거 객체 확장을 협의하고 타입·서비스·카드를 수정해야 한다.
- 현재 예시 activity.id는 null이다. 실제 분석의 ID 누락·대상 삭제·분석 중 상태를 어떻게 처리할지는 별도 계약이 필요하다.
- 이벤트·배지 ID, source, 선택지는 모델의 자유 생성보다 시스템 검증·발급 책임과 함께 정한다.

빈 결과의 유효한 화면용 형태:

```json
{
  "source": "api",
  "summary": { "title": "아직 분석된 성장 흐름이 없어요.", "description": "성장으로 확인할 수 있는 결과가 아직 없습니다." },
  "badges": [],
  "typeOptions": [{ "value": "all", "label": "전체" }],
  "axisOptions": [{ "value": "all", "label": "전체 분야" }],
  "events": []
}
```

이 예시는 정상 분석 완료 후 결과가 없는 경우다. 미연결·미실행·실패를 source: api의 빈 성공으로 대신하지 않는다.

## 실패·진행·검증 요구사항

AI 서비스의 실제 HTTP 상태·오류 스키마는 미정이다. 최소한 잘못된 입력, 원본 접근/추출 실패, 분석 실패, 시간 초과, 잘못된 출력, 정상 결과 없음은 구분할 수 있어야 한다. 현재 개발 서버의 `{error: string}`·작업 응답은 [백엔드 문서](백엔드_API_계약.md)에 기록했다.

- 동기 응답 또는 작업 ID 접수 방식, 진행 조회·취소·재개·재시도 계약을 합의한다. 실제 단계가 없으면 일반 로딩을 쓰며 가짜 진행률을 반환하지 않는다.
- 구조·필수값·분류·중복 ID·실제 대상 ID·파일 수·근거 참조를 검증한다.
- 근거 없는 변화·버전 관계·첫 경험·Turning Point를 생성하지 않는다.
- 모델 원문과 화면용 변환 결과의 검증 책임, 실패 시 재분석 여부, 모델·분석 버전 보관 정책을 정한다.

## 근거

[홈 타입](../../../src/types/chat.ts), [프론트 검증](../../../src/services/chat.ts), [서버 검증](../../../api-server/src/validation.js), [현재 목 분석](../../../api-server/src/mock-reply.js), [활동 문맥](../../../api-server/src/activities.js), [Journey 타입](../../../src/types/journey.ts), [Journey API 현황](../../journey/성장_분석_API.md).
