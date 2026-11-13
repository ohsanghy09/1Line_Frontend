# AI API 정의서

> Growth Journey v2 (2026-11-12): [최신 공통 JSON 계약](../../growth-journey-update/공통_JSON_계약.md)과 [전체 요청·응답 예시](../../growth-journey-update/examples/journey-exchange.json)를 따른다. Spring·프론트 및 OpenAPI·Swagger는 반영했으나 실제 AI 구현·원격 연동·배포는 미검증이다.


기준일: 2026-11-06. [공통 계약](../../common/handoff/공통_데이터_계약.md) · [서버 간 전달](../../common/handoff/서버간_데이터_전달_계약.md)

Base는 AI 파트가 제공하는 HTTPS 주소이며 /api까지 포함한다. 프론트 개발용 /ai-api는 별칭이었으며 실제 AI API 접두사가 아니다. 아래 경로는 Base 뒤 경로다. 현재 사용자 인증·내부 전용 토큰 검증은 없다. ‘내부’는 현재 호출자를 뜻하며 네트워크 차단이 구현됐다는 의미가 아니다.

## 공개 홈 API

| 메서드·경로 | 기능 | 요청 | 정상·실패 |
| --- | --- | --- | --- |
| GET /chat/health | HOME-09 | checkConnection:boolean query 선택 기본 false | 200 {status:ready/unavailable,label,analysisProvider:openai,network?}. 기본은 키·모델·DB 스키마 검사, 모델 호출 없음 |
| POST /chat | HOME-01,02,07 | multipart 아래 표 | 기본 202 JobResponse. 파일 없음+Prefer:respond-sync이면 완료 대기 후 200. 실패 envelope도 가능 |
| POST /chat/links | HOME-03 | JSON {url,conversationId?,requestId?}, Content-Type:application/json | 202 JobResponse. URL 입력 400/422, 키·DB 503, 중복 키 충돌 409 |
| GET /chat/jobs/:jobId | HOME-08·파일/링크 진행 | ai-로 시작하는 jobId | 200 JobResponse, 없음 404 {error,code:job_missing} |

multipart의 Content-Type과 boundary는 브라우저가 생성한다. 별도로 application/json을 지정하지 않는다.

| 필드·헤더 | 필수 여부·제약 |
| --- | --- |
| message | 선택 string 기본 '', 최대 20000자. 공백 아닌 message 또는 파일 중 하나 필요 |
| files | 반복 파일 필드, 최대 10개. 각 비어 있지 않은 10MiB 이하·합계 25MiB 이하. 확장자 검증 |
| conversationId | 선택 string, trim 후 길이 1~200 |
| requestId | 선택 string, trim 후 길이 1~200. 없으면 서버 UUID |
| Prefer | respond-sync / respond-async. 파일이 있으면 sync를 보내도 비동기 |

파일 전 검증은 400(empty_input/invalid_input/invalid_file/files_too_large), 415(unsupported_file) 등이 있다. 접수 후 인코딩·내용 분석·모델 실패는 작업 status=failed로 보관될 수 있다. JSON 입력의 정의되지 않은 추가 키는 거절하며 링크 url은 길이 1~4096, conversationId/requestId는 길이 1~200이다. URL 의미 검증은 별도로 수행한다.

링크 요청 예시:

```json
{"url":"https://example.org/public-note","conversationId":"conversation-01","requestId":"request-link-01"}
```

### JobResponse 필드와 예시

필수는 jobId:string, status:running/completed/failed, analysisProvider:openai다. running은 progress와 pollAfterMs=400, completed는 progress·pollAfterMs·result, failed는 error·code를 가진다. 진행/실패/완료 분기에서 사용하지 않는 선택 필드는 null로 채우지 않고 생략한다.

```json
{"jobId":"ai-job-01","status":"running","analysisProvider":"openai","pollAfterMs":400,"progress":{"title":"입력과 기존 기록을 확인하고 있어요.","steps":[{"label":"입력과 기존 기록을 확인하고 있어요.","status":"working"}]}}
```

완료 result 필수 키는 analysisId,conversationId,message,reply,attachments,createdAt이다. reply는 모델 출력과 다른 화면용 객체다.

```json
{"jobId":"ai-job-01","status":"completed","analysisProvider":"openai","pollAfterMs":400,"progress":{"title":"분석 결과를 준비했어요.","steps":[{"label":"입력과 기존 기록을 확인하고 있어요.","status":"completed"},{"label":"AI가 실제 자료를 분석하고 있어요.","status":"completed"},{"label":"분석 결과를 보관하고 있어요.","status":"completed"}]},"result":{"analysisId":"draft-01","conversationId":"conversation-01","message":"안녕","reply":{"id":"reply-draft-01","role":"assistant","kind":"general","content":"안녕하세요! 어떤 경험을 남겨볼까요?","analysis":null},"attachments":[],"createdAt":"2026-11-06T09:00:00.000Z"}}
```

```json
{"jobId":"ai-job-01","status":"failed","analysisProvider":"openai","error":"분석 응답 시간이 초과됐어요. 다시 시도해 주세요.","code":"openai_timeout"}
```

같은 requestId의 fingerprint가 같으면 기존 작업을 반환하고 모델을 중복 실행하지 않는다. fingerprint는 message/sourceUrl/conversationId와 파일명·MIME·bytes를 반영한다. 업로드 때마다 새로 발급한 파일 ID는 비교 입력에서 제외한다.

### 직접 활동 수정 중간 reply

```json
{"id":"reply-draft-02","role":"assistant","kind":"activity-update","content":"활동 정보를 수정하고 있어요.","analysis":null,"update":{"activityId":"activity-01","activityName":"북클럽봄","updates":[{"field":"role","value":"팀장"}]}}
```

완료 result가 이 reply이면 프론트는 백엔드 `/activities/apply-chat-update`에 analysisId만 보내고, 서버가 보관한 요청을 적용한 뒤 general 완료 응답을 표시한다. SQL이나 클라이언트가 편집한 update를 전송하지 않는다.

## 백엔드가 호출하는 내부 분석

2026-11-13 Spring은 활동 정보 분석 JSON 스냅샷과 남은 파일 재분석의 실제 원본·recordReply·활동 정보를 전송하도록 구현했다. AI는 백엔드 DB를 직접 조회하지 않고 전달받은 문맥으로 분석하며 활동 sourceFingerprint와 삭제 요청 recordReply를 그대로 반환한다. Spring의 로컬 검증 완료이며 실제 AI 수신·연동 완료를 의미하지 않는다.

| 메서드·경로 | 요청 | 응답·저장 책임 |
| --- | --- | --- |
| POST /analyze/activities/:activityId | JSON 활동 스냅샷. activity/previous/records/files/recordCount/sourceFingerprint, 상세는 서버 간 전달 계약 | {sourceFingerprint,recordCount,model,promptVersion:activity-metadata-analysis,metadata}. 백엔드가 근거·해시 재검증 후 activities 갱신 |
| POST /analyze/journey | JSON {schemaVersion,criteriaVersion,records,recordCount,sourceFingerprint} | {schemaVersion,criteriaVersion,sourceFingerprint,recordCount,model,promptVersion:journey-v6,result:FreshJourney}. Spring이 검증·출처 추가 후 저장 |
| POST /analyze/records/:recordId/exclude-file | JSON {fileId,recordReply,activity,files:남은 원본[]}, 상세는 서버 간 전달 계약 | {reply,recordReply:string,fileIds:string[]}. recordReply는 기존 records.reply JSON 원문. fileIds는 요청의 남은 원본 순서. 백엔드가 검증·삭제 |

Journey v5는 AI 내부 모델에만 evidenceCatalog와 evidenceId 선택을 사용한다. 위 요청에는 카탈로그가 필요 없고 응답의 summary/badges/events 근거는 계속 [{recordId,quote}]다. 내부 입력·선택·복원·한도는 [분석 규칙](분석_입출력과_검증_규칙.md)의 Journey 절을 따른다. 기존 버전 결과를 새 내부 모델 스키마로 다시 검증하거나 마이그레이션하지 않는다.

활동 없음 404, 기록 없음·분석 범위 한도 422, 입력 충돌 409, 공급자/출력 오류 502, 설정·DB 503, 시간 초과 504, 모델 한도 429가 가능하다. 삭제 대상 실재 여부는 백엔드가 검증한다. 삭제 전 원본이 2개 이상일 때 AI에 전달되는 남은 files는 1개 이상이므로 1개 입력을 거절하지 않는다. AI는 fileId가 남은 files에 포함되지 않는지 검증하고 recordReply는 모델 입력 없이 원문 그대로 반환한다. 모델 호출 도중 생긴 변경은 백엔드 저장 단계에서 추가 409로 거절한다.

metadata 객체는 summary:{value,evidence}, status:{value:진행 중/완료,evidence}/null, role:{value,evidence}/null, period:{start:{value,evidence}/null,end:{value,evidence}/null}다. evidence는 {recordId,quote} 1~10개, 문자열은 비빈 최대 20000자다. 날짜는 유효 YYYY-MM/일 단위이며 이전 반대 날짜와 순서도 검증한다.

위 내부 요청 본문은 공유 로컬 DB가 없는 새 서버를 위한 분리 구현 규격이다. 기존 개발 서버의 ID 전용 요청이 그대로 동작하는 것처럼 해석하지 않는다. 요청·원본·완료 게시에 필요한 모든 필드는 [서버 간 전달 계약](../../common/handoff/서버간_데이터_전달_계약.md)에 정의했다. 아래 응답의 sourceFingerprint는 백엔드가 요청에 보낸 64자리 hex를 그대로 돌려준다. 임의 예시 해시는 실제 저장 검증을 통과하지 않으며 model도 실제 설정값으로 대체한다.

```json
{"sourceFingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","recordCount":1,"model":"configured-model","promptVersion":"activity-metadata-analysis","metadata":{"summary":{"value":"북클럽봄을 시작했어요.","evidence":[{"recordId":"record-01","quote":"북클럽봄을 시작했어요."}]},"status":null,"role":null,"period":{"start":null,"end":null}}}
```

### Growth Journey v2 응답

고정 5종, 유형별 판단 배열, 한 기록의 비교와 미등록 출발 활동을 지원한다. 전체 입력과 공개 응답은 위 JSON 예시를 참고한다. 근거 부족은 근거를 갖춘 요약과 빈 events/badges로 정상 반환한다. analysis와 evidenceSources는 AI가 반환하지 않고 Spring이 추가한다.

한 문장의 효율성·경험 전이 응답 예시(해시는 형식 예시):

```json
{
  "schemaVersion": "journey-result-v2",
  "criteriaVersion": "growth-criteria-v1",
  "sourceFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "recordCount": 1,
  "model": "configured-model",
  "promptVersion": "journey-v6",
  "result": {
    "schemaVersion": "journey-result-v2",
    "criteriaVersion": "growth-criteria-v1",
    "source": "api",
    "summary": {
      "title": "배포 경험을 활용해 시간을 줄였어요.",
      "description": "같은 테스트를 통과하며 배포 경험을 다른 활동에 적용했어요.",
      "evidence": [
        {
          "recordId": "record-01",
          "quote": "개인 프로젝트에서 익힌 EC2 설정을 Growth AI에 적용했고, 배포 자동화로 30분에서 5분으로 줄이면서 같은 기능 테스트 10개를 모두 통과했다."
        }
      ]
    },
    "badges": [],
    "typeOptions": [
      {
        "value": "all",
        "label": "전체"
      },
      {
        "value": "capability_expansion",
        "label": "능력 확장"
      },
      {
        "value": "performance_improvement",
        "label": "성과 향상"
      },
      {
        "value": "experience_accumulation",
        "label": "경험 축적"
      },
      {
        "value": "efficiency_improvement",
        "label": "효율성"
      },
      {
        "value": "experience_transfer",
        "label": "경험 전이"
      }
    ],
    "axisOptions": [
      {
        "value": "all",
        "label": "전체 분야"
      },
      {
        "value": "backend",
        "label": "백엔드 개발"
      }
    ],
    "events": [
      {
        "id": "event-0",
        "occurredAt": "2026-11",
        "activity": {
          "id": "activity-01",
          "name": "Growth AI"
        },
        "axis": "backend",
        "title": "경험을 활용해 배포 시간을 줄였어요.",
        "description": "기존 배포 경험을 적용하고 자동화했어요.",
        "growthAssessments": [
          {
            "type": "efficiency_improvement",
            "reason": "같은 테스트를 통과하면서 배포 시간을 30분에서 5분으로 줄였어요.",
            "evidence": [
              {
                "recordId": "record-01",
                "quote": "개인 프로젝트에서 익힌 EC2 설정을 Growth AI에 적용했고, 배포 자동화로 30분에서 5분으로 줄이면서 같은 기능 테스트 10개를 모두 통과했다."
              }
            ],
            "comparison": {
              "before": "배포 30분",
              "after": "배포 5분",
              "condition": "같은 기능 테스트 10개 모두 통과",
              "beforeEvidence": [
                {
                  "recordId": "record-01",
                  "quote": "개인 프로젝트에서 익힌 EC2 설정을 Growth AI에 적용했고, 배포 자동화로 30분에서 5분으로 줄이면서 같은 기능 테스트 10개를 모두 통과했다."
                }
              ],
              "afterEvidence": [
                {
                  "recordId": "record-01",
                  "quote": "개인 프로젝트에서 익힌 EC2 설정을 Growth AI에 적용했고, 배포 자동화로 30분에서 5분으로 줄이면서 같은 기능 테스트 10개를 모두 통과했다."
                }
              ]
            }
          },
          {
            "type": "experience_transfer",
            "reason": "개인 프로젝트의 EC2 설정 경험을 Growth AI에 적용했어요.",
            "evidence": [
              {
                "recordId": "record-01",
                "quote": "개인 프로젝트에서 익힌 EC2 설정을 Growth AI에 적용했고, 배포 자동화로 30분에서 5분으로 줄이면서 같은 기능 테스트 10개를 모두 통과했다."
              }
            ],
            "transfer": {
              "sourceActivity": {
                "id": null,
                "name": "개인 프로젝트"
              },
              "experience": "EC2 설정 경험",
              "targetActivityId": "activity-01",
              "application": "Growth AI 배포에 EC2 설정 경험 적용",
              "sourceEvidence": [
                {
                  "recordId": "record-01",
                  "quote": "개인 프로젝트에서 익힌 EC2 설정을 Growth AI에 적용했고, 배포 자동화로 30분에서 5분으로 줄이면서 같은 기능 테스트 10개를 모두 통과했다."
                }
              ],
              "applicationEvidence": [
                {
                  "recordId": "record-01",
                  "quote": "개인 프로젝트에서 익힌 EC2 설정을 Growth AI에 적용했고, 배포 자동화로 30분에서 5분으로 줄이면서 같은 기능 테스트 10개를 모두 통과했다."
                }
              ]
            }
          }
        ]
      }
    ]
  }
}
```
