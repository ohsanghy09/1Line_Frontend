# 홈 채팅의 실제 AI 분석 연동

작성일: 2026-11-06. 현재 홈의 텍스트·단일 파일·다중 파일·링크 분석을 FastAPI와 OpenAI에 연결했다. 이 문서는 이전의 ‘홈은 백엔드 목 분석’, ‘신규 활동 생성·분석 저장 미구현’ 안내보다 우선한다. Growth Journey는 이번 홈 전환 범위에 포함하지 않아 기존 목 응답을 유지한다.

## 1. 현재 호출·저장 흐름

1. 프론트 `src/services/chat.ts`가 `/ai-api/chat` 또는 `/ai-api/chat/links`에 입력한다. Vite가 FastAPI의 `/api/...`로 전달한다.
2. AI 서버가 원본 입력·파일을 SQLite `analyses`, `files`에 보관하고 `ai_chat_jobs` 작업 ID를 반환한다. 이 시점에는 기록이 아니다.
3. AI 서버는 DB의 기존 활동·확정 기록을 읽고 실제 파일 본문/첨부 또는 수집한 링크 본문과 함께 OpenAI에 전달한다.
4. 모델 출력의 형식·기존 활동 ID·파일 ID·변화 근거를 검증한다. 검증 실패를 목 성공으로 대체하지 않는다.
5. 신규 활동이면 AI 서버가 생성하고, 기존 활동이면 실제 ID를 재확인한다. 활동 생성과 분석 초안 확정을 하나의 트랜잭션으로 처리한다.
6. 프론트가 `/ai-api/chat/jobs/:id`를 조회해 완료 카드를 표시한다. 아직 기록 저장 완료로 표시하지 않는다.
7. 기록 버튼은 기존 백엔드 `/api/records`에 실제 `analysisId`, `activityId`, 확정 자료 유형을 보낸다.
8. 백엔드는 작업 완료 여부를 검증하고 기록·필요한 Timeline 이벤트를 저장한다. 아카이브·최근 목록·자료 조회·다운로드도 백엔드가 담당한다.

두 서버는 같은 로컬 SQLite 파일을 사용한다. 기존 기록·파일·활동을 초기화하지 않는다. DB 생성·스키마 확장은 백엔드 `database.js`에서 수행하므로 기존 서버를 재시작해 `ai_chat_jobs` 테이블을 추가해야 한다.

## 2. 개발 서버 실행

프로젝트 루트에서 각기 다른 터미널로 실행한다. Python 3.15.2와 기존 가상환경을 사용한다.

```powershell
npm.cmd --prefix api-server run dev
```

```powershell
cd ai-api-server
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\dev.cmd
```

```powershell
npm.cmd run dev
```

- 프론트: 기본 http://localhost:5173 (실제 터미널 출력 주소 확인)
- AI 실행 명세: http://127.0.0.1:8000/docs
- AI 준비 확인: http://127.0.0.1:8000/api/chat/health
- 백엔드: http://127.0.0.1:3001/api/health
- 프론트 정적 명세: `/swagger/`

키는 `ai-api-server/.env`의 OPENAI_API_KEY로 읽는다. 현재 선택 모델은 gpt-5.6-sol이며 브라우저로 키를 보내지 않는다. 프론트 VITE_AI_API_BASE_URL 기본은 `/ai-api`, VITE_API_BASE_URL 기본은 `/api`다. 외부 서버 전환 시 각각 AI·백엔드의 실제 `/api` 기본 주소로 설정한다. 이번 작업은 외부 배포가 아니다.

## 3. 실제 홈 API

| API | 요청·응답 |
| --- | --- |
| GET `/api/chat/health` | 키·모델 설정과 작업 DB 스키마 준비 상태. 이 요청으로 모델을 호출하지 않음 |
| POST `/api/chat` | multipart message, files 반복, conversationId 선택, requestId 선택. 항상 202 작업 응답 |
| POST `/api/chat/links` | JSON url, conversationId 선택, requestId 선택. 공개 페이지 본문 수집 후 분석하는 202 작업 |
| GET `/api/chat/jobs/{job_id}` | running/completed/failed와 실제 처리 단계. 완료 시 result에 analysisId·conversationId·reply·attachments·createdAt·message |

작업 ID는 `ai-` 접두사를 사용한다. 새로고침 후 같은 작업을 재조회해 원본 재업로드·카드 중복 생성을 피한다. 기존 세션의 예전 백엔드 작업은 이전 서버에서 조회한다. 프론트의 전체 폴링 제한은 120초이며 초과 시 작업을 자동 재전송하지 않는다.

진행 단계는 입력·DB 확인, 실제 모델 분석, 결과 보관의 실제 상태다. 시간만으로 진행 단계를 만들어내지 않는다. 동일 requestId와 동일 입력은 같은 작업을 반환하고 다른 입력이면 409다. 실패 작업을 자동으로 유료 재호출하지 않는다. 다시 전송하면 새 requestId가 발급된다.

서버가 재시작되면 남아 있던 queued/running 작업은 실패로 표시하고 재전송을 안내한다. 현재 로컬 개발은 AI 서버 한 프로세스·worker 1개를 기준으로 하며 다중 worker 복구 정책은 미구현이다.

### 파일과 링크 범위

- 파일당 10MiB·최대 10개·전체 25MiB. 지원하지 않는 형식이나 빈 파일은 거절한다.
- UTF-8 텍스트·코드는 실제 본문을 읽어 전달한다. 문서·PDF는 Responses input_file, 이미지는 input_image로 전달한다. 실제 첨부 파일 ID를 모델 출력과 대조한다.
- 지원 확장자는 `app/home_analysis.py`의 SUPPORTED_FILES를 따른다. HWP·암호화 문서 등 지원하지 않는 입력을 가짜 성공으로 처리하지 않는다. 모델이 처리하지 못하면 공급자 오류를 안내한다.
- 링크는 공개 HTTP/HTTPS 텍스트·HTML 페이지를 수집한다. 로컬·내부망·인증 포함 URL을 거부하고 이동 경로도 확인한다. 로그인·JS 실행이 필요한 페이지는 지원을 보장하지 않는다.
- 링크 본문은 최대 2MiB/100000자, 텍스트 파일 본문은 각각 100000자다. 원본 URL·파일명·원본 바이트를 유지한다.
- 기존 파일과의 버전 관계는 ID 근거가 없어 임의 생성하지 않는다. previousVersion은 현재 null이다.

### 활동·분석과 기록의 차이

AI가 new로 판단해 실제 DB 생성을 마친 활동은 응답에서 이미 존재하는 활동이므로 `match: existing`과 실제 ID로 정규화한다. 기존 프론트·백엔드 검증과 저장 버튼이 같은 ID를 사용한다. 이름이 충돌하거나 연결 활동이 삭제되면 분석 작업을 실패로 처리한다.

신규 활동은 기록 버튼을 누르기 전에도 DB에 존재할 수 있다. 사용자가 기록을 저장하지 않으면 빈 활동·분석 초안·원본은 남는다. 자동 삭제 정책은 아직 없다. unresolved는 ID가 없어 기존 활동 선택 후 저장해야 하며 다중 파일에는 수정 버튼을 새로 추가하지 않았다.

AI 완료는 analyses.reply의 확정이지 records 저장 완료가 아니다. 백엔드는 ai_chat_jobs.status가 completed인 경우에만 기록 저장을 허용한다. 원본 files는 analysis_id로 기록과 이어진다. 변화가 없으면 Timeline 이벤트를 만들지 않고, 현재 Turning Point 자동 확정은 하지 않는다.

## 4. 모델 프롬프트와 검증

프롬프트는 [app/prompts/home.md](../app/prompts/home.md)에 있으며 매 분석 요청의 instructions로 보낸다. 입력·파일·웹 본문은 지시문과 분리해 전달한다.

- 기존 활동 매칭·신규/미확정 판단, 실제 ID 사용
- 자료 내용에 따른 분류·이번 기록 요약·확인 가능한 단계
- 근거가 있는 Before/After만 변화로 반환, 일상 기록·단순 업로드에는 빈 changes
- 입력·첨부 안의 지시문 무시, 없는 활동·자료·성과·기간·버전 관계 생성 금지
- 저장 완료를 모델이 임의 선언하지 않음

프롬프트만으로 정확한 결과를 보장하지 않는다. HomeAnalysis Pydantic 스키마와 Structured Outputs로 출력 형식을 맞추고, 서비스 코드가 ID·파일 개수·변화 근거를 다시 검증한다. 실제 내용 정확도는 대표 입력과 기대 결과를 대조해 계속 점검한다. 별도 `/api/analyze/text`는 DB 저장 없는 분석 진단 API로 유지하며 홈은 `/api/chat` 작업 API를 사용한다.

공식 참고: [OpenAI 프롬프트 안내](https://developers.openai.com/api/docs/guides/prompt-engineering), [파일 입력 안내](https://developers.openai.com/api/docs/guides/file-inputs).

## 5. 스키마·명세와 변경 코드

신규 `ai_chat_jobs`: id(PK), request_key(UNIQUE), fingerprint, analysis_id(UNIQUE FK→analyses.id), kind, status, phase, error, input_json, created_at, updated_at. 기존 analysis_jobs는 이전 목 작업의 세션 조회·회귀 검사에 남겨 두고 새로운 실제 작업에는 사용하지 않는다.

생성된 FastAPI 명세 스냅샷은 `api-server/docs/ai-openapi.json`이다. AI 라우트·스키마를 바꾼 뒤 다음 순서로 갱신한다.

```powershell
# ai-api-server 폴더에서
.\.venv\Scripts\python.exe -m scripts.export_openapi
```

이후 루트의 `npm.cmd run docs:build` 또는 dev/build를 실행한다. 기존 백엔드 분석 POST 경로는 기본 410으로 폐기 안내하며 자동 목 fallback은 없다. 이전 저장 회귀 검사의 합성 입력만 createApp의 명시적인 testMockAnalysis 옵션으로 유지한다. `/example` 카드 예시와 Growth Journey 목 응답은 홈 분석 호출과 구분한다.

주요 코드: [작업 파이프라인](../app/chat.py), [모델 입력·카드 변환](../app/home_analysis.py), [공유 DB 처리](../app/database.py), [링크 수집](../app/links.py), [프론트 서비스](../../src/services/chat.ts), [백엔드 저장](../../api-server/src/app.js), [스키마 생성](../../api-server/src/database.js).

## 6. 검증과 남은 작업

실제 `node scripts/check-live-ai.mjs --extended`로 임시 DB·독립 백엔드·독립 FastAPI·Vite·프론트 서비스·OpenAI gpt-5.6-sol 전체 경로를 확인했다.

- 실제 텍스트 모델 응답 → 신규 활동 생성/연결 → 분석 초안 → 백엔드 기록 저장
- 중복 기록 저장 409, 완료 작업 재조회 시 동일 분석 ID
- 실제 단일 파일 본문 → 모델 분석 → 원본 보관 → 분류 수정 → 아카이브 조회 → 다운로드 바이트 일치
- 다중 파일 실제 분석·분류 합계·저장, 공개 example.com 본문 수집·실제 분석·저장
- 이전 백엔드의 목 분석 접수는 기본 410 확인

이 스크립트는 수동 실행 전용이며 API 사용료가 발생한다. 기존 사용자 DB를 초기화하거나 검증 자료를 넣지 않는다. 일반 자동 검사는 모델·외부 웹만 대체하여 상태 전이·DB 저장·중복·실패·원본 보존을 검사한다.

추가 검사: Python 29개 통과·pip 의존성 검사 통과, 백엔드 기존 19개와 신규 실제 모드 저장 제한 검사 1개 통과, 프론트/API·아카이브·Journey 회귀 검사와 세션 검사 통과. 프론트 build 통과, lint 오류 없음(기존 경고 3개). 기본 주소에서 실행한 프론트·백엔드·AI 서버와 Vite 프록시·정적 Swagger HTTP 응답도 확인했다.

실제 브라우저의 카드 클릭·픽셀·초점 확인과 PDF/Office/이미지의 실제 모델 분석 품질은 이번 통합 검사에서 확인하지 않았다. 기존 메모리/SQLite 회귀 검사와 실제 모델 검증 범위를 구분한다. Growth Journey 실제 분석, 사용자별 인증, 초안 정리 정책, 관련성 기반 문맥 검색, 외부 배포는 후속 작업이다.

## 7. 연결 오류 진단과 실패 작업 재전송

2026-11-06 추가 수정: ‘AI 분석 설정 준비됨’은 설정·작업 DB 검사 결과다. 실행 환경의 외부 네트워크 제한·DNS·인증서 문제는 실제 호출 시 별도로 실패할 수 있다.

GET `/api/chat/health?checkConnection=true`를 사용하면 **실행 중인 AI 서버 프로세스**의 HTTPS 연결을 검사한다. 진단 도구를 실행하는 터미널의 네트워크 권한과 실제 서버 권한은 다를 수 있다. 이 요청은 키를 보내지 않고 모델도 호출하지 않는다. network.connectionStatus=reachable과 httpStatus=401은 키 없는 요청이 OpenAI까지 도달했다는 의미이며 키 오류나 모델 가용성 확인 결과가 아니다.

연결 실패는 원문 오류를 노출하지 않고 openai_network_permission(소켓 권한·WinError 10013), openai_tls(인증서), openai_dns(DNS), openai_connection(기타 연결)으로 구분한다. 권한 제한 환경에서 실행한 서버라면 그 프로세스를 종료하고 일반 Windows PowerShell에서 dev.cmd로 실행한다. 인증서 검증을 끄거나 실패를 목 분석으로 대체하지 않는다.

실패가 확정된 작업(status=failed)은 재조회해도 같은 실패다. 프론트가 이를 pendingJob에서 해제하도록 수정했다. 채팅 내역을 유지하고 새 전송을 허용하며, 같은 화면에서 전송한 텍스트·원본 File 객체는 다시 보낼 수 있게 복원한다. 새로고침 후 복원된 과거 실패 작업도 대기에서 해제한다. 통신 오류·시간 초과로 결과가 미확정인 작업은 재조회 가능 상태를 유지한다. 자동 유료 재호출은 하지 않는다.

진단 기록: 제한된 도구 실행 환경에서는 WinError 10013이 재현됐고 일반 Windows 환경에서는 OpenAI HTTPS 응답을 확인했다. 실제 실행 중인 AI 서버의 연결 진단은 reachable이었으며, 저장 없는 `/api/analyze/text` 합성 입력 호출도 gpt-5.6-sol HTTP 200·analysisPersisted=false로 통과했다. 과거 실패 작업의 원문 네트워크 예외는 남아 있지 않아 과거 실패 원인을 현재 진단 결과만으로 확정하지 않는다.

수정 후 Python 32개·확정 실패/통신 실패 구분 검사·세션 복원 검사·프론트 build 통과. lint 오류 없음(기존 경고 3개). 실제 브라우저에서의 재전송 클릭은 미검증이다. 진단 구현은 `app/network.py`, 프론트 처리는 `src/services/chat.ts`·`src/pages/Home.tsx`를 따른다.
