# 1Line API 서버 (Spring Boot)

## 서버 간 인증 (2026-11-13)

서버 시작 전에 `INTERNAL_SERVICE_TOKEN`을 서버 환경변수로 설정한다. 누락·빈 값·잘못된 Bearer 토큰 문자는 시작 오류다. `.env` 파일을 자동으로 읽는 구현은 없으며 실제 프로세스 환경변수 또는 배포 시스템의 비밀 설정으로 주입한다. 실제 값은 Git·로그·프론트에 넣지 않는다.

- 백엔드 → AI의 활동·Journey·남은 파일 분석 요청에 `Authorization: Bearer <INTERNAL_SERVICE_TOKEN>`을 보낸다.
- AI → 백엔드의 `/api/internal` 및 하위 경로는 토큰을 검사하고 누락·오류·중복 Authorization 헤더를 401로 거절한다. 공개 프론트 API에는 적용하지 않는다.
- 홈 내부 API 3개를 구현했다. 정상 토큰으로 문맥 조회·작업 게시·정본 재조회를 사용한다. 없는 작업은 404다.
- 인증 요청은 HTTP 리다이렉트를 자동 추적하지 않는다. `AI_API_BASE_URL`은 리다이렉트 없는 최종 주소로 지정한다. 기존 설정대로 이 값은 `/api`를 제외한 AI 서버 주소이며 각 호출에서 `/api/analyze/...`를 붙인다.
- 실제 배포는 HTTPS와 AI 측 토큰 송신·검증을 함께 구성해야 한다. 이 변경만으로 실제 AI 연동·TLS 설정·사용자 인증이 완료되는 것은 아니다.

PowerShell 설정 형식은 `$env:INTERNAL_SERVICE_TOKEN = '<서버 비밀 설정에서 받은 값>'`이다. 문서의 자리표시자를 실제 토큰으로 사용하지 않는다. 로컬 자동 검사는 별도 테스트 전용 값을 사용한다.

작업 범위·결과는 [분리 서버 연동 기록](../docs/backend-ai-integration/작업_및_검증_기록.md)에 기록한다.

## 홈 분석 내부 API (2026-11-13)

- `GET /api/internal/home-context?conversationId=...`: 최근 활동 50개·확정 기록 50개와 최근 완료 대화 6회, 현재 활동 문맥을 반환한다.
- `PUT /api/internal/chat-jobs/:jobId`: 게시 객체 전체와 expectedRevision을 받아 최초 201, 재전송·갱신 200을 반환한다.
- `GET /api/internal/chat-jobs/:jobId`: `{job: JobSnapshot}` 정본과 revision을 반환한다. 내부 응답의 원본 bytes를 공개 프론트 응답에 복사하지 않는다.

원본은 base64 JSON으로 전송하고 기존 files BLOB에 저장한다. 내부 PUT의 JSON 본문은 압축 해제 후 40MiB까지이며, 디코딩한 원본은 파일당 10MiB·총 25MiB·10개 제한이다. 공개 JSON API의 1MiB 제한은 유지한다. 앞단 프록시도 내부 경로의 한도를 수용해야 한다.

기존 테이블을 보존하고 internal_chat_publications(버전·중복 검증)와 internal_job_tombstones(전체 삭제 후 재게시 차단용 ID 해시)를 추가한다. 정식 기록은 기존 POST /api/records에서 사용자 확인 후 생성한다. 활동 직접 수정·자료 삭제는 정본 revision을 증가시키며, 전체 삭제는 원문·원본·작업을 제거하고 재전송 방지용 ID 해시만 남긴다.

현재 SQLite와 단일 백엔드 프로세스 기준으로 기동 시 미완료 내부 작업을 failed로 복구한다. 여러 백엔드 프로세스의 무중단 병행 기동은 복구 소유권·리스 설계가 추가로 필요하다. 사용자 인증·사용자별 DB 범위도 이번 작업에서 추가하지 않았다.

로컬 Spring 검사 37개와 JAR 빌드를 통과했다. AI 서버의 내부 API 호출 구현·실제 서버 연동·배포는 별도다. [교환 예시](../docs/backend-ai-integration/examples/home-job-exchange.json)와 [공통 계약](../docs/common/handoff/서버간_데이터_전달_계약.md)을 따른다.

## Growth Journey 새 계약 적용 상태 (2026-11-12)

Growth Journey는 [공통 JSON 계약 v2](../docs/growth-journey-update/공통_JSON_계약.md)로 변경했다. 이 API는 아래의 기존 Node 서버 호환 설명과 달리 고정 5종 `growthAssessments`, `comparison`, `transfer`를 사용한다. 기준 버전은 `growth-criteria-v1`, AI 프롬프트 버전은 `journey-v6`다.

- `POST /api/journey/analyze`는 Spring이 저장 기록·해시·버전을 AI `/api/analyze/journey`에 JSON으로 전달한다.
- `GET /api/journey`는 저장 결과를 읽는다. `criteria_version` 컬럼은 초기화 시 추가하며 구형 분석 행을 자동 변환·삭제하지 않는다.
- 프론트와 독립 OpenAPI·Swagger도 새 Journey 구조를 적용했다. 실제 AI 구현의 새 계약 적용과 실제 연동 확인은 별도 작업이다.
- 로컬 검증은 임시 DB·가짜 AI HTTP 서버를 사용한다. 실제 AI 연동·EC2 배포는 수행하지 않았다.

JDK 21로 `./gradlew.bat test bootJar --console=plain`을 실행한다. Windows 한글 경로에서 테스트 워커가 시작되지 않으면 ASCII 캐시·임시 경로를 사용한다. PowerShell에서 `-D` 인수는 따옴표로 감싼다.

```powershell
New-Item -ItemType Directory -Path 'C:/Temp/growth-journey-test' -Force | Out-Null
.\gradlew.bat --gradle-user-home C:/Temp/growth-journey-gradle '-Djava.io.tmpdir=C:/Temp/growth-journey-test' test bootJar --console=plain
```

로컬 결과: 테스트 19개 통과, `build/libs/1line-api-server-0.1.0.jar` 생성. 상세 내용은 [작업·검증 기록](../docs/growth-journey-update/작업_및_검증_기록.md)에 있다.

## 기존 서버 이식 배경

기존 `api-server`(Node.js · Express · node:sqlite)를 **Java 21 · Spring Boot 4 · SQLite(JDBC)** 로 옮긴 백엔드다.
경로·요청·응답 JSON(키 순서 포함)·상태 코드·오류 문구·DB 스키마·트랜잭션 동작을 기존 서버와 같게 유지한다.
프론트(`/api` → `http://127.0.0.1:3001`)와 AI 서버(`ai-api-server`)는 수정 없이 그대로 연결된다.

## 실행

```powershell
cd api-server-spring
.\gradlew.bat bootRun
```

- 주소: `http://127.0.0.1:3001/api` (상태 확인: `GET /api/health`)
- 기존 Node 서버(`npm run dev`)와 같은 포트를 쓰므로 **둘 중 하나만** 실행한다.
- 실행 파일 빌드: `.\gradlew.bat bootJar` → `build/libs/1line-api-server-0.1.0.jar` (`java -jar ...`)
- 검사: `.\gradlew.bat test`
- JDK 21 이상 필요. Gradle은 wrapper가 자동으로 받는다.

### 환경변수 (기존과 동일)

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PORT` | `3001` | 서버 포트 (127.0.0.1 에만 바인딩) |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS 허용 origin |
| `DB_PATH` | `../api-server/data/1line.db` | SQLite 파일. 기존 Node 서버·AI 서버(`AI_DB_PATH` 기본값)와 **같은 파일**을 사용한다 |
| `AI_API_BASE_URL` | `http://127.0.0.1:8000` | FastAPI AI 서버 주소 |

`DB_PATH` 기본값은 실행 위치 기준이다. `api-server-spring` 폴더(또는 `bootRun`)에서 실행하면 `../api-server/data/1line.db`,
저장소 루트에서 실행하면 `api-server/data/1line.db` 를 쓴다. 다른 위치에서 jar 를 실행할 때는 `DB_PATH` 를 지정한다.

## 기존 파일과의 대응

| Node (`api-server/src`) | Spring (`src/main/java/com/oneline/api`) |
| --- | --- |
| `server.js` | `Application.java`, `config/AppConfig.java` |
| `app.js` (라우트·오류 처리) | `web/ApiController.java`, `web/ErrorHandler.java` |
| `cors`, `express.json`, ETag/304 | `web/ExpressCompatFilter.java`, `web/QueryString.java` |
| `database.js` | `db/Database.java` |
| `validation.js` (zod) | `validation/Schemas.java`, `zod/Z.java`, `zod/WhatwgUrl.java` |
| `activities.js` | `service/Activities.java` |
| `archive.js` / `archive-search.js` / `archive-delete.js` | `service/Archive.java` / `ArchiveSearch.java` / `ArchiveDelete.java` |
| `home.js` | `service/Home.java` |
| `activity-metadata.js` | `service/ActivityMetadata.java`, `service/ActivityMetadataQueue.java` |
| `activity-chat-update.js` | `service/ActivityChatUpdate.java` |
| `journey.js`, `journey-context.js` | `service/Journey.java` |
| JS 값·JSON 동작 | `js/Js.java`, `js/Json.java` |

## 동일성을 위해 지킨 점

- **JSON 직렬화**: `JSON.stringify` 와 같은 키 순서·숫자 표기·이스케이프를 직접 구현했다. DB에 저장하는 `reply`/`result_json` 문자열과
  SHA-256 지문(`activitySnapshot`, `journeySnapshot`)이 Node·Python과 바이트 단위로 같다. (지문이 다르면 AI 결과가 "기록 변경"으로 거절된다)
- **검증(zod 4.6.7)**: 문자열 trim, 알 수 없는 키 제거/거절(strict), 기본값, 오류 응답 본문(`JSON.stringify(issues, null, 2)` 형식)까지 같다.
- **처리 순서**: Node는 요청을 하나씩 처리하고 AI 호출(`await`) 중에만 다른 요청을 받는다. `support/EventLoop` 로 같은 순서를 보장해
  `성장 분석 진행 중(409)`, `삭제 중 동시 수정(409)`, 활동 정보 분석 큐(500ms 묶음·취소·재시도) 동작이 같다.
- **Express 동작**: 404 JSON, 다른 메서드도 404, 경로 대소문자 무시·끝 `/` 허용, CORS 헤더·preflight 204, `express.json` 1MB 제한(413)·
  charset(415)·strict JSON(400), 약한 ETag 와 `If-None-Match` 304, `X-Powered-By: Express`.
- **DB**: 같은 테이블·컬럼·`ALTER TABLE` 마이그레이션·`BEGIN IMMEDIATE` 트랜잭션·WAL 을 사용해 기존 `1line.db` 를 그대로 열 수 있다.

## 알려진 차이

- `Content-Type` 헤더가 `application/json;charset=utf-8` (세미콜론 뒤 공백 없음)로 나간다. Tomcat이 항상 이렇게 정규화하며 의미는 같다.
- `Content-Encoding: br`(brotli) 로 압축한 요청 본문은 지원하지 않는다(415). gzip/deflate 는 지원한다.
- 잘못된 JSON 본문의 400 오류 문구는 V8 형식을 따르지만, 드문 형태의 오류에서는 문구가 조금 다를 수 있다.

## 참고

- 기존 `api-server`(Node)는 루트의 `scripts/*.mjs`, Swagger 생성(`api-server/docs/openapi.js`)이 사용하므로 그대로 남겨 두었다.
- 한글이 포함된 경로(예: `바탕화면\1호선톤`)에서 Windows Gradle 테스트가 클래스를 찾지 못하는 문제가 있어,
  `build.gradle` 에서 그 경우에만 테스트 클래스를 임시 ASCII 경로로 복사해 실행한다.
