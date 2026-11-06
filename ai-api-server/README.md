# AI API 개발 서버

프로젝트 최상위 `api-server/`와 같은 위치에서 관리하는 Python·FastAPI 기반 AI 개발 서버 영역이다. 실제 OpenAI API를 사용하여 입력 분석과 활동 매칭·신규 활동 생성을 구현할 예정이다.

현재 기본 서버·상태 확인 API와 실제 OpenAI 텍스트 분석 API를 구현했다. Python 3.15.2에서 `gpt-5.6-sol` 실제 호출을 확인했다. 활동·분석 DB 저장과 프론트 연동은 후속 작업이다.

## 설치와 실행 — Windows PowerShell

프로젝트 루트에서 AI 서버 폴더로 이동한다. Python Install Manager에 Python 3.15가 설치된 환경을 기준으로 한다.

```powershell
cd ai-api-server
py -3.15 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

현재 PC에는 위 가상환경과 라이브러리를 준비했다. 다른 PC에서 처음 구성할 때 위 명령을 사용한다. `requirements.in`은 직접 의존성 목록이고 `requirements.txt`는 이번 Python 3.15.2 환경에서 검증한 전체 설치 버전이다. 의존성을 변경할 때는 설치·검사 후 고정 버전도 갱신한다.

`.env`가 없다면 예시를 복사한다. 기존 `.env`는 덮어쓰지 않는다.

```powershell
Copy-Item .env.example .env
```

실제 키와 모델 ID는 사용자가 `.env`에 직접 입력한다. 현재 사용자 설정의 `gpt-5.6-sol` 실제 호출을 확인했다. OS 환경변수가 `.env`보다 우선하며, `.env`는 실행 위치와 관계없이 AI 서버 폴더에서 읽는다. 설정 변경 후 서버를 재시작한다.

| 환경변수 | 기본값·의미 |
| --- | --- |
| OPENAI_API_KEY | 비어 있음. 서버용 키, 응답에는 값이 노출되지 않음 |
| OPENAI_MODEL | 예시는 비어 있음. 현재 선택한 모델 ID는 `gpt-5.6-sol` |
| OPENAI_TIMEOUT_SECONDS | 45초. 1~120초 설정 가능, 자동 재시도 없음 |
| AI_CORS_ORIGINS | `http://localhost:5173,http://127.0.0.1:5173`. 허용 프론트 주소를 쉼표로 구분 |

서버를 실행한다. 가상환경 활성화나 PowerShell 실행 정책 변경은 필요 없다.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

중지는 `Ctrl+C`다. 8000번 포트가 사용 중이면 `--port`로 다른 포트를 지정한다. 기존 백엔드(3001)·문서 서버(3002)와 분리했다. 프론트 요청 경로·프록시는 이번에 변경하지 않았다.

- 상태 확인: http://127.0.0.1:8000/api/health
- Swagger UI: http://127.0.0.1:8000/docs
- OpenAPI JSON: http://127.0.0.1:8000/openapi.json

Swagger UI의 브라우저 렌더링은 외부 CDN 리소스 접근이 필요하다. `/openapi.json`은 서버 자체에서 제공한다. 기존 프론트 `/swagger/` 정적 문서는 아직 AI 서버 명세와 연결하지 않았다.

## 상태 확인 응답

```json
{
  "status": "ok",
  "service": "ai-api-server",
  "openai": {
    "apiKeyConfigured": false,
    "modelConfigured": false,
    "connectionStatus": "not_checked"
  }
}
```

`status: ok`는 서버가 요청에 응답한다는 의미다. 키·모델이 없어도 200으로 응답한다. 설정 여부는 값 존재만 확인하며 키 유효성·모델 사용 가능 여부·실제 OpenAI 연결 성공을 보장하지 않는다. 상태 확인은 외부 요청이나 비용을 발생시키지 않고, 이전 분석의 연결 성공 상태도 보관하지 않는다.

## 실제 텍스트 분석

Swagger의 `POST /api/analyze/text`에서 아래 JSON을 실행한다. 실제 OpenAI 요청이 발생한다. 프론트 홈은 아직 이 API에 연결하지 않았다.

```json
{
  "input": { "kind": "text", "message": "1호선톤 회의록을 정리했습니다. 별도의 기획 변경은 없었습니다." },
  "context": {
    "activities": [{ "id": "example-activity-1", "name": "1호선톤" }],
    "records": []
  }
}
```

`context`는 생략할 수 있다. 이번 단계는 요청에 제공한 개발용 문맥만 분석하며 DB에서 실제 활동을 조회하지 않는다. 응답은 `requestId`, `analysisProvider`, `model`, `activityPersisted: false`, `analysisPersisted: false`, `analysis`다. 신규 활동 판단이 나와도 DB 생성은 아직 하지 않으며, `requestId`를 백엔드 저장용 `analysisId`로 사용하면 안 된다.

상세 요청·응답·오류와 검증 범위는 [텍스트 분석 API](docs/텍스트_분석_API.md)에 정리했다.

## 검증

AI 서버 폴더에서 실행한다.

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m pip check
```

검증 결과와 범위는 [기본 서버 구현 기록](docs/기본_서버_구현.md)을 참고한다. 이번 HTTP 검증용 프로세스는 종료했으며 서버를 계속 사용하려면 위 실행 명령으로 시작한다.

실제 OpenAI 연결을 수동으로 다시 검증하려면 아래 명령을 사용한다. 합성 입력 1회가 전송되며 API 사용료가 발생할 수 있다. 일반 자동 검사에는 포함되지 않는다.

```powershell
.\.venv\Scripts\python.exe -m scripts.check_openai
```

## 다음 작업

1. [AI 서버 작업 계획](docs/작업_계획.md)을 읽는다.
2. [전체 연동 작업 계획](../docs/integration/개발서버_분리_연동_작업계획.md)과 기존 백엔드·AI 계약을 대조한다.
3. 기본 서버와 실제 텍스트 분석 연결은 완료했다. 다음은 활동 DB 연결·분석 보관 → 백엔드·프론트 연동 순서로 진행한다.

API 키는 서버 환경변수로 관리한다. 키를 프론트·문서·저장소에 포함하지 않는다. 모델과 DB 연결 상세는 구현 전 확인하며 기존 사용자 DB는 보존한다.
