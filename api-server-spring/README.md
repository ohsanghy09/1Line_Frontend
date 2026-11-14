# 1Line API 서버 (Spring Boot)

## 공동 파일 연동 (2026-11-14)

F19 `exclude-file-result-v2`와 F11 `file-dedup-v1` 백엔드·관련 프론트를 구현했다. 두 기능은 기본 비활성화다. AI 측 준비 후 `EXCLUDE_FILE_V2_ENABLED=true`, `FILE_DEDUP_ENABLED=true`로 전환한다. 비활성 상태의 부분 삭제는 503으로 원본을 보존한다. 새 내부 API는 `POST /api/internal/file-duplicates/check`다.

F19 독립 원문 검증은 현재 UTF-8 텍스트 형식만 지원하며, PDF·Office·이미지의 부분 삭제는 추출기 검증 전까지 거절한다. 요청·응답, 형식 제한, 설정·전환 순서는 [공동 연동 안내](../docs/integration-test-fixes/공동작업_백엔드_연동안내.md)를 참고한다. 실제 AI·운영 서버 검증은 별도다.

## 통합 테스트 후속 수정 (2026-11-14)

부분 삭제 시 활동 속성을 임시 보존하고 재확인이 필요한 상태로 표시한다. 마지막 기록 삭제 시 관련 정보는 비운다. 미저장 원본은 기본 24시간 보관 후 5분 주기로 정리하며, 진행 중 작업과 정식 저장 자료는 보호한다. `UNSAVED_ANALYSIS_RETENTION_MS`로 보관 시간을 지정할 수 있다.

삭제·활동·Journey AI 호출은 결과·검증/반영 여부·소요 시간을 로그에 남기되 토큰·본문은 기록하지 않는다. DB 열/보관 시각 테이블은 시작 시 추가하며, 기존 원본은 첫 도입 후 보관 기간을 보장한다. 설정·주의점·검증 범위는 [백엔드 단독 작업 기록](../docs/integration-test-fixes/백엔드_단독작업_구현_검증.md)을 참고한다. 실제 운영 배포는 별도다.

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

홈 문맥 records[].message가 빈 문자열이면 JSON null로 전달한다. DB·공개 기록 조회·내부 작업 정본·대화 원문은 변경하지 않고 비어 있지 않은 문자열도 그대로 유지한다. 실패 게시(status=failed)에 남은 reply는 해시 계산·저장 전에 null로 정리하고 error를 보존한다. DB의 reply는 SQL NULL 대신 JSON 텍스트 "null"이며 정본 응답은 JSON null이다. queued/running의 reply 제한·completed 검증·revision 충돌·완료 결과 보호는 유지한다. 이 호환 처리 후 Spring 검사 52개·JAR 빌드를 통과했으며 실제 AI 서버 검증은 별도다.

원본은 base64 JSON으로 전송하고 기존 files BLOB에 저장한다. 내부 PUT의 JSON 본문은 압축 해제 후 40MiB까지이며, 디코딩한 원본은 파일당 10MiB·총 25MiB·10개 제한이다. 공개 JSON API의 1MiB 제한은 유지한다. 앞단 프록시도 내부 경로의 한도를 수용해야 한다.

### 홈 작업 만료 (2026-11-13)

- 내부 홈 작업의 queued는 백엔드 최초 접수 후 10분, running은 마지막 진행 갱신 수신 후 5분을 기준으로 30초마다 검사한다. AI의 시각·조회·동일 요청 재전송으로 시간을 연장하지 않는다. queued 갱신도 최초 접수 시각을 유지한다.
- Spring 설정은 `oneline.internal-job-queued-timeout-ms=600000`, `oneline.internal-job-running-timeout-ms=300000`, `oneline.internal-job-scan-interval-ms=30000`이다. 양수만 허용하며 필요할 때 실행 인자 `--oneline.internal-job-running-timeout-ms=300000` 형식으로 주입한다.
- 만료 시 `status=failed`, `reply=null`, `error={code,error}`를 저장하고 revision을 증가시킨다. 오류 코드는 `queue_timeout` / `analysis_timeout`이며 원인별 한국어 재요청 안내를 포함한다. 원본·입력과 기존 완료·실패 결과는 보존한다.
- 요청과 같은 EventLoop·트랜잭션을 사용한다. 완료 저장이 먼저면 완료를 보존하고 만료가 먼저면 늦은 완료·진행 게시를 409로 거절한다. 같은 requestId의 재접수는 기존 failed 정본을 반환하므로 다시 분석할 때 새 요청을 사용한다.
- internal_chat_publications에 `accepted_at_ms`, `progress_received_at_ms` INTEGER 컬럼을 시작 시 자동 추가한다. 기존 미완료 작업은 기존 재시작 복구로 failed 처리하고, 이후 신규 게시부터 수신 시각을 기록한다. 기존 자료·결과는 이관 시 보존한다. 서버 종료 때 타이머를 중지한 뒤 DB를 닫는다.
- Spring 전체 58개·JAR 빌드 통과. 실제 AI·EC2·브라우저 검증은 별도다. 프론트는 현재 2분 후 폴링을 중단하므로 만료가 즉시 화면에 자동 표시되는 것은 아니며 AI가 정본을 재조회해 오류를 전달해야 한다. 주기적 heartbeat가 없는 정상 분석도 5분간 갱신이 없으면 만료될 수 있으므로 실제 처리 시간에 맞는 배포 검증이 필요하다.

기존 테이블을 보존하고 internal_chat_publications(버전·중복 검증)와 internal_job_tombstones(전체 삭제 후 재게시 차단용 ID 해시)를 추가한다. 정식 기록은 기존 POST /api/records에서 사용자 확인 후 생성한다. 활동 직접 수정·자료 삭제는 정본 revision을 증가시키며, 전체 삭제는 원문·원본·작업을 제거하고 재전송 방지용 ID 해시만 남긴다.

현재 SQLite와 단일 백엔드 프로세스 기준으로 기동 시 미완료 내부 작업을 failed로 복구한다. 여러 백엔드 프로세스의 무중단 병행 기동은 복구 소유권·리스 설계가 추가로 필요하다. 사용자 인증·사용자별 DB 범위도 이번 작업에서 추가하지 않았다.

로컬 Spring 검사 47개와 JAR 빌드를 통과했다. AI 서버의 내부 API 호출 구현·실제 서버 연동·배포는 별도다. [교환 예시](../docs/backend-ai-integration/examples/home-job-exchange.json)와 [공통 계약](../docs/common/handoff/서버간_데이터_전달_계약.md)을 따른다.

## 활동 정보 분석 JSON 전달 (2026-11-13)

응답의 promptVersion은 실제 AI 반환값인 `activity-metadata-analysis`만 허용한다. 이전 activity-metadata-v1 응답은 거절하지만 이미 저장한 활동 메타정보를 삭제하거나 변환하지 않는다. 구조·근거·해시·기간 검증은 유지한다. 버전 정합화 후 Spring 검사 48개·JAR 빌드를 통과했으며 실제 AI/EC2 연동은 미검증이다. [호환 보완 작업](../docs/backend-ai-fixes/README.md)에 진행 상태를 기록한다.

자동·수동 활동 분석은 `POST /api/analyze/activities/:activityId`에 activity·previous·records·files·recordCount·sourceFingerprint를 JSON 본문으로 보낸다. files는 [recordId,fileId,name] 메타정보이며 원본 bytes는 포함하지 않는다. 기존 스냅샷 정렬·해시·응답 근거 검증과 실패 시 이전 정보 보존은 유지한다.

기록 1~100개·직렬화 JSON 250000 코드 포인트 한도를 AI HTTP 호출 전에 검사한다. 비동기 공개 API의 기존 202 접수 후 상태 조회 흐름은 유지한다. 한도 초과 시 작업은 failed가 되며 기존 정보와 기록은 보존한다. AI는 요청 본문으로만 종합하고 sourceFingerprint를 그대로 반환해야 한다. 실제 AI 측 JSON 수신·모델 평가·EC2 연동은 별도 확인 대상이다.

## 파일 일부 삭제 재분석 원본 전달 (2026-11-13)

`POST /api/analyze/records/:recordId/exclude-file`에 fileId·recordReply·activity·files를 JSON으로 보낸다. files는 같은 기록의 삭제 대상 제외 원본이며 id/name/mimeType/size/contentBase64를 저장 순서대로 담는다. 삭제 대상 bytes나 다른 기록의 원본은 포함하지 않는다. 보관된 크기와 실제 bytes가 다르거나 빈 원본·한도 초과면 AI 호출 전에 502로 중단하고 삭제하지 않는다.

AI는 recordReply를 모델 입력에 사용하지 않고 원문 그대로 응답한다. 남은 원본이 1개여도 정상 대상이다. 성공 응답의 recordReply·파일 ID/이름/순서·changes=[]·sourceUrl 없음과 현재 활동 스냅샷을 확인한 뒤 삭제·결과 교체·초안 퇴역을 트랜잭션으로 처리한다. AI 실패·불일치·동시 변경이면 삭제하지 않는다. 마지막 파일은 AI 재분석 없이 기존 삭제 정책으로 처리한다. 프론트 공개 삭제 API는 변경하지 않았다.

실제 AI 수신 서버와 앞단 프록시는 원본 25MiB의 base64 증가분 및 기록 응답·메타정보 크기를 수용하도록 설정해야 한다. 실제 모델·EC2·브라우저 검증은 미수행이다.

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

### Linux 실행·검사

Java 21 JDK가 필요하다. Gradle Wrapper가 필요한 Gradle 버전을 내려받으므로 최초 실행에는 다운로드 가능한 환경이 필요하다.

```bash
cd api-server-spring
java -version
./gradlew test --console=plain
./gradlew bootJar --console=plain
```

`gradlew`의 Git 실행 권한은 `100755`로 관리한다. 기존 체크아웃·압축 해제 등으로 실행 권한이 없으면 해당 환경에서 한 번 `chmod +x gradlew`를 실행한다. 권한이 정상인 Git 체크아웃에서는 필요하지 않다.

실제 개발 서버의 포트는 환경변수로 지정한다. 테스트 실행과 서버 기동은 별개이며, 다음 예시는 3999 포트로 서버를 실행한다. 실제 AI 연결·DB 경로 등은 해당 배포 환경의 설정을 사용한다.

```bash
PORT=3999 ./gradlew bootRun --console=plain
```

서버 담당자의 검사 명령은 `PORT=3999 ./gradlew test --console=plain`이며, 이 명령은 애플리케이션을 운영 서버로 기동하는 명령이 아니다.

Ubuntu/Debian에서 DB를 직접 조회할 CLI가 필요한 경우에만 설치한다. 앱 자체는 JDBC를 사용하므로 별도 sqlite3 CLI 설치가 필수는 아니다.

```bash
sudo apt install -y sqlite3
```

SQLite `busy_timeout`은 기존 동작과 동일하게 0을 유지한다. 현재 `SQLITE_BUSY_TIMEOUT_MS`를 읽는 기능은 없으며, 환경변수 지원은 필요할 때 별도로 구현·검증한다.

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
