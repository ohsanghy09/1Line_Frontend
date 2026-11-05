# Swagger 사용 안내

최신화: 2026-11-05. Swagger를 프론트 빌드에 포함하는 방식으로 변경했다.

## 로컬 실행

프로젝트 루트에서 실행한다. 문서 확인에는 api-server 의존성 설치·Express 실행·DB·AI 키가 필요 없다.

```powershell
npm.cmd install
npm.cmd run dev
```

터미널에 표시된 프론트 주소 뒤에 `/swagger/`를 붙여 직접 접속한다. 기본 포트라면 `http://localhost:5173/swagger/`다. 기존 앱 메뉴·링크·React 라우트에는 추가하지 않았다. 문서는 독립 HTML로 제공한다.

## 빌드·Vercel 배포

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

루트 의존성만 설치해도 문서를 생성할 수 있다. 개발 의존성을 제외한 설치는 사용하지 않는다. 명세 소스는 저장소의 api-server/docs와 기존 Zod 스키마를 빌드 시 읽지만 서버·DB 모듈은 실행하지 않는다. 루트 파일만 잘라서 업로드하지 않고 저장소 전체를 빌드 소스로 사용한다.

배포 후 주소는 `https://배포도메인/swagger/`다. [vercel.json](../../../vercel.json)은 `/swagger`를 `/swagger/`로 보내고 실제 정적 파일을 먼저 제공한 뒤 나머지 앱 경로를 index.html로 연결한다. Swagger 내부의 없는 파일은 404로 처리한다. Vercel 배포 자체는 아직 수행하지 않았다.

## 문서 선택·공유

- **백엔드 · 현재 개발 서버:** 현재 경로·메서드·요청·응답·오류. Request body, Responses, Schemas에서 확인한다.
- **AI · 모델 미정 / 입력·출력:** 기존 HomeAnalysisRequest·GrowthAnalysisRequest 제안과 ChatReply·Journey 응답을 Schemas에서 확인한다. 모델·공급자·인증·호출 주체·실행 경로는 미정이다.

상단 선택창에서 문서를 고른다. OpenAPI 원본은 같은 프론트 도메인의 `/swagger/openapi/backend.json`, `/swagger/openapi/ai.json`이다. 배포 후 이 주소 또는 Swagger 주소를 담당자에게 공유한다. 별도 문서 터널이나 내 컴퓨터의 상시 실행은 필요 없다.

기존 요청·응답 필드와 목 데이터는 변경하지 않았다. 기존 미정 항목인 scope·classification·messages 상세와 파일 내용 전달 방식도 그대로 남긴다. Try it out은 비활성화하고 외부 validator는 사용하지 않는다. Swagger 자산·라이선스도 배포 파일에 포함한다.

명세의 `http://127.0.0.1:3001`은 현재 개발 API를 설명하는 값이며 문서를 읽는 데 접속하지 않는다. 서비스 기능을 외부 개발 서버에 연결하는 `VITE_API_BASE_URL`·CORS·터널 설정과 Swagger 정적 배포는 별도 작업이다.

## 유지보수·검증

- [정적 생성 스크립트](../../../scripts/build-swagger.mjs): HTML·UI 자산·OpenAPI JSON 생성
- [명세 정의](../../../api-server/docs/openapi.js): 기존 검증 스키마와 응답 구조를 문서화
- [Vite 설정](../../../vite.config.ts): 개발·preview의 `/swagger/` 직접 접속 처리
- 기존 3002 [독립 문서 서버](../../../api-server/docs/server.js)는 선택적으로 유지하며 프론트 배포에는 사용하지 않는다.
- Zod 사용자 정의 날짜·기간·ID·선택지 검증은 JSON Schema만으로 전부 표현되지 않으므로 원본 설명도 확인한다.
- 로컬 개발·preview의 문서 HTML·명세·자산 HTTP 제공과 빌드 산출물을 확인한다. 실제 Vercel·브라우저 렌더링 검증과 구분한다.

이번 변경 후 build·lint(기존 홈 경고 3개) 및 서버 검사 19개가 통과했다. 개발 서버·preview에서 `/swagger/`와 JSON·CSS·JS의 HTTP 200, 개발 서버의 `/swagger` 리다이렉트, 빌드된 명세와 원본 일치·문서 링크를 확인했다. 실제 Vercel 배포와 브라우저 렌더링은 아직 확인하지 않았다.

기술 기준: [Vite 정적 자산](https://vite.dev/guide/assets.html#the-public-directory), [Vercel Vite](https://vercel.com/docs/frameworks/frontend/vite).
