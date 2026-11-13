# Growth AI

파일, 링크, 텍스트로 경험을 기록하고, AI가 활동별로 정리해
변화와 성장 과정을 보여주는 개인 성장 아카이브 서비스입니다.

결과뿐 아니라 그 과정에서 무엇이 달라졌는지,
어떤 경험이 쌓였는지를 실제 기록과 자료를 바탕으로 확인할 수 있습니다.

## 개발 상태

2026-11-13 활동 정보 분석 응답의 promptVersion을 실제 AI와 같은 `activity-metadata-analysis`로 정합화했습니다. Spring 검사 48개·JAR 빌드와 OpenAPI 검사 4개를 통과했으며, [호환 보완 작업](docs/backend-ai-fixes/README.md)의 나머지 3개 기능은 구현 전입니다. 실제 AI 모델·EC2·브라우저 검증은 수행하지 않았습니다.

2026-11-13 Spring에 서버 간 Bearer 인증과 홈 문맥 조회·분석 작업 게시/재조회 내부 API를 구현했습니다. 초안·원본 보관, revision·중복·삭제 후 재전송 처리와 단일 백엔드 재시작 복구를 포함합니다. 활동 정보 분석의 기록·파일 메타정보·해시 JSON 전달과 파일 일부 삭제 재분석의 남은 원본 전달도 구현했으며 Spring 검사 47개·JAR 빌드를 통과했습니다. AI 측 호출 구현과 실제 서버 연동·배포는 미확인입니다. [백엔드·AI 분리 연동 작업](docs/backend-ai-integration/README.md)을 참고하세요.

2026-11-12 Growth Journey에 고정 5종 성장 판단과 유형별 이유·비교·경험 전이·원문 근거 추가 펼침을 적용했습니다. Spring·DB와 프론트의 구현 기준 및 검증 범위는 [Growth Journey 수정 기록](docs/growth-journey-update/README.md)에 있습니다. OpenAPI·Swagger도 같은 계약으로 갱신했으며 Swagger에서 최신 계약과 JSON 예시를 확인할 수 있습니다. 실제 AI 연동과 배포는 수행하지 않았습니다.

프론트 화면과 HTTP API 서비스, 대화 복원, 기록 저장·수정·삭제 요청 흐름을 구현했습니다.
백엔드·AI 개발 서버와 초기 화면용 목데이터는 제거했으며, 프론트 설치·검사·빌드·Swagger 생성은 독립적으로 실행할 수 있습니다.

실제 분석과 영속 데이터의 저장·조회에는 별도로 제공되는 백엔드·AI 서버가 필요합니다.
원격 서버 연결과 CORS·인증·업로드·저장·복원 등의 실제 동작 검증은 서버 준비 후 진행합니다.
현재 작업 상태와 검증 범위는 [프론트 연동 정비 기록](docs/frontend-integration/README.md)에서 확인할 수 있습니다.

## 주요 기능

| 화면·기능 | 구현 범위 |
| --- | --- |
| Growth AI | 텍스트·파일·링크 전송, 분석 진행·결과 카드 표시, 활동 연결·자료 유형 수정, 명시적 기록 저장 |
| 대화 복원 | 같은 탭의 대화·카드 복원, AI 작업 재조회, 대화 초기화 |
| 홈 최근 목록 | 최근 활동·기록 조회, 날짜 표시, 관련 활동·자료 이동 |
| Growth Journey | 저장된 성장 분석 조회, 유형·분야 필터, 상세 펼침, 수동 분석 요청 |
| 나의 발자국 | 활동 검색·필터·정렬, 활동별 아카이브 탐색 |
| 활동 아카이브 | 폴더별 자료, 자료 Drawer, 요약·버전 관계·근거 이벤트 표시 |
| Project Timeline | 활동별 변화·Turning Point와 근거 자료 이동 |
| 데이터 관리 | 자료·활동·전체 데이터 삭제 확인 UI와 API 요청 |

주요 변화가 없는 자료도 아카이브에 보관하며,
모든 기록을 성장이나 전환점으로 분류하지 않습니다.

## 기술 스택

| 구분 | 기술 |
| --- | --- |
| UI | React |
| 언어 | TypeScript |
| 개발 및 빌드 | Vite |
| 스타일 | Tailwind CSS |
| 라우팅 | React Router |

## 시작하기

Node.js 24 계열과 npm 11 계열을 사용합니다. `package.json`의 engines에 이 범위를 명시했고,
packageManager는 검증한 npm 11.21.1을 기록합니다. 검증한 Node.js 버전은 24.14.0이며,
`node --version`·`npm --version`으로 실행 환경을 확인합니다.
프로젝트 루트에서 lockfile 기준으로 의존성을 설치하고 프론트 개발 서버를 실행합니다.

```bash
npm ci
npm run dev
```

터미널에 표시된 로컬 주소로 접속합니다. 화면의 API 기능을 사용하려면 아래 서버 주소 설정이 필요합니다.

## API 서버 연결

백엔드와 AI 서버의 Base URL을 각각 설정합니다. 프로젝트 루트의 `.env.example`을 `.env.local`로 복사한 뒤
원격 서버 주소를 다음과 같이 작성합니다. 아래 주소는 설명용 예시이며 실제 제공받은 주소로 바꿉니다.

```dotenv
VITE_API_BASE_URL=https://backend.example.org/api
VITE_AI_API_BASE_URL=https://ai.example.org/api
```

두 값은 `/api`를 포함한 Base URL입니다. 개발 서버 실행 전에 설정하고, 변경 후에는 개발 서버를 재시작합니다.
Vite 빌드에 반영되는 값이므로 배포 환경에서 변경하면 다시 빌드·배포해야 합니다.
이 변수는 브라우저에 포함되므로 API 주소만 설정하고 서버 비밀키나 내부 토큰은 넣지 않습니다.

프론트에서 원격 API를 직접 호출하므로 각 서버에서 프론트 주소를 CORS로 허용해야 합니다.
로컬 백엔드·AI 서버와 Vite API 프록시는 사용하지 않습니다.

API Base 미설정 시 `/api`·`/ai-api` 상대 경로를 사용하지만 이 프로젝트에서 해당 API를 제공하지 않습니다.
화면의 API 기능을 사용할 때는 실제 원격 Base URL을 설정해야 합니다.

`.env`·`.env.*`는 Git에서 제외하고 `.env.example`만 공유합니다.

Vercel에서는 원격 Base URL을 빌드 환경변수로 지정합니다.
현재 `vercel.json`은 정적 파일과 SPA 경로를 처리하며 API를 제공하지 않습니다.

## API 문서

API 명세는 같은 프론트 주소의 `/swagger/`로 직접 접속합니다. 개발·프로덕션 빌드 전에 Swagger 정적 파일이 자동 생성되며 Vercel 배포에도 포함됩니다. [Swagger 사용 안내](docs/common/integration/API_계약/Swagger_사용안내.md)를 참고하세요.

`docs/frontend-integration/openapi/`의 독립 OpenAPI와 handoff 문서를 사용합니다.
백엔드 공개 API 16개·AI 공개 API 4개와 서버 간 내부 API 6개를 문서화했으며, 문서 확인에는 서버 실행·DB·AI 키가 필요 없습니다.
Swagger는 읽기 전용으로 제공하며 문서의 Base URL은 실제 원격 연결 완료를 뜻하지 않습니다.

## 주요 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm ci` | lockfile 기준 의존성 설치 |
| `npm run dev` | Swagger 생성 후 프론트 개발 서버 실행 |
| `npm test` | 서버·DB·실제 AI 없이 프론트 계약·필터·세션·명세 검사 |
| `npm run lint` | 코드 검사 |
| `npm run docs:build` | Swagger·handoff 정적 문서 생성 |
| `npm run build` | Swagger 생성·TypeScript 검사·프로덕션 빌드 |
| `npm run preview` | 빌드 결과 로컬 확인 |

Windows PowerShell에서는 `npm` 대신 `npm.cmd`로 실행할 수도 있습니다.

## 검사와 빌드 확인

```bash
npm test
npm run lint
npm run build
npm run preview
```

프론트 검사는 실제 서비스 함수와 합성 HTTP 응답을 사용합니다. `tests/fixtures/`의 데이터는 검사 전용이며
실제 서비스 응답을 대체하지 않습니다. `node scripts/check-chat-api.mjs`로 채팅 계약 검사만 실행할 수도 있습니다.

2026-11-11 서버·기존 node_modules 없는 환경에서 새 설치 후 검사 39개·세션 복원·빌드·Swagger 생성을 통과했습니다.
로컬 프록시를 사용하지 않기로 결정해 해당 설정과 전용 검사 3개를 제거했습니다.
이후 lint·중복 코드 정리와 최근 목록 요청 경쟁·취소 검사 3개를 추가해 현재 검사 42개·세션 복원·빌드·Swagger 생성이 통과했습니다.
lint는 오류·경고 모두 0개입니다. 추가 검사는 실제 hook의 Effect 요청 로직을 분리해 확인하며 React 렌더링·DOM 검사를 대신하지 않습니다.
브라우저의 실제 저장·복원과 원격 서버 간 연동 성공은 이 자동 검사 결과에 포함되지 않습니다.

## 폴더 구성

```text
src/       화면·컴포넌트·HTTP 서비스·타입·유틸
tests/     프론트 계약·필터·복원·명세 검사와 합성 데이터
scripts/   Swagger 생성과 개별 검사 진입점
docs/      구현 기록·백엔드/AI handoff·독립 OpenAPI
public/    정적 자산과 생성된 Swagger
```

원본 파비콘 PNG는 `public/assets/Growth_AI_favicon.png`에 보존합니다.
실제 파비콘은 PNG를 내장하고 원형으로 마스킹한 `public/assets/Growth_AI_favicon_round.svg`이며
`/assets/Growth_AI_favicon_round.svg`로 제공합니다. 사이드바 설명 문구는 ‘나의 경험을 성장으로’입니다.
탭 제목·화면 브랜드·문서 제목은 Growth AI이며, npm 패키지 이름은 소문자 형식인 `growth-ai`를 사용합니다.

백엔드·AI 개발 서버 소스와 로컬 서버 전용 통합 검사는 이 저장소에서 제거했습니다.
API 계약·프롬프트 인계 문서는 `docs/`에 유지합니다. `public/swagger/`와 `dist/`는 생성물이며 Git에서 제외합니다.

## 다음 작업

- [ ] 최신 변경을 Vercel에 배포하고 제목·원형 파비콘·안내 문구·Swagger를 확인합니다. 재배포는 사용자가 직접 진행합니다.
- [ ] 백엔드·AI 담당자에게 실제 API 주소·인증·CORS·업로드 제한·일반 링크 지원 범위를 확인합니다.
- [ ] `.env.local`과 Vercel 빌드 환경변수에 실제 API Base를 설정합니다. 로컬 API 서버·프록시는 사용하지 않습니다.
- [ ] 원격 서버 연결 후 분석·저장·조회·수정·삭제와 화면 갱신·작업 복원·실패·재조회를 실제 브라우저에서 검증합니다.

상세 순서·확인 항목·결과 기록 방법은 [다음 세션 작업 목록](docs/frontend-integration/README.md#다음-작업)을 따릅니다.

## 브랜치 전략

- `main`: 배포 기준 브랜치
- `develop`: 개발 통합 브랜치
- `feature/*`: 기능별 작업 브랜치

기능 브랜치는 `develop`에서 생성하고,
작업 완료 후 PR을 통해 `develop`에 병합합니다.
배포할 변경 사항은 `develop`에서 `main`으로 병합합니다.

## 참고 문서

- [문서 목록](docs/README.md)
- [프론트 연동 정비·최신 검증 기록](docs/frontend-integration/README.md)
- [백엔드·AI 인수인계 안내](docs/common/handoff/README.md)
- [Swagger 사용 안내](docs/common/integration/API_계약/Swagger_사용안내.md)
- [화면 참고 HTML](docs/common/references/1Line_reference.html)
- [개발 규칙](docs/frontend/개발_규칙.md)
- [후속 화면 검토사항](docs/frontend/후속_화면_검토사항.md)
