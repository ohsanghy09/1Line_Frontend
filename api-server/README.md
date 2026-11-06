# 개발용 REST API 서버

최신 홈 흐름: 분석은 별도 FastAPI에서 실제 OpenAI로 수행하며 이 서버는 기록 확정 저장·수정·조회를 담당한다. 백엔드 POST `/api/chat`·`/api/chat/links`는 기본 410이다. 시작 시 ai_chat_jobs 테이블을 기존 DB에 추가하며 완료되지 않은 실제 작업은 기록 저장을 막는다. [홈 실제 AI 연동](../ai-api-server/docs/홈_실제_AI_연동.md)의 실행·API·검증을 먼저 읽는다. 아래 목 분석 설명은 이전 계약·회귀 검사 배경이며 실제 홈 fallback이 아니다.

2026-11-06 AI 개발 서버 연동: Python FastAPI 서버가 기본 `data/1line.db`에 직접 연결해 활동·확정 기록·원본 파일을 읽을 수 있다. DB 생성·스키마 마이그레이션은 이 백엔드에서 유지한다. 사용자 지정 DB_PATH를 사용하면 AI_DB_PATH도 같은 실제 파일로 맞춘다. [직접 연결 안내](../ai-api-server/docs/DB_직접_연결.md) 참고. AI 서버의 신규 활동 생성·분석 저장과 프론트 호출 전환은 아직 미구현이다.

최종 정리: 2026-11-04. Node.js 24·Express·CORS·Multer·Zod·Node 내장 SQLite를 사용한다. 홈의 텍스트·파일·링크 접수, 준비 상태·진행 조회와 홈/미리보기 카드 저장·수정을 연결했다. 분석과 진행은 서버 목 응답이며 실제 AI·웹 수집은 하지 않는다.

나의 발자국 목록·상세·자료 Drawer·Project Timeline도 확정 기록의 실제 DB 조회에 연결했다. [DB 연동과 조회 계약](../docs/footprints/DB_연동.md), [현재 화면 동작](../docs/footprints/현재_구현_상태.md)을 참고한다. 기존 DB는 활동 메타정보 컬럼을 추가하는 방식으로 보존한다.

- [전체 구현·검증 현황](../docs/chat/현재_구현_상태.md)
- [실제 백엔드·AI 서버 전환 가이드](../docs/chat/api/실제_서버_전환_가이드.md)
- [진행·시간 제한·작업 조회 계약](../docs/chat/api/파일_분석_진행.md)
- [링크 입력](../docs/chat/구현_기능/링크_입력_분석.md)
- [카드 저장·수정](../docs/chat/구현_기능/카드_기록_수정.md)
- [대화·작업 세션 복원](../docs/chat/구현_기능/채팅_세션_보관.md)

## 실행

Swagger 문서는 프론트의 `/swagger/`에서 제공한다. 루트 `npm.cmd run dev`·`npm.cmd run build`에 정적 생성이 포함되며 Vercel 프론트 배포와 함께 올린다. 기존 `npm.cmd --prefix api-server run docs`의 3002 독립 서버는 선택적으로 유지한다. AI 모델은 미정이며 기존 계약값을 유지한다. [Swagger 사용 안내](../docs/integration/API_계약/Swagger_사용안내.md) 참고.

프로젝트 루트에서 실행한다.

```powershell
cd api-server
npm.cmd install
npm.cmd run dev
```

- 주소: `http://127.0.0.1:3001/api`
- 상태 확인: `GET /api/health`
- 검증: `npm.cmd test`, 일반 실행: `npm.cmd start`
- 처음 실행하면 `data/1line.db`를 생성한다. 원본 파일도 BLOB으로 DB에 보관한다.
- 환경변수: `PORT`(3001), `FRONTEND_ORIGIN`(http://localhost:5173), `DB_PATH`(기본 DB 파일 경로).
- `node:sqlite`의 실험 기능 경고가 표시될 수 있다. 별도 SQLite 프로그램 설치는 필요 없다.

## 저장 흐름과 API

1. `POST /api/chat`에 입력을 보내면 원본 파일·채팅·목 응답을 분석 초안으로 저장한다. 아직 활동 기록이 아니다.
2. 반환된 `reply`는 기존 `ChatReply` 구조다. 카드에 표시하고 `analysisId`와 `conversationId`도 보관한다.
3. 기록 버튼에서 `POST /api/records`를 호출하면 활동 기록과 변화 이벤트를 함께 저장한다. 변화가 없으면 Timeline 이벤트를 생성하지 않는다.
4. 저장 후 받은 기록 ID로 수정 API를 호출한다.

| 메서드·경로 | 요청·결과 |
| --- | --- |
| GET `/api/health` | 준비 상태, `analysisProvider: mock` |
| GET `/api/journey` | 성장 요약·배지·선택지·이벤트의 목 응답. DB/실제 AI 분석 없음. [계약·검증](../docs/journey/성장_분석_API.md) |
| GET `/api/activities` | 초기 활동 5개 |
| GET `/api/home/recent` | 최근 변경 활동 3개 + 최초 저장순 자료 3개. [시간 기준·갱신](../docs/chat/구현_기능/최근_활동_기록.md) |
| GET `/api/archive/activities` | q/category/status/sort 검색, `{ items, total }`. [검색 범위·계약](../docs/footprints/검색_API.md), 파일 내부 본문 제외 |
| GET `/api/archive/activities/:id` | 활동 정보·자료 유형별 폴더·Timeline |
| GET `/api/archive/activities/:id/materials/:fileId` | 활동 내 자료 상세·연결 이벤트 |
| POST `/api/chat` | multipart/form-data: `message`, `files`(반복), `conversationId`(선택), `mode`(선택) |
| POST `/api/chat/links` | JSON `url`, `conversationId`(선택). 링크 작업 접수 |
| GET `/api/chat/jobs/:id` | 파일·링크 작업의 진행·완료 결과 조회 |
| GET `/api/conversations/:id/messages` | 입력·첨부·목 응답 목록 |
| GET `/api/files/:id` | 원본 다운로드 |
| POST `/api/records` | 초안 또는 독립 카드 저장 |
| GET `/api/records/:id` | 기록 상세 |
| GET `/api/activities/:id/records` | 활동의 확정 기록 목록 |
| PATCH `/api/records/:id` | 활동·자료 유형·요약·본문·변화 수정 |
| GET `/api/activities/:id/timeline` | 활동의 변화 이벤트 |

채팅 초안 확정 요청:

```json
{ "activityId": "line1-hackathon", "analysisId": "채팅 응답에서 받은 ID" }
```

`/example` 카드 저장은 `analysisId` 대신 `reply`에 카드의 JSON을 보낸다. 선택적으로 `message`를 보낼 수 있다. 파일명만 있는 예시는 실제 파일 원본을 생성하지 않는다. 원본은 반드시 업로드해야 한다.

`analysisId`와 `reply`는 하나만 보낸다. 같은 초안을 다시 저장하면 409다. 독립 카드 저장은 매번 새 기록을 만들므로 프론트에서 저장 ID 보관과 중복 클릭 방지가 필요하다.

활동 정보 후속 확장: 응답의 `analysis.activity`에 기존/신규/미확인 구분·ID와 nullable 유형/상태/역할/기간/활동 요약을 추가했다. `newActivity`로 확인한 활동 생성과 기록을 함께 저장하거나, `activityUpdates`로 기존 활동의 non-null 값만 명시적으로 반영한다. 기존 요청도 지원하며 상세는 [활동 정보 응답·저장 계약](../docs/chat/api/활동_정보_응답_저장.md)을 참고한다. 활동 날짜 컬럼도 기존 DB를 보존해 추가한다. 현재 목 분석은 새 메타정보를 추출하지 않는다.

수정 요청 예시:

```json
{ "activityId": "computer-vision", "materialType": "회의록", "summary": "수정한 요약" }
```

`content`와 `changes`도 수정할 수 있다. 활동 변경 시 기존 이벤트가 새 활동에서 조회된다. 변화 수정 시 이벤트를 다시 구성하고 빈 배열이면 이벤트를 제거한다. 목 변화는 Turning Point로 자동 확정하지 않는다. 제목 문구 `content`는 분류와 별도로 수정한다.

## 제한과 범위

- 파일당 최대 10MiB, 요청당 최대 10개. 메모리로 수신 후 DB에 저장한다. 텍스트 최대 20000자.
- 목 `mode`: `no-change`(기본), `change`. 입력 의미에 따른 판단이 아닌 예시 선택이다.
- 실제 입력 글·파일명·시각은 보존한다. 활동·요약·변화는 서버가 임의 생성하고 다중 파일은 기타 자료로 묶는다.
- PDF/문서 내용 추출과 실제 AI 호출은 하지 않는다. 원본 파일 자체는 보관한다.
- 오류 형식: `{ "error": "설명" }`. 입력 오류 400, 자원 없음 404, 중복 저장 409.
- 개인 로컬 개발용으로 127.0.0.1에 바인딩하며 인증은 없다. 공개 배포·사용자별 접근 제어·삭제 정책은 미구현이다.
- 아카이브·Timeline의 확정 기록 DB 조회와 카드의 활동 정보 확인·생성/수정 저장은 연결했다. 독립 활동 관리 화면, ID 기반 버전 관계, Growth Journey 분석과 실제 AI 연결은 남은 작업이다.
- DB와 비밀 설정은 Git에서 제외한다.

## 코드

`src/database.js`: DB·트랜잭션·기존 DB 마이그레이션, `src/archive.js`: 확정 기록 집계·자료/이벤트 조회, `src/mock-reply.js`: 파일·텍스트·링크 목 분석, `src/progress.js`: 목 단계 계산, `src/validation.js`: JSON 검증, `src/app.js`: API, `src/server.js`: 실행. `test/`는 HTTP·SQLite·진행·링크·아카이브를 검증한다. 프론트 채팅·세션 검사는 루트 `scripts/check-chat-api.mjs`, `scripts/check-chat-session.mjs`, 아카이브 서비스 통합 검사는 `node --test tests/footprint-file-timeline.test.mjs`를 사용한다.
