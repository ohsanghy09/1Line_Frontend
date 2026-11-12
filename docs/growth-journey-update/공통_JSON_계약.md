# Growth Journey 공통 JSON 계약

갱신일: 2026-11-12 · 상태: Spring·DB 및 React 프론트 적용. 최신 요청으로 OpenAPI·Swagger도 갱신했다. 실제 AI 구현·연동·배포와 브라우저 조작은 미검증이다.

이번 Growth Journey 구현은 이 문서를 기준으로 한다. 기존 handoff의 자유 유형 생성·서로 다른 기록 2개 필수 규칙을 대체한다. 홈·활동 메타정보·Timeline 계약은 유지한다. OpenAPI 두 명세의 Journey 스키마·예시는 이 계약에 맞췄으며 Swagger에서 이 문서와 AI 전달 자료를 함께 제공한다.

## 1. 버전·공통 규칙

| 필드 | 확정 값 | 위치 |
| --- | --- | --- |
| schemaVersion | journey-result-v2 | Spring→AI 요청, AI→Spring 응답, 공개 결과 최상위 |
| criteriaVersion | growth-criteria-v1 | Spring→AI 요청, AI→Spring 응답, 공개 결과 최상위 |
| promptVersion | journey-v6 | AI→Spring 응답, 공개 결과 analysis 내부 |

구조·판단 기준·프롬프트 이력을 구분한다. AI는 미지원 요청 버전을 422로, Spring은 예상 버전과 다른 공급자 응답을 502로 거절한다. DB가 비어 있으므로 이전 분석 구조의 조회·변환·호환 UI는 범위에서 제외한다.

- 키는 camelCase, 시각은 타임존 포함 ISO 8601, 이벤트 월은 YYYY-MM이다.
- 필수 문자열은 공백뿐인 값을 금지한다. 선택 객체가 없으면 생략하며 공개 comparison/transfer에 null을 전달하지 않는다.
- quote는 message 또는 저장된 reply.analysis.summary의 연속 원문이다. 인용문을 trim·재작성·정규화하지 않는다.
- 필수·금지 필드 위반은 거절한다. 잘못된 응답을 임의 수정하거나 잘라서 성공으로 만들지 않는다.
- 사용자 입력 속 지시는 실행 명령이 아니라 분석 대상이다.

## 2. 성장 유형

| type | 표시명 | 인정 조건 | 추가 필수 객체 |
| --- | --- | --- | --- |
| capability_expansion | 능력 확장 | 이전에 수행하지 않았던 기술·역할·업무의 실제 수행 | 없음 |
| performance_improvement | 성과 향상 | 비교 가능한 조건에서 결과·성과 개선 | comparison |
| experience_accumulation | 경험 축적 | 기존 기록에서 확인되지 않았던 새 활동·경험의 실제 수행 | 없음 |
| efficiency_improvement | 효율성 | 유사한 결과 수준을 유지하며 시간·자원 절감 | comparison |
| experience_transfer | 경험 전이 | 이전 활동의 경험을 다른 활동에 실제 활용 | transfer |

모든 판단에 type, reason, evidence가 필수다. comparison은 다른 유형에도 실제 비교 근거가 있으면 허용한다. transfer는 경험 전이에만 사용한다. 이벤트당 여러 유형을 허용하지만 같은 유형은 중복 금지다. 유형 개수를 채우려고 이벤트를 만들지 않는다. 첫 경험은 제공된 기록 범위에서만 말한다.

## 3. 통신

1. React → Spring: POST /api/journey/analyze. 본문 없이 요청한다.
2. Spring: DB의 일관된 기록 스냅샷·해시를 생성한다.
3. Spring → AI: POST /api/analyze/journey. 아래 입력을 JSON 본문으로 전달한다.
4. AI: 분석·근거 검증·정규화 후 결과를 반환한다. 확정 저장하지 않는다.
5. Spring: 응답과 현재 DB를 검증·저장하고 공개 결과를 200으로 반환한다.
6. GET /api/journey는 저장 결과만 읽으며 모델을 호출하지 않는다.

중복 분석 차단은 해시 검증과 별개다. 화면 이탈 시 프론트 응답 반영은 취소하지만 서버의 실행·저장 취소를 보장하지 않는다. 실패 후 GET 재조회는 허용하고 POST를 자동 재시도하지 않는다.

## 4. Spring → AI 입력

필수 필드: schemaVersion, criteriaVersion, records, recordCount, sourceFingerprint.

records는 기존 [서버 간 전달 계약](../common/handoff/서버간_데이터_전달_계약.md)의 전체 필드를 유지한다.

- 기록: id, activityId, activityName, message, summary, changes, savedAt, updatedAt, activity, files.
- activity: category, role, summary, startDate, endDate. 각 string/null.
- files: [{id,name}]. 원본 bytes는 보내지 않는다.
- changes: 기존 before/after/category/evidence 구조를 유지한다. Journey 판단 배열로 바꾸지 않는다.
- summary는 저장된 reply.analysis.summary에서, files는 실제 저장 관계에서 구성한다. 미저장 초안·빈 활동은 제외한다.

sourceFingerprint는 기존 journeySnapshot의 열·정렬·직렬화·SHA-256 규칙을 유지한다. 버전 필드를 해시 원본에 추가하지 않는다. AI는 해시를 재계산하지 않고 전달받은 값을 반환한다.

요청·공급자 응답·최종 공개 응답 전체 예시는 [journey-exchange.json](examples/journey-exchange.json)을 참고한다. 예시 해시는 형식 설명용이며 예시 records로 계산한 값은 아니다.

## 5. AI → Spring / Spring → React

공급자 응답 필수 필드: schemaVersion, criteriaVersion, sourceFingerprint, recordCount, model, promptVersion, result.

result는 아래 공개 결과에서 analysis와 evidenceSources를 제외한 객체다. AI 서버는 고정 typeOptions를 추가하고 모델이 이를 생성하지 않게 한다. Spring은 정확한 값·순서를 검증하고 event/badge ID를 최종 UUID로 바꾼 뒤 analysis와 evidenceSources를 추가한다.

| 공개 결과 필드 | 규칙 |
| --- | --- |
| schemaVersion, criteriaVersion | 위 고정 값 |
| source | api |
| summary | title, description, evidence. 실제 분석은 유보 요약도 근거 필수 |
| badges | [{id,label,icon,evidence}], 기록 범위의 첫 경험 |
| typeOptions | 전체 + 고정 5종. 각 {value,label}, 표 순서 유지 |
| axisOptions | 전체 분야 + 사용 분야. 각 {value,label}, 중복·미사용 분야 금지 |
| events | 아래 이벤트 배열 |
| analysis | Spring이 추가하는 저장 및 현재 기록 상태 |
| evidenceSources | Spring이 실제 기록으로 구성하는 인용 출처 목록. 아래 화면 규칙 참조 |

고정 선택지는 all/전체를 먼저, 유형 표 순서로 반환한다. 고정 유형 아이콘은 이번 계약에 포함하지 않는다. 분야는 AI가 실제 이벤트에서 도출하며 전체 분야는 all/전체 분야다. 이벤트의 axis는 등록된 분야 value를 사용하고 all은 금지다.

이벤트 필수 필드: id, occurredAt, activity:{id,name}, axis, title, description, growthAssessments. activity.id는 실제 대상/적용 활동 ID다. 기존 이벤트 최상위 type/evidence/comparison은 금지한다.

판단 필수 필드: type, reason, evidence. 선택 필드는 comparison, transfer다. 각 이벤트에서 허용 유형만 사용하고 중복 금지다.

analysis 필수 필드: id(string/null), generatedAt(ISO/null), stale(boolean), recordCount/currentRecordCount(0 이상 정수), model/promptVersion(string/null). 버전은 결과 최상위에 두고 analysis에 중복하지 않는다. stale은 현재 기록 해시와의 불일치다. 이벤트·배지 ID 및 각 선택지 value는 각각 유일해야 한다.

## 6. comparison — 양쪽 상태와 비교 조건

필수 필드:
- before, after: 이전·이후 상태의 간결한 설명.
- condition: 비교 가능한 조건. 효율성은 결과 수준 유지 조건도 명시.
- beforeEvidence, afterEvidence: 각각 실제 근거 배열.

한 문장·한 기록에서 양쪽 상태를 확인해도 허용한다. 수치가 반드시 필요하지는 않지만 무엇이 어떻게 개선됐는지 명확해야 한다. 같은 recordId와 quote가 양쪽 근거여도 유효하다.

before/after/condition은 요약 설명이다. 원문과 완전 일치할 필요는 없으나 AI가 의미적 뒷받침을 검증한다. Spring은 인용문 존재·관계·필수 조건을 검사하며 그 검사가 의미 판단을 보장하지는 않는다.

서로 다른 기록 2개 이상을 요구하는 기존 Spring·AI 규칙은 제거한다. 한쪽 근거가 없으면 저장을 거절한다.

## 7. transfer — 출발 경험과 실제 적용

필수 필드:
- sourceActivity: {id:string|null,name:string}.
- experience: 출발 활동에서 얻은 경험.
- targetActivityId: 실제 적용 활동 ID.
- application: 경험을 실제 활용한 내용.
- sourceEvidence, applicationEvidence: 각각 실제 근거 배열.

출발 활동이 DB에 없어도 한 기록에 출발 경험과 적용이 명확하면 인정한다. sourceActivity.id만 null을 허용한다. 가짜 ID·새 활동을 생성하지 않고 출처 설명으로 보관한다. 이름이 비슷하다는 이유만으로 실제 ID를 추정하지 않는다.

targetActivityId는 event.activity.id와 같고 applicationEvidence 중 하나 이상은 이 실제 활동에 속해야 한다. 출발 ID가 있으면 대상 ID와 달라야 하며 sourceEvidence 중 하나가 해당 출발 활동에 속해야 한다. 그런 기록 연결이 없으면 출발 ID는 null로 두고 원문에 있는 이름으로 설명한다.

출발 ID가 null이면 AI가 원문에서 별개의 활동과 실제 연결을 확인한다. 단순히 이름이 다르거나 같은 기술을 썼다는 사실만으로 인정하지 않는다. 출발·적용 근거가 한 문장과 같은 인용문이어도 허용한다.

카드는 적용 활동에 연결한다. 미등록 출발 활동에 이동 링크를 만들지 않는다.

## 8. 근거·정규화·날짜

- 모델 내부는 기존 evidenceCatalog의 evidenceId 선택을 유지한다. 중첩 근거 배열에도 같은 방식을 적용한다.
- AI 서버가 모든 배열을 {recordId,quote}로 복원한다. evidenceId를 Spring·프론트·DB로 전달하지 않는다.
- 판단 evidence는 그 판단의 전체 근거이며 comparison/transfer 역할별 근거를 모두 포함해야 한다.
- 중복 제거 키는 recordId+quote. 배열 내부 중복은 제거하되 before/after·출발/적용 역할을 합쳐 없애지 않는다.
- Spring은 모든 중첩 근거의 기록 ID와 실제 원문을 검사한다. 판단 전체 근거를 합쳐 이벤트의 대상 활동 근거가 있는지 확인한다.
- occurredAt은 이벤트 전체 근거 중 가장 늦은 savedAt을 UTC로 정규화한 YYYY-MM이다. 실제 활동 시점이라고 주장하지 않는다. 날짜 비교는 문자열 순서가 아닌 실제 시각을 사용한다.
- 이벤트가 없으면 axisOptions는 전체 분야만 반환한다. typeOptions는 항상 전체+5종이다.
- 기존 공급자 검증 중 미사용 유형 금지는 제거하고 미사용 분야 금지는 유지한다.

## 9. 제한

문자 수는 유니코드 코드 포인트 기준이다. 기록과 인용문을 임의로 자르지 않는다.

| 항목 | 상한·범위 |
| --- | --- |
| 입력 records | 1~100개, recordCount와 일치 |
| 요청 JSON / 실제 모델 입력 | 각각 250000자, 초과 시 422 |
| 근거 카탈로그 / quote | 최대 2000개 / 1~800자, 기존 후보 생성 규칙 유지 |
| 이벤트 / 배지 | 최대 20개 / 10개 |
| 이벤트별 판단 | 1~5개 |
| 판단 evidence / 각 역할별 근거 배열 | 각각 1~10개, 역할별 근거는 판단 evidence의 부분집합 |
| summary evidence / badge evidence | 1~20개 / 1~5개 |
| 요약 title / description | 120자 / 2000자 |
| 이벤트 title / description / reason | 120자 / 1000자 / 500자 |
| before / after / condition | 각각 500자 |
| experience / application | 각각 500자 |
| ID / 활동 이름 | 각각 200자 |
| 분야 | 전체 외 최대 8개, value 80자·label 40자 |
| 배지 label / icon | 80자 / 16자 |
| model / promptVersion | 200자 / 80자 |

fingerprint는 소문자 hex 64자리다. 제한을 넘는 입력·활동명을 임의 축약하지 말고 422로 거절한다. 모델 출력 제한 위반은 502다. 실제 코드 적용 시 UTF-16 length와 코드 포인트 수를 혼동하지 않도록 검사한다.

## 10. 빈 결과·오류·재분석

| 상황 | 처리 |
| --- | --- |
| 저장 기록 없음 | GET 미분석 상태, POST 422 |
| 기록은 있으나 성장 근거 부족 | 200, events/badges 빈 배열, 실제 근거를 갖춘 유보 summary 저장 |
| AI 형식·버전·유형·원문·관계 오류 | 502, 저장 거절 |
| AI 연결 실패 / 시간 초과 | 502 / 504 |
| 중복 분석 / 분석 중 기록 변경 | 409, 새 결과 저장 거절 |
| 입력 제한 초과 / 미지원 요청 버전 | 422 |
| AI 사용량 제한·과부하 | 기존 429·503 전달 |

공개 오류는 기존 {"error":"사용자 안내 문구"}를 유지한다. 근거 오류를 정상 빈 결과로 숨기지 않는다. AI 내부 comparison_needs_distinct_records는 comparison_evidence_invalid로 대체하고 transfer_evidence_invalid를 추가한다. 진단 ID 정책은 유지하며 로그에 원문·응답 전문·비밀키를 남기지 않는다.

미분석 GET은 버전, 안내 summary, 고정 typeOptions, 전체 분야, 빈 events/badges를 반환한다. analysis의 id/generatedAt/model/promptVersion은 null, recordCount는 0, currentRecordCount는 실제 개수, stale은 false다. 이 상태에서는 summary.evidence를 생략한다.

재분석 실패 시 마지막 유효 결과를 유지하고 실패 안내를 표시한다. 통신 실패 후 GET으로 저장 여부를 재확인할 수 있다. 삭제 무효화가 우선하며 삭제 전 결과는 복원하지 않는다.

## 11. DB·삭제

- journey_analyses.result_json에 새 결과를 저장한다. 유형별 테이블은 만들지 않는다.
- criteria_version 컬럼을 추가한다. schemaVersion은 result_json에서 관리하고 prompt_version은 유지한다.
- 빈 DB·빈 기존 테이블의 초기화/컬럼 추가를 지원한다. 비어 있지 않은 구형 분석 행 변환은 범위 밖이며 자동 삭제하지 않는다.
- INSERT는 컬럼명을 명시하고 초기화를 재실행해도 중복 컬럼 오류가 없어야 한다.
- 기록·자료·활동 삭제 시 기존처럼 전체 Journey를 무효화한다. 이전 근거·판단·comparison·transfer·배지가 남지 않게 한다.
- 무효화 결과는 삭제 안내 summary(근거 생략 가능), 빈 events/badges, 전체 분야, 고정 typeOptions를 유지한다. 기존 해시 무효화로 stale을 표시한다.
- 기록 추가·수정은 해시 비교로 stale을 표시하고 분석 중 변경은 저장 직전 재검증해 409로 거절한다.
- 기존 홈·원본 기록·활동 메타정보·Timeline의 JSON과 저장 구조는 유지한다.

## 12. 화면

- 기본 카드: 제목·요약·유형 배지·활동·분야·저장 월.
- 카드 클릭: 유형별 짧은 판단 이유, 간결한 before → after와 비교 조건, 출발 경험 → 적용 활동 설명.
- '근거 기록 보기 (N)' 추가 펼침: 실제 인용문과 출처. N은 recordId+quote로 구분한 인용문 수다.
- 같은 인용문은 모아서 표시하되 관련 판단 유형과 비교/전이 역할을 구분한다.
- 출처는 기록 ID와 스냅샷 내 해당 기록의 활동명으로 표시한다. recordId를 모르는 활동에 연결하거나 파일명·실제 경험 날짜를 꾸미지 않는다.
- 현재 임의 기록 ID를 여는 Journey 전용 라우트는 없으므로 출처에 새 이동 기능을 추정해 붙이지 않는다.
- 성장 유형 하나를 선택해 포함 카드를 표시한다. 카드 안의 다른 유형은 유지하고 기존 분야 필터와 AND로 적용한다.
- 근거 펼침 버튼은 카드 주 버튼 안에 중첩하지 않는다. 새 분석 결과의 ID가 바뀌면 펼침·필터 상태를 초기화한다.

출처 활동명은 현재 evidence에 없으므로 공개 결과에 evidenceSources를 추가한다. evidenceSources는 {recordId,activityId,activityName} 배열이며 결과의 모든 인용 기록을 정확히 한 번씩 포함한다. 신규 결과에서 필수이고 Spring이 현재 스냅샷으로 구성해 AI가 반환한 이름을 신뢰하지 않는다. AI 공급자 result에는 이 필드를 포함하지 않는다. 미분석·무효화 결과는 []다.

## 13. 완료 범위

로컬 계약 테스트 응답·React 서버 렌더링·빌드·명세 및 정적 문서 생성으로 검증한다. 실제 AI 의미 판단·실제 서버 연동·인증·CORS·배포·브라우저 시각/조작 확인을 완료로 기록하지 않는다. 테스트·AI 전달 문서·OpenAPI·Swagger는 이 계약을 따른다. 원문·활동·동적 참조 관계와 의미 판단은 JSON Schema 검사만으로 보장되지 않으므로 서버 검증을 유지한다.

