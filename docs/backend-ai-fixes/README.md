# 백엔드·AI 호환 및 실패 처리 보완

작성일: 2026-11-13 · 상태: 문제 조사·수정 방향 정리, 기능 구현 전

## 목적과 작업 범위

기존 [분리 서버 연동 구현](../backend-ai-integration/README.md)을 바탕으로, 실제 AI 저장소와 Spring 사이의 형식 불일치와 중단된 작업 처리를 보완한다. AI 코드를 변경하지 않고 백엔드에서 대응하는 방향을 논의했다. 이번 작업은 문서 작성이며 기능 코드·DB·배포 설정은 변경하지 않았다.

관련 이슈 제목: `fix: AI 연동 계약 호환 및 분석 작업 실패·만료 처리 보완`

이 폴더를 새 작업의 계획·결정·검증 기록 진입점으로 사용한다. 기존 연동 구현 이력은 backend-ai-integration에 유지한다. 기존 계약은 현재 구현 기준이며, 향후 변경을 실제 구현할 때 관련 계약·OpenAPI·검사도 함께 맞춘다. 아래 계획을 구현 완료로 해석하지 않는다.

## 조사 기준과 한계

| 구분 | 조사 기준 |
| --- | --- |
| 프론트·Spring | 로컬 저장소 커밋 `05bc0d952d854f3bd93173bb2a3b92d4513d40e2` |
| AI | [hongdabomi/GrowthArchive_ai](https://github.com/hongdabomi/GrowthArchive_ai), main의 `3f2e9907396d728ea37aeafa189bac92c0159a24` |
| 조사 방식 | 양쪽 소스·스키마·테스트의 정적 대조 |
| 미검증 | 실제 EC2·AI 모델·양쪽 서버 통합·브라우저 동작 |

로컬 참고 원본은 바탕화면의 `C:\Users\user\Desktop\Growth_AI_배포_연동_검토_인수인계_2026-11-13.md`다. 이 파일은 저장소 밖의 조사 시점 기록이므로 다른 PC에 있다고 가정하지 않는다. 작업에 필요한 내용은 아래에 요약했다. 다음 구현 전 최신 커밋과 현재 코드에서 문제가 남아 있는지 다시 확인한다.

기존 분리 연동의 Spring 검사 47개·JAR 빌드와 OpenAPI 검사 4개 통과는 이전 구현의 결과다. 이 호환 보완 작업의 완료나 실제 AI 연결 성공을 의미하지 않는다.

## 발견한 문제와 백엔드 변경 방향

| 항목 | 현재 불일치·누락 | 백엔드에서 논의한 변경 | 결정 상태 |
| --- | --- | --- | --- |
| 활동 분석 버전 | Spring은 activity-metadata-v1만 허용하고 AI는 activity-metadata-analysis 반환 | 허용 버전을 AI 응답 기준으로 정합화하고 계약 갱신 | 방향 논의, 세부 정책·구현 전 |
| 빈 기록 본문 | 파일·링크 기록의 message는 빈 문자열인데 AI Text 검증은 이를 거절 | DB 값은 유지하고 홈 문맥 응답에서 빈 문자열만 null로 변환 | 방향 논의, 구현 전 |
| 실패 요청 reply | AI가 failed로 전환할 때 남긴 reply를 Spring이 거절 | failed 요청의 reply를 백엔드에서 null로 정규화 | 채택한 방향. 사용자의 중단 지시 후 수정하지 않음 |
| 작업 만료 | AI만 종료되면 백엔드 queued/running이 남음 | 오래 갱신되지 않은 작업을 failed로 종료하고 늦은 완료 거절 | 시간 기준 확정, 세부 구현·검증 전 |

### 1. 활동 정보 분석 버전

AI [activity_metadata.py](https://github.com/hongdabomi/GrowthArchive_ai/blob/3f2e9907396d728ea37aeafa189bac92c0159a24/activity_metadata.py)는 promptVersion=activity-metadata-analysis를 반환한다. Spring [ActivityMetadata.java](../../api-server-spring/src/main/java/com/oneline/api/service/ActivityMetadata.java)의 OUTPUT은 activity-metadata-v1만 허용하므로 정상 내용도 거절된다.

- [ ] AI 기준 버전으로 맞추는 정책과 기존 버전 수용 여부를 정한다.
- [ ] 버전명 검증·관련 계약·OpenAPI·검사를 갱신한다.
- [ ] 응답 구조·원문 근거·기록 수·해시 검증은 유지한다.

### 2. 빈 기록 본문

파일·링크 저장 시 함께 입력한 채팅을 기록에 복사하지 않는 정책에 따라 message=""가 저장된다. Spring [HomeContext.java](../../api-server-spring/src/main/java/com/oneline/api/service/HomeContext.java)가 이를 그대로 보내면 AI [RecordContext](https://github.com/hongdabomi/GrowthArchive_ai/blob/3f2e9907396d728ea37aeafa189bac92c0159a24/schemas/common.py)의 Text(min_length=1) 검증에서 거절된다. 파일 원본·분석 요약이 비어 있다는 뜻이 아니다.

- [ ] AI에 보내는 홈 문맥의 records[].message만 "" → JSON null로 변환한다.
- [ ] DB의 저장값·채팅 이력·실제 내용이 있는 문자열은 보존한다.
- [ ] 파일·링크 저장 후 다음 홈 분석의 문맥 검증을 확인한다.
- [ ] 공백만 있는 문자열 처리 여부는 별도로 정한다. 원문을 무조건 trim하거나 Text 전역 규칙을 완화하지 않는다.

### 3. 실패 요청의 reply 정규화

AI [JobService.run](https://github.com/hongdabomi/GrowthArchive_ai/blob/3f2e9907396d728ea37aeafa189bac92c0159a24/jobs.py#L64)은 완료 게시 오류 후 status/error만 바꿔 reply가 남을 수 있다. Spring [InternalChatJobs.java](../../api-server-spring/src/main/java/com/oneline/api/service/InternalChatJobs.java)는 completed 이외 상태에서 reply=null을 요구하므로 실패 게시도 거절한다.

사용자와 정리한 방향은 **status를 null로 바꾸는 것이 아니라, status=failed를 유지하면서 reply를 null로 정리**하는 것이다. 실제 수정 요청은 중단됐으며 현재 구현되지 않았다.

- [ ] failed 요청에 reply가 있어도 허용하되 검증·게시 해시 계산·저장 전에 null로 정규화한다.
- [ ] queued/running의 reply=null 규칙, 필수 error 검증, 입력·원본 검증은 유지한다.
- [ ] expectedRevision 충돌·완료된 작업의 실패 덮어쓰기 거절을 유지한다.
- [ ] 원본을 재전송하거나 reply 유무가 달라진 같은 실패 요청의 중복 처리가 안정적인지 확인한다.
- [ ] DB 스키마는 그대로 사용한다. analyses.reply는 NOT NULL이므로 SQL NULL이 아니라 기존 Json.stringify(null)의 문자열 "null"로 보관한다. 내부 조회 응답에서는 JSON null이어야 한다.
- [ ] 실패 상태의 초안을 정식 기록으로 저장하지 못하도록 기존 저장 검증을 유지한다.

이미 완료가 저장됐지만 응답만 유실된 경우에는 완료 결과를 보호해야 한다. reply 정규화만으로 revision 충돌·통신 장애·결과 재게시가 모두 해결되지는 않는다. 백엔드에 전달되지 않은 결과의 자동 복원은 이 범위에 포함하지 않는다.

### 4. 작업 만료

AI의 BackgroundTasks가 종료되면 백엔드에는 진행 상태가 남는다. 현재 Spring의 기동 복구는 Spring 재시작 시에만 실행된다. AI만 재시작하면 진행 조회가 끝나지 않거나 자료·활동·전체 삭제가 막힐 수 있다. 기존 running이 모든 새 분석을 무조건 막는다는 뜻은 아니다.

AI는 preparing → analyzing → persisting 등 단계 전환 시 상태를 갱신한다. 모델 응답을 기다리는 동안 주기적으로 보내는 heartbeat는 없다. 만료는 정상 모델 처리 시간과 대기 시간을 고려해야 한다.

사용자가 2026-11-13 권장한 시간 기준을 채택했다. 아래 값은 확정 정책이며 기능 적용은 아직 하지 않았다.

| 항목 | 확정 기준 | 상태 |
| --- | --- | --- |
| running 만료 | 백엔드가 마지막 진행 갱신을 받은 뒤 5분 | 확정, 미구현 |
| queued 만료 | 백엔드 접수 후 10분 | 확정, 미구현 |
| 검사 간격 | 30초 | 확정, 미구현 |

- [x] running 5분·queued 10분·검사 간격 30초를 확정한다.
- [x] 만료 원인별 안내는 백엔드 오류 문구로 구분하고 프론트의 기존 오류 표시 흐름을 사용한다.
- [ ] 검사 방식·설정값 주입과 오류 코드 세부값을 정한다.
- [ ] AI가 보낸 시각과 백엔드의 수신 시각을 구분하고, 서버 시계 차이를 고려한다.
- [ ] 만료 갱신과 완료 게시가 경쟁해도 하나의 일관된 상태만 저장되도록 처리한다.
- [ ] 만료 시 failed/error/revision을 갱신하고 늦은 완료·진행 응답의 부활을 막는다.
- [ ] 작업 만료 후 사용자 새 요청·삭제가 가능한지 확인한다.
- [ ] AI 응답 도중 정상 작업이 잘못 만료되지 않는지, 완료·이미 실패한 작업은 보존되는지 확인한다.
- [ ] 프론트는 현재 2분 뒤 폴링을 중단하므로, 5분 후 백엔드 만료가 화면에 자동 표시된다고 가정하지 않는다. 재조회·복원 시 실패 반영을 확인한다.

사용자가 안내 방식으로 백엔드 문구 처리를 선택했다. queued 만료는 “분석 요청이 많아 대기 시간이 초과됐어요. 잠시 후 다시 요청해 주세요.”, running 만료는 “분석 진행을 확인할 수 없어 작업을 종료했어요. 다시 요청해 주세요.”를 백엔드 error.error에 담는 방향이다. 내부 정본 error는 {code,error} 구조를 유지하고 AI가 공개 실패 응답으로 전달하면 프론트는 기존처럼 표시한다. 별도 프론트 오류 화면·재시도 버튼 추가는 이번 결정에 포함하지 않는다. 문구는 재조회·복원 등으로 실패 응답을 수신했을 때 표시되며, 프론트의 2분 폴링 시간 초과 문구가 자동으로 바뀌는 것은 아니다.

## 검증·완료 기준

- [ ] 실제 AI 응답 구조를 사용하는 활동 종합 저장 검사.
- [ ] 파일·링크 저장 후 빈 message를 포함한 홈 문맥의 AI 검증 통과.
- [ ] failed+reply 결과 요청의 정규화·저장·재조회·중복 처리 검사.
- [ ] 완료 미저장 후 실패 게시, 완료 저장 후 응답 유실, stale revision을 구분한 검사.
- [ ] AI 중단을 가정한 만료, 갱신 직전/직후·완료 동시 요청·늦은 완료·사용자 재전송 검사.
- [ ] 기존 공개 API·저장·수정·삭제·인증·원본 보관 회귀 검사.
- [ ] 계약·OpenAPI·작업 기록을 실제 구현과 일치하도록 갱신.

로컬 검사, 실제 두 서버의 계약 통합 검사, 실제 모델·브라우저·EC2 검증은 별도로 기록한다. 성공할 수 없는 분석을 성공으로 위장하지 않고 실패 안내·재전송이 가능한 상태로 정리한다. 토큰·키는 코드·문서·프론트에 넣지 않는다.

## 참고 문서

- [작업 및 검증 기록](작업_및_검증_기록.md)
- [기존 분리 서버 연동](../backend-ai-integration/README.md)
- [서버 간 데이터 전달 계약](../common/handoff/서버간_데이터_전달_계약.md)
- [백엔드 OpenAPI](../frontend-integration/openapi/backend.openapi.json)
- [AI OpenAPI](../frontend-integration/openapi/ai.openapi.json)
- [Spring 실행·구현 안내](../../api-server-spring/README.md)
