# 텍스트 채팅 AI 응답 형식

사용자가 경험을 텍스트로 보내면, AI API는 활동을 분류하고 주요 변화를 분석한 JSON을 반환한다. 프론트엔드는 이 데이터를 받아 채팅 안에 분석 카드를 표시한다.

> **현재 상태: API 연동을 위한 초안**  
> 현재 프론트엔드의 `ChatReply` 타입과 텍스트 시나리오 목데이터를 기준으로 작성했다. 실제 API 주소, 요청 형식, 인증 방식, 오류 응답은 아직 정해지지 않았다.

## 1. 전체 흐름

1. 사용자가 경험을 입력하고 전송한다.
2. 프론트엔드는 사용자 말풍선과 응답 대기 표시를 보여준다.
3. AI API가 입력 내용과 제공된 기존 기록을 분석한다.
4. API가 아래 형식의 JSON 응답을 반환한다.
5. 프론트엔드는 JSON의 값을 활동 분류, Before/After, 근거 영역에 표시한다.

**분석 응답을 받는 것과 기록을 저장하는 것은 별도 동작이다.** 아래 응답만으로 저장 완료를 의미하지 않는다.

## 2. 변화가 감지된 응답 예시

### 사용자 입력

> 오늘 회의에서 기능이 너무 많다는 의견이 나와서 6개 기능을 3개 핵심 기능으로 줄였어.

### AI API → 프론트엔드

아래 JSON은 응답 본문 자체의 예시다. 실제 API에서 `data` 같은 외부 구조로 감쌀지는 별도 협의가 필요하다.

```json
{
  "id": "reply-text-001",
  "role": "assistant",
  "kind": "text-analysis",
  "content": "1호선톤 활동 기록으로 보이네요. 기존 기획 기록과 비교했을 때 기능 범위를 축소한 중요한 변화가 확인됐어요.",
  "analysis": {
    "activity": {
      "name": "1호선톤",
      "confidence": "high"
    },
    "materialType": "사용자 경험 기록",
    "stage": null,
    "summary": "회의 피드백을 바탕으로 기능 6개를 핵심 기능 3개로 줄였어요.",
    "changes": [
      {
        "before": "기능 6개",
        "after": "핵심 기능 3개",
        "category": "기능 범위 변경 (MVP 최적화)",
        "evidence": ["사용자 직접 기록"]
      }
    ],
    "files": [],
    "groups": [],
    "suggestedSaveMode": "record-change"
  }
}
```

활동명과 기존 기록 비교 문구는 시나리오 예시다. 실제 분석에서는 API에 제공된 활동·기존 기록을 근거로 값을 반환해야 한다. 기존 기록이 제공되지 않았다면 비교했다고 단정하지 않는다.

## 3. 필드 설명

### 응답 공통 정보

| 필드 | 타입 | 역할 |
| --- | --- | --- |
| `id` | 문자열 | 응답을 구분하는 고유 ID. 서로 다른 응답은 다른 ID를 사용한다. |
| `role` | `"assistant"` | AI가 보낸 메시지임을 나타낸다. |
| `kind` | 문자열 | 응답 종류. 텍스트 분석은 `"text-analysis"`, 후속 질문은 `"general"`을 사용한다. |
| `content` | 문자열 | 사용자에게 보여줄 AI 답변 문구. HTML 대신 일반 텍스트를 전달한다. |
| `analysis` | 객체 또는 `null` | 활동 분류와 변화 분석 결과. 분석 없이 질문만 할 때는 `null`이다. |

### `analysis`: 분석 결과

| 필드 | 타입 | 역할 |
| --- | --- | --- |
| `activity.name` | 문자열 | 기록을 연결할 것으로 판단한 활동명 |
| `activity.confidence` | `"high"`, `"medium"`, `"low"` 또는 `null` | **활동 분류**의 확신도. 변화의 중요도나 확률 수치를 뜻하지 않는다. |
| `materialType` | 문자열 | 자료 유형. 텍스트 경험은 `"사용자 경험 기록"` |
| `stage` | 문자열 또는 `null` | 활동 단계. 알 수 없으면 `null` |
| `summary` | 문자열 | 입력한 경험을 정리한 요약 |
| `changes` | 배열 | 발견한 주요 변화 목록. 주요 변화가 없으면 `[]` |
| `files` | 배열 | 분석한 파일 목록. 이번 텍스트 시나리오에서는 `[]` |
| `groups` | 배열 | 일괄 파일 업로드의 유형별 개수. 이번 텍스트 시나리오에서는 `[]` |
| `suggestedSaveMode` | 문자열 | 이후 저장 시 적용할 방식에 대한 제안 |

현재 타입에서는 `analysis`가 객체일 때 위 필드를 모두 포함한다. 값이 없는 단일 항목은 `null`, 값이 없는 목록은 `[]`로 전달한다.

### `changes`: 변화 한 개의 구조

| 필드 | 타입 | 예시 |
| --- | --- | --- |
| `before` | 문자열 | `"기능 6개"` |
| `after` | 문자열 | `"핵심 기능 3개"` |
| `category` | 문자열 | `"기능 범위 변경 (MVP 최적화)"` |
| `evidence` | 문자열 배열 | `["사용자 직접 기록"]` |

변화가 여러 개면 `changes`에 객체를 추가한다. 근거는 입력 내용이나 실제 제공된 기록으로 확인할 수 있어야 한다.

### `suggestedSaveMode`: 저장 방식 제안

| 값 | 의미 | 이번 문서에서의 사용 |
| --- | --- | --- |
| `record-change` | 경험과 주요 변화를 함께 기록하도록 제안 | 텍스트에서 주요 변화가 발견된 경우 |
| `archive` | 주요 변화 없이 경험이나 자료를 보관하도록 제안 | 텍스트에서 주요 변화가 발견되지 않은 경우 |
| `version-only` | 기존 자료의 버전만 업데이트하도록 제안 | 파일 수정본용. 이번 텍스트 시나리오에서는 사용하지 않음 |

## 4. 변화가 없는 경우

경험을 입력했다고 항상 주요 변화가 있는 것은 아니다. 활동은 파악했지만 주요 변화를 찾지 못했다면 `changes`를 빈 배열로 반환한다.

예를 들어 “오늘 1호선톤 정기 회의에 참석했어”라는 입력은 다음처럼 정리할 수 있다.

```json
{
  "id": "reply-text-002",
  "role": "assistant",
  "kind": "text-analysis",
  "content": "1호선톤 회의 경험으로 정리했어요. 현재 입력에서는 주요 변화가 확인되지 않았어요.",
  "analysis": {
    "activity": {
      "name": "1호선톤",
      "confidence": "high"
    },
    "materialType": "사용자 경험 기록",
    "stage": null,
    "summary": "1호선톤 정기 회의에 참석했어요.",
    "changes": [],
    "files": [],
    "groups": [],
    "suggestedSaveMode": "archive"
  }
}
```

이 경우 Before/After 카드를 만들지 않는다. 현재 `ChatReplyCard`는 `changes`가 비어 있으면 변화 영역을 표시하지 않는다.

## 5. 정보가 부족한 경우

어떤 활동인지 판단하기 어렵다면 활동명을 임의로 지정하는 대신 후속 질문을 반환한다.

```json
{
  "id": "reply-text-003",
  "role": "assistant",
  "kind": "general",
  "content": "어떤 활동에서 있었던 일인지 알려주실래요? 기존 기록과 연결해서 정리해볼게요.",
  "analysis": null
}
```

이는 정상적인 대화 응답이다. 네트워크 오류나 API 실패 응답과는 별도로 처리한다.

## 6. 화면과 데이터의 연결

| 화면 영역 | 사용하는 데이터 |
| --- | --- |
| AI 답변 문구 | `content` |
| 활동 제목 | `analysis.activity.name` |
| 확신도 배지 | `analysis.activity.confidence` — `null`이면 숨김 |
| Before / After | `analysis.changes[].before`, `after` |
| 변화 유형 | `analysis.changes[].category` |
| 판단 근거 | `analysis.changes[].evidence` |

현재 카드에는 요약(`summary`)을 별도 영역으로 표시하지 않는다. 저장 방식(`suggestedSaveMode`)도 데이터에만 있으며 실제 저장 처리는 아직 연결하지 않았다.

로딩 표시, 버튼 디자인, 아이콘, 색상은 프론트엔드가 처리한다. API가 HTML이나 Tailwind 클래스를 보낼 필요는 없다.

## 7. 현재 구현 위치와 연동 범위

| 파일 | 역할 |
| --- | --- |
| [src/types/chat.ts](../../src/types/chat.ts) | JSON 응답에 대응하는 TypeScript 타입 |
| [src/mocks/Home/chat.ts](../../src/mocks/Home/chat.ts) | 초기 인사와 시나리오별 AI 목 응답 |
| [src/services/chat.ts](../../src/services/chat.ts) | 응답을 받아오는 함수. 현재는 1초 후 고정 목 응답을 반환 |
| [src/components/ChatReplyCard.tsx](../../src/components/ChatReplyCard.tsx) | 응답 데이터를 분석 카드로 표시 |
| [src/pages/Home.tsx](../../src/pages/Home.tsx) | 전송, 응답 대기, 메시지 목록과 초기화 관리 |

실제 API 연결 시 `getChatReply(message)` 내부를 HTTP 요청으로 교체하고 응답 구조를 확인한다. TypeScript 타입만으로 서버에서 받은 JSON이 검증되지는 않으므로, 응답을 사용할 때 필수 필드와 값의 형식도 확인해야 한다.

대화 문맥을 이어가려면 대화 ID 또는 이전 메시지를 어떤 방식으로 전달할지도 API와 협의해야 한다. 현재 함수는 입력 문자열 한 개만 받으며, 저장·수정 API와 오류 응답 형식 역시 별도 정의가 필요하다.
