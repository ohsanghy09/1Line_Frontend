# Swagger 사용 안내

최신화: 2026-11-12. Growth Journey v2의 고정 5종·comparison·transfer·evidenceSources와 요청/응답 버전을 독립 OpenAPI 두 파일에 반영했다. 최신 공통 계약·AI 전달 문서·전체 JSON 예시는 Swagger의 원문 링크로 제공한다. 실제 AI 연동·배포·브라우저 렌더링은 미검증이다.

## 로컬 실행

프로젝트 루트에서 실행한다. 문서 확인에는 api-server 의존성 설치·Express 실행·DB·AI 키가 필요 없다.

```powershell
npm.cmd install
npm.cmd run dev
```

터미널에 표시된 프론트 주소 뒤에 `/swagger/`를 붙여 직접 접속한다. 기본 포트라면 `http://localhost:5173/swagger/`다. 기존 앱 메뉴·링크·React 라우트에는 추가하지 않았다. 문서는 독립 HTML로 제공한다.

## 빌드·Vercel 배포

사용자가 확인한 기존 배포 주소는 `https://1-line-frontend.vercel.app/`이며 Swagger 경로는
`https://1-line-frontend.vercel.app/swagger/`다. 2026-11-11 현재 최신 변경의 재배포는
사용자가 직접 진행할 작업이다. 배포 완료·HTTP 확인으로 기록하지 않는다.

```powershell
npm.cmd run build
npm.cmd run preview
```

`prebuild`가 Swagger 정적 파일을 생성하고 Vite가 `dist/swagger/`에 복사한다. preview 주소의 `/swagger/`에서도 확인할 수 있다. 생성 파일은 `public/swagger/`에 두며 Git에서는 제외한다. 명세 변경 시 `npm.cmd run docs:build` 또는 개발 서버 재실행·재빌드를 수행한다.

| Vercel 설정 | 값 |
| --- | --- |
| Root Directory | 프로젝트 루트 |
| Framework | Vite |
| Install Command | 기본 npm install 또는 npm ci |
| Build Command | npm run build |
| Output Directory | dist |

루트 의존성으로 문서를 생성할 수 있다. 빌드에는 개발 의존성도 설치한다. 생성 스크립트는 독립 OpenAPI 두 JSON과 문서 25개를 읽는다. 기존 handoff 21개와 `docs/growth-journey-update`의 Markdown 4개를 포함한다. 전체 요청·응답 예시 JSON도 같은 하위 경로에 복사하고 문서에서 연결한다. 프론트 코드·빌드 설정·독립 명세·원문·정적 자산을 빌드 소스에 포함한다.

배포 후 주소는 `https://배포도메인/swagger/`다. [vercel.json](../../../../vercel.json)은 `/swagger`를 `/swagger/`로 보내고 실제 정적 파일을 먼저 제공한 뒤 나머지 앱 경로를 index.html로 연결한다. Swagger 내부의 없는 파일은 404로 처리한다. Vercel 배포 자체는 아직 수행하지 않았다.

## 문서 선택·공유

- **백엔드 · 저장·조회**는 공개 API 16개와 AI가 호출하는 내부 API 3개를 제공한다.
- **AI · 홈·서버 분석**은 AI 담당자가 제공하는 공개 홈 API 4개와 백엔드가 호출하는 내부 분석 API 3개를 담는다. 분석 결과는 화면용 ChatReply와 작업 상태별 JobResponse로 정의한다.

각 문서의 ‘서버 간 내부 API’ 태그는 서버 전용이다. 해당 작업에 Bearer 인증 요구를 표시한다. 실제 토큰은 프론트에 저장하지 않는다. 내부 API는 handoff의 분리 서버 구현 규격이며 개발 서버의 구현 현황과 함께 해석할 때는 [대조표](../../../frontend-integration/API_계약_대조표.md)를 참조한다.

문서 첫 부분에 제공자·호출자, 분석 접수부터 기록 확정까지의 순서, ID 용도와 원문 링크를 표시한다. 각 API 제목의 화살표는 호출 방향이다. 공개·내부 Base는 실제 주소로 교체할 설명용 값이며 내부 API는 별도 Base를 사용할 수 있다. 담당자는 언어·프레임워크·DB를 선택하고 정의된 HTTP·JSON 및 저장 규칙을 구현한다.

Swagger의 원문 링크는 같은 배포의 `/swagger/handoff/` 아래 HTML을 연다. 원문을 이스케이프한 텍스트로 제공하고 문서 사이 링크를 연결한다. Growth Journey 계약은 `/swagger/handoff/growth-journey-update/공통_JSON_계약.html`, 전체 JSON 예시는 같은 폴더의 `examples/journey-exchange.json`이다. 이전 handoff의 자유 유형·두 기록 비교 정책은 최신 계약으로 대체됐다는 안내를 함께 읽는다.

상단 선택창에서 문서를 고른다. OpenAPI 원본은 같은 프론트 도메인의 `/swagger/openapi/backend.json`, `/swagger/openapi/ai.json`이다. 배포 후 이 주소 또는 Swagger 주소를 담당자에게 공유한다. 별도 문서 터널이나 내 컴퓨터의 상시 실행은 필요 없다.

OpenAPI 3.1의 required·nullable·oneOf·조건부 스키마로 필수 필드와 상태별 응답을 정의한다. SaveInput의 analysisId는 필수이며, AI 작업이 실패했을 때 완료 result를 포함하지 않도록 정의한다. Try it out은 비활성화하고 외부 validator는 사용하지 않는다. Swagger 자산·라이선스도 배포 파일에 포함한다.

명세 Base는 handoff의 설명용 `https://backend.example.org/api`·`https://ai.example.org/api`다. 담당자가 제공하는 실제 주소를 연결 단계에서 반영한다. 프론트 서비스의 `VITE_API_BASE_URL`·`VITE_AI_API_BASE_URL`과 CORS는 원격 연결 검증에서 함께 확인한다.

## 유지보수·검증

- [정적 생성 스크립트](../../../../scripts/build-swagger.mjs): HTML·UI 자산·OpenAPI JSON 생성
- [백엔드 명세](../../../frontend-integration/openapi/backend.openapi.json)와 [AI 명세](../../../frontend-integration/openapi/ai.openapi.json)에 handoff 계약을 반영
- [명세 검사](../../../../tests/openapi.test.mjs)는 공개 API 목록·내부 인증·경로 매개변수·스키마 참조·필수 제약을 확인
- [Vite 설정](../../../../vite.config.ts): 개발·preview의 `/swagger/` 직접 접속 처리
- 기존 3002 독립 문서 서버는 개발 서버 폴더와 함께 제거했다. 현재 `/swagger/` 정적 생성 경로만 사용한다.
- 실제 달력 날짜·기간 순서·원문 근거·실제 ID 참조·스냅샷·원자성은 handoff의 의미 검증 규칙도 함께 확인한다. ChatHealth.network의 세부 필드는 handoff에서 정의하지 않아 설명을 남긴 객체로 표현했다.
- 로컬 개발·preview의 문서 HTML·명세·자산 HTTP 제공과 빌드 산출물을 확인한다. 실제 Vercel·브라우저 렌더링 검증과 구분한다.

최신 검사: 전체 프론트 테스트 51개(기존 명세·링크 검사 4개와 새 Journey 명세 검사 3개 포함), 세션 검사, lint 및 Swagger 자동 생성을 포함한 빌드 통과. 링크 검사에서 Markdown 원문 25개와 전체 JSON 예시 연결을 확인했다. 별도 정식 JSON Schema 검증 56개도 통과했다. 실제 원격 연결과 Vercel 배포·브라우저 렌더링은 미검증이다.

선택적으로 `jsonschema` Python 패키지를 설치한 환경에서는 `python scripts/check-journey-openapi.py`로 Journey 스키마·예시·거절 사례를 확인할 수 있다. 이 검증기는 런타임 의존성이 아니다. 원문 존재·동적 참조·성장 판단의 의미까지 JSON Schema가 보장하는 것은 아니다.

기술 기준: [Vite 정적 자산](https://vite.dev/guide/assets.html#the-public-directory), [Vercel Vite](https://vercel.com/docs/frameworks/frontend/vite).
