# AI 담당자 전달사항

갱신일: 2026-11-12 · 상태: 구현 요구사항 작성 완료, 실제 전달·AI 구현·연동은 미확인

## 읽기 순서와 범위

[공통 JSON 계약](공통_JSON_계약.md)이 이번 변경의 기준이다. [전체 교환 예시](examples/journey-exchange.json)의 request → providerResponse를 구현한다. publicResponse는 Spring이 최종 ID·analysis·evidenceSources를 추가한 프론트 응답이다.

기존 자유 유형 생성과 비교 시 서로 다른 기록 2개 필수 규칙은 폐기한다. 실제 AI 서버 소스 수정·모델 평가·배포는 AI 담당자 작업이다. 여기서는 구현 계약과 사례를 전달하며 실제 계정으로 메시지를 보내지는 않는다.

## 인정·제외 조건

| 유형 | 인정 | 제외 | 필수 추가 정보 |
| --- | --- | --- | --- |
| 능력 확장 | 이전에 수행하지 않았던 기술·역할·업무 실제 수행 | 학습 계획·조사만 작성 | 없음 |
| 성과 향상 | 비교 가능한 조건에서 결과 개선 | 이전 결과·비교 조건 불명확 | comparison |
| 경험 축적 | 기록 범위에서 새로운 활동·경험 실제 수행 | 동일 경험 반복·수행 불명확 | 없음 |
| 효율성 | 유사한 결과 수준에서 시간·자원 절감 | 결과 수준 확인 없이 빨라졌다는 주장 | comparison |
| 경험 전이 | 이전 활동의 경험을 다른 활동에 실제 활용 | 같은 기술 사용·연결 불명확 | transfer |

모든 유형에 reason/evidence를 반환한다. 기록상 첫 경험을 인생 전체의 첫 경험으로 단정하지 않는다.

## 모델·AI 서버 책임

- 모델은 허용된 5종 ID만 선택한다. 이벤트당 1~5종, 같은 type 중복 금지다.
- 모델은 고정 필터·ID·월을 생성하지 않는다. AI 서버가 typeOptions·전체 분야·임시 ID·실제 활동명·근거 저장 월을 구성한다.
- 모델은 각 중첩 근거에서도 evidenceCatalog의 evidenceId를 선택한다. AI 서버가 원문을 복원하며 Spring·DB에는 recordId/quote만 전달한다.
- comparison에는 before, after, condition과 beforeEvidence/afterEvidence가 필요하다. 모델 내부 각 근거는 evidenceId 배열이다.
- 같은 한 문장이 양쪽 상태를 뒷받침하면 같은 ID를 양쪽에 선택할 수 있다. 배열별 중복 정리는 가능하나 서로 다른 역할을 없애지 않는다.
- transfer에는 sourceActivity, experience, targetActivityId, application, sourceEvidence, applicationEvidence가 필요하다. 출발 활동 미등록 시 id:null, 실제 적용 활동 ID는 필수다.
- 미등록 활동은 원문에 있는 이름으로 설명한다. 가짜 활동 ID를 생성하거나 이름 유사성만으로 등록 활동과 연결하지 않는다.
- 역할별 근거는 판단의 전체 evidence에 포함한다. 같은 원문을 다른 유형에도 사용할 수 있으나 각 인정 조건을 따로 충족해야 한다.
- 근거 없는 판단·배지는 생성하지 않는다. 성장 근거가 부족하면 events/badges는 []이며 실제 근거가 있는 판단 유보 summary를 반환한다.
- 기록 밖 수치·조건·경험·인과를 추정하지 않는다. 원문 존재 검증과 별도로 판단 의미가 근거에 부합하는지 확인한다.

## 버전·입출력

- schemaVersion: journey-result-v2
- criteriaVersion: growth-criteria-v1
- promptVersion: journey-v6
- POST /api/analyze/journey의 records/recordCount/sourceFingerprint와 버전을 JSON 본문으로 받는다. 현재 Spring의 본문 없는 호출도 이번 구현에서 변경된다.
- 전달받은 sourceFingerprint를 그대로 반환한다. AI가 해시를 재계산하거나 결과를 확정 저장하지 않는다.
- 미지원 입력 버전·입력 초과는 422, 잘못된 모델 출력·근거는 502로 구분한다.
- 기존 comparison_needs_distinct_records 검증을 제거하고 comparison_evidence_invalid, transfer_evidence_invalid 진단을 사용한다.
- 공개 오류 {error}와 진단 ID 정책을 유지하고 원문·모델 응답 전문을 로그에 남기지 않는다.
- 제한 수치와 공개 필드별 규칙은 공통 계약을 따른다. 모델의 선택 객체 null은 공개 result에서 키 생략으로 정규화한다.

## 인정·제외 사례와 기대 결과

아래는 평가용 기대 예시이며 실제 모델 검증 결과가 아니다. 특정 유형 제외가 전체 분석 실패를 뜻하지는 않는다. 다른 인정 유형이 없으면 정상 빈 결과다.

| 입력 | 기대 |
| --- | --- |
| “서버 배포를 공부할 계획이다.” | 능력 확장 제외 |
| “이번에 처음 서버 배포 업무를 직접 완료했다.” | capability_expansion 가능, reason/evidence 필수 |
| “동일 조건의 테스트에서 통과율이 70%에서 95%가 됐다.” | performance_improvement, comparison 필수. 같은 기록 허용 |
| “더 쉬운 테스트에서 점수가 올랐다.” | 비교 가능성 부족으로 성과 향상 유보 |
| “기록상 처음 사용자 인터뷰를 직접 진행했다.” | experience_accumulation 가능 |
| “기존과 같은 인터뷰를 반복했다.” | 새 경험 근거 없으면 경험 축적 제외 |
| “배포는 30분에서 5분으로 줄었고 같은 테스트 10개를 통과했다.” | efficiency_improvement, 같은 인용문을 beforeEvidence/afterEvidence에 허용 |
| “작업이 빨라졌지만 결과가 같은지는 모르겠다.” | 효율성 근거 부족 |
| “개인 프로젝트에서 익힌 EC2 설정을 Growth AI 배포에 적용했다.” | experience_transfer, 출발 활동 미등록 허용. transfer 및 양쪽 역할 근거 필수 |
| “두 프로젝트에서 모두 React를 썼다.” | 실제 전이 연결 부족으로 경험 전이 제외 |
| “예전 경험을 활용했다.” | 출발 경험·적용 활동·활용 내용 불명확으로 유보 |

## 정상 결과와 잘못된 응답의 구분

| 응답 사례 | Spring 기대 처리 |
| --- | --- |
| 근거를 갖춘 유보 summary, 빈 events/badges | 200 저장 |
| 알 수 없는 유형 또는 같은 유형 중복 | 502 저장 거절 |
| 성과·효율성에 comparison 누락 | 502 저장 거절 |
| 경험 전이에 transfer 누락·적용 ID 불일치 | 502 저장 거절 |
| before/after 한쪽 근거 누락 | 502 저장 거절 |
| 카탈로그에 없는 evidenceId 또는 실제 원문과 불일치 | AI 단계에서 502, Spring도 원문 재검증 |
| 요청과 다른 해시·기록 수 또는 분석 중 기록 변경 | Spring에서 409, 저장 거절 |

## UI 전달 의도

프론트는 카드 클릭 시 판단 이유·간결한 비교·전이 설명만 먼저 보여준다. 원문과 출처는 추가 펼침으로 표시한다. AI는 화면이 간결하다는 이유로 검증용 정보를 생략하지 않는다. 중복 원문은 역할을 보존한 상태로 프론트가 모아서 표시한다.

## 후속 확인

실제 AI 구현과 계약 대조, 실제 모델의 인정·제외 품질 평가, 인증·네트워크·처리 시간 및 배포 검증은 후속 작업이다.

