# API 계약 대조표

작성일: 2026-11-09 · 상태: 초기 목록 작성, 상세 검증 전

## 기준과 판정 방법

[백엔드 handoff](../backend/handoff/API_정의서.md)와 [AI handoff](../ai/handoff/API_정의서.md)를 기준으로 한다. 아래 경로는 `/api`까지 포함하는 각 서버 Base 뒤에 붙이는 경로다. 개발용 `/ai-api`는 실제 AI 서버 접두사가 아니다.

`목록 확인`은 서비스 코드에서 호출 위치를 찾았다는 뜻이며 본문·응답·화면 동작의 일치를 보장하지 않는다. 상세 판정은 `미점검 / 일치 / 차이 / 명세 확인 필요`로 기록한다. 차이는 원인·기능 영향·수정 제안·사용자 확인 상태를 함께 남긴다.

현재 동작하는 프론트 기능은 보존한다. 차이를 발견했다고 계약에 맞춰 기능을 변경하지 않는다. 충돌이나 기능 손상 가능성이 있으면 현재 동작·명세·영향·기능 보존 방향을 사용자에게 보고하고, 확인 전 해당 기능의 변경·제거를 보류한다. 상세 원칙은 [작업 기준](README.md)의 현재 기능 보존과 충돌 보고 원칙을 따른다.

## 공개 API 시작 목록

기존 호환성 문서의 백엔드 16개·AI 4개를 시작 목록으로 사용한다. 현재 서비스 경로 검색으로 대부분의 호출 위치를 확인했으며, 아래 항목의 상세 판정은 모두 미점검이다.

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

## 상세 대조 항목

각 API마다 다음을 채운다. 필수·선택·생략·null을 구분하고, 실제 호출 화면까지 추적한다.

- 기준 문서의 절, 프론트 호출 함수와 화면, 개발 서버의 대응 코드.
- Base·메서드·경로·인코딩·헤더·본문·query와 파일 제한.
- 정상 상태 코드·응답 필드·응답 검증·오류 상태와 메시지 처리.
- ID 생성·보관·재사용, 화면 복원, 영속 저장 시점, 중복 요청·취소·시간 초과.
- 계약과의 차이, 현재 동작을 유지해야 하는 이유, 제안과 기능 영향, 검증 방법.

## 초기 차이 후보 — 수정 전 확인 필요

| ID | 확인한 사실 | 추가 확인과 기능 영향 | 변경 상태 |
| --- | --- | --- | --- |
| C-01 | handoff의 기록 저장은 analysisId 필수. `saveRecord`에는 analysisId가 없을 때 reply를 직접 보내는 분기가 있음 | 실제 화면에서 해당 분기가 사용되는지 추적. 바로 삭제하면 기존 카드 저장이 깨질 수 있음 | 조사만 수행, 수정 제안·사용자 확인 전 |
| C-02 | handoff의 수정 필수 구현은 activityId·materialType. `updateRecord`는 선택 activityUpdates도 보낼 수 있지만 현재 카드의 실제 PATCH 호출은 전달하지 않음 | 현재 UI의 PATCH 충돌로 단정하지 않음. 저장 POST의 category 보완용 activityUpdates와 구분. 필수 범위 밖이라는 사실만으로 금지된 필드로 단정하지 않음 | 현재 카드 호출까지 조사, 미수정 |
| C-03 | 공개 AI 작업 ID는 ai- 접두사. 프론트는 다른 접두사의 과거 작업을 백엔드 `/chat/jobs/:id`로 조회하는 복원 분기도 유지 | 이전 sessionStorage 복원 호환과 원격 계약의 관계 확인. 기존 세션 영향 조사 없이 제거하지 않음 | 조사만 수행, 수정 제안·사용자 확인 전 |

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
