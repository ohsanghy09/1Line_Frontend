# Growth Archive

파일, 링크, 텍스트로 경험을 기록하고, AI가 활동별로 정리해
변화와 성장 과정을 보여주는 개인 성장 아카이브 서비스입니다.

결과뿐 아니라 그 과정에서 무엇이 달라졌는지,
어떤 경험이 쌓였는지를 실제 기록과 자료를 바탕으로 확인할 수 있습니다.

## 개발 상태

현재 프론트엔드 초기 개발 환경을 구성한 단계입니다.
아래 주요 기능은 구현 예정입니다.

## 주요 기능

- **Growth AI**
  - 텍스트, 파일, 링크를 통한 경험 기록
  - AI 기반 활동 분류와 자료 요약
  - 기존 기록과 비교하여 주요 변화 발견

- **Growth Journey**
  - 여러 활동에 걸친 개인 성장 흐름 확인
  - 성장 유형과 분야별 필터링

- **나의 발자국**
  - 활동 검색, 필터링 및 정렬
  - 활동별 자료 아카이브 탐색

- **활동 아카이브**
  - 폴더별 자료와 파일 상세 정보 확인
  - 자료의 버전과 변경 내용 확인

- **Project Timeline**
  - 활동별 변화 과정과 주요 전환점 확인
  - 변화 전후 내용과 근거 자료 확인

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

프로젝트 루트에서 의존성을 설치합니다.

```bash
npm install
```

개발 서버를 실행합니다.

```bash
npm run dev
```

터미널에 표시된 로컬 주소로 접속합니다.

API 명세는 같은 프론트 주소의 `/swagger/`로 직접 접속합니다. 개발·프로덕션 빌드 전에 Swagger 정적 파일이 자동 생성되며 Vercel 배포에도 포함됩니다. [Swagger 사용 안내](docs/common/integration/API_계약/Swagger_사용안내.md)를 참고하세요.

## 주요 명령어

| 명령어 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm test` | 서버·DB·실제 AI 없이 프론트 계약·필터·세션·명세 검사 |
| `npm run lint` | 코드 검사 |
| `npm run build` | TypeScript 검사 및 프로덕션 빌드 |
| `npm run preview` | 빌드 결과 로컬 확인 |

프론트 검사는 Node.js 24 이상과 루트 의존성만 사용합니다. 테스트 데이터는
`tests/fixtures/`에 있으며 실제 서비스 응답을 대체하지 않습니다.
`node scripts/check-chat-api.mjs`로 채팅 계약 검사만 실행할 수도 있습니다.

실제 API 기능을 사용하려면 백엔드·AI 서버가 필요합니다. 원격 연결 시
`VITE_API_BASE_URL=https://백엔드주소/api`와 `VITE_AI_API_BASE_URL=https://AI주소/api`를
빌드 전에 설정합니다. 미설정 시 `/api`·`/ai-api`를 사용하며 개발 환경에서는
Vite 로컬 프록시로 연결합니다. 정적 호스팅에서는 별도 API 라우팅 또는 원격 Base가 필요합니다.

이 저장소에는 백엔드·AI 개발 서버와 로컬 서버 전용 통합 검사 스크립트가 포함되지 않습니다.
API 계약·프롬프트 인계 문서는 `docs/`에 유지하며 실제 원격 서버 연결 검증은 서버 준비 후 진행합니다.

## 브랜치 전략

- `main`: 배포 기준 브랜치
- `develop`: 개발 통합 브랜치
- `feature/*`: 기능별 작업 브랜치

기능 브랜치는 `develop`에서 생성하고,
작업 완료 후 PR을 통해 `develop`에 병합합니다.
배포할 변경 사항은 `develop`에서 `main`으로 병합합니다.

## 참고 문서

- [문서 목록](docs/README.md)
- [화면 참고 HTML](docs/common/references/1Line_reference.html)
- [개발 규칙](docs/frontend/개발_규칙.md)
- [후속 화면 검토사항](docs/frontend/후속_화면_검토사항.md)
