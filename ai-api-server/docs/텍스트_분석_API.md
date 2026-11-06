# 실제 OpenAI 텍스트 분석 API

작성일: 2026-11-06. Python 3.15.2·FastAPI·OpenAI SDK 3.46.0에서 구현. `gpt-5.6-sol` 실제 호출 1회 통과. 활동 DB 생성·분석 저장·백엔드·홈 화면 연결은 미구현이다.

## 호출과 현재 기능 흐름

`POST http://127.0.0.1:8000/api/analyze/text`, Content-Type은 `application/json`이다. [실행 안내](../README.md)를 따른다. 정확한 스키마는 실행 중인 서버의 `/openapi.json`과 `/docs`에서 확인한다.

요청 검증 → 서버 `.env`/환경변수의 키·모델 확인 → OpenAI Responses API와 Structured Outputs 호출 → Pydantic 형식 검증 → 활동 ID·변화 근거 검증 → 결과 반환 순서다. 요청마다 클라이언트를 닫고 자동 재시도는 하지 않는다. 기본 시간 제한 45초, `reasoning.effort: low`, 최대 출력 토큰 4096, `store: false`로 호출한다. `store: false`는 응답 저장 옵션이며 모든 데이터 보존 정책을 설명하는 값은 아니다.

## 요청

```json
{
  "input": { "kind": "text", "message": "1호선톤 회의록을 정리했습니다. 별도의 기획 변경은 없었습니다." },
  "context": {
    "activities": [{ "id": "example-activity-1", "name": "1호선톤", "summary": null }],
    "records": []
  }
}
```

| 필드 | 현재 계약 |
| --- | --- |
| input.kind | 필수, `text`만 지원 |
| input.message | 필수, 공백 제거 후 1~20000자 |
| context | 선택, 생략하면 빈 활동·기록 목록 |
| context.activities | 최대 50개. id·name 필수, summary 선택/null 허용 |
| context.records | 최대 50개. id·activityId 필수, message·summary 선택/null 허용 |

활동·기록 ID는 1~200자이며 각 목록 안에서 중복할 수 없다. 기록의 activityId는 제공한 활동에 존재해야 한다. 문맥은 JSON 직렬화 기준 최대 100000자다. 정의하지 않은 필드는 거부한다. 현재 파일·링크·conversationId·멱등성 키·비동기 작업 계약은 지원하지 않는다.

**context는 분석 연결 확인용 요청 문맥이다.** 서버가 DB에서 조회하거나 사용자별 소유권을 확인한 정보가 아니다. 현재 엔드포인트는 인증 없는 로컬 개발용이며 이 결과를 검증된 DB 참조나 확정 기록으로 저장하지 않는다. 다음 단계에서 서버 측 DB 조회와 권한 검증으로 연결한다.

## 응답

성공 200. 아래 값은 구조 설명을 위한 예시이며 모델 분석 문구는 입력에 따라 달라진다.

```json
{
  "requestId": "서버가 발급한 요청 UUID",
  "analysisProvider": "openai",
  "model": "gpt-5.6-sol",
  "activityPersisted": false,
  "analysisPersisted": false,
  "analysis": {
    "activity": { "match": "existing", "id": "example-activity-1", "name": "1호선톤", "confidence": "high" },
    "materialType": "회의록",
    "stage": null,
    "summary": "회의록을 정리했으며 기획 변경은 없었습니다.",
    "changes": []
  }
}
```

- activity.match: existing/new/unresolved. existing의 ID는 요청 활동 목록에 있어야 하며 이름은 해당 목록 값으로 맞춘다. new/unresolved는 ID가 null이다.
- new는 모델이 신규 활동이라고 판단했다는 뜻이다. 현재 DB 생성 완료가 아니며 활동 생성은 다음 구현 범위다.
- materialType·summary는 비어 있지 않은 문자열이다. stage와 confidence는 확인할 수 없으면 null이다.
- changes는 최대 10개. 각 항목은 before·after·category와 1~10개의 evidence 문자열을 가진다. 근거는 입력 또는 연결된 기존 활동 기록의 message/summary에 실제 존재하는 연속 원문이어야 한다. 다른 활동 기록은 근거로 허용하지 않는다.
- 근거 문자열 존재 검사는 의미 판단의 정확도까지 보장하지 않는다. 과거/현재 내용의 해석과 실제 분석 품질은 별도로 검증해야 한다.
- requestId는 서버의 응답 추적 ID다. 영속 분석 ID가 아니며 `analysisId`·`recordId`를 발급하지 않는다. DB 테이블·기존 기록·파일은 변경하지 않는다.
- 현재 응답은 모델 분석 개발 계약이다. 프론트 `ChatReply` 변환과 백엔드 저장 참조 연결은 후속 작업이다.

## 오류

공급자 오류 원문·키·설정 객체는 응답에 포함하지 않는다. 분석 실패를 목 성공으로 대체하지 않는다.

| HTTP | code | 의미 |
| --- | --- | --- |
| 422 | FastAPI 기본 detail | 입력 종류·필드·길이·문맥 관계 등 검증 실패 |
| 503 | not_configured | 서버 키 또는 모델 미설정 |
| 502 | openai_authentication | OpenAI 인증 실패 |
| 429 | openai_rate_limit | OpenAI 요청 제한 또는 사용 한도 |
| 504 | openai_timeout | 설정한 요청 시간 초과 |
| 502 | openai_connection | OpenAI 네트워크 연결 실패 |
| 502 | openai_request_failed | 모델·권한·요청 등 기타 공급자 오류 |
| 422 | analysis_refused | 모델의 분석 거절 |
| 502 | analysis_incomplete | 미완료 응답 |
| 502 | invalid_analysis | 출력 형식·활동 ID·근거 검증 실패 |

입력 검증 실패 외의 위 오류는 `{ "error": "사용자 안내", "code": "오류 코드" }` 형식이다. 제한·시간 초과에 재시도하려면 사용자가 명시적으로 요청한다. 분석 결과는 보관하지 않으므로 반복 호출 시 새로운 비용이 발생할 수 있다.

## 검증 기록

- 키·외부 호출 없는 unittest 13개 통과: 기본 서버 5개와 SDK 요청 구성·실패/거절/미완료·입력·활동 ID·근거·비영속 응답 검사 8개.
- `python -m scripts.check_openai`: 합성 활동·텍스트를 사용한 실제 FastAPI TestClient → SDK → OpenAI 호출 통과. 설정 모델 `gpt-5.6-sol`, existing ID 유지, changes 0개, 영속 저장 없음 확인.
- 실제 호출은 이 경계의 연결 검증 1회다. 신규 활동·복잡한 변화의 모델 품질, DB·프론트·파일·링크·브라우저 Swagger 조작은 검증하지 않았다.

실제 키를 테스트 코드나 문서에 포함하지 않았다. 수동 검증 스크립트는 실행할 때 실제 요청 1회가 발생하며 unittest에서 자동 실행하지 않는다.

## 코드와 다음 단계

- [입출력 모델](../app/schemas.py), [OpenAI 호출·검증](../app/analysis.py), [FastAPI 라우트](../app/main.py), [설정](../app/config.py)
- [경계 검사](../tests/test_analysis.py), [실제 호출 수동 검사](../scripts/check_openai.py)

다음은 DB 문맥 조회·신규 활동 생성·분석 보관과 활동 생성 완료 응답이다. 백엔드가 실제 분석 ID를 참조할 수 있게 한 뒤 프론트 호출을 전환한다. [전체 작업 계획](작업_계획.md)을 따른다.

공식 참고: [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol).
