# 프로젝트 문서

개발 문서는 루트 `docs/` 아래에서 프로젝트별로 관리한다. 문서 정리일: 2026-11-08.

| 구분 | 문서 안내 | 내용 |
| --- | --- | --- |
| 프론트엔드 | [frontend](frontend/README.md) | 개발 규칙, 화면별 구현·API 사용·변경 기록 |
| 프론트 연동 정비 | [frontend-integration](frontend-integration/README.md) | handoff 기준 API 대조, 독립 Swagger, 로컬 의존성, 변경 협의·검증 기록 |
| Growth Journey 수정 | [growth-journey-update](growth-journey-update/README.md) | 확정 성장 기준 5종, 구현 대상 JSON 계약·예시, AI 전달사항, 작업·검증 기록 |
| 백엔드·AI 분리 연동 | [backend-ai-integration](backend-ai-integration/README.md) | 활동·파일 분석 데이터 전달, 홈 내부 API, 서버 간 인증 계획과 검증 기록 |
| 백엔드 | [backend](backend/README.md) | API·DB·ERD·저장 및 삭제 계약, 로컬 서버 실행 안내 |
| AI | [ai](ai/README.md) | 분석 API·검증·프롬프트 정의, 로컬 서버 구현·실행 기록 |
| 공통 | [common](common/README.md) | 공통 계약, 서버 간 연동, 작업 계획, 서비스 정의와 참고 자료 |

## 폴더 구성

```text
docs/
  README.md
  backend-ai-integration/
    README.md
    작업_및_검증_기록.md
    examples/
      home-job-exchange.json
  growth-journey-update/
    README.md
    공통_JSON_계약.md
    AI_담당자_전달사항.md
    작업_및_검증_기록.md
  frontend-integration/
    README.md
    API_계약_대조표.md
    로컬_서버_의존성_점검.md
    변경_협의_및_검증_기록.md
  frontend/
    README.md
    개발_규칙.md
    후속_화면_검토사항.md
    chat/
    footprints/
    journey/
    현재구현_현황_정리/
  backend/
    README.md
    개발서버_실행안내.md
    handoff/
  ai/
    README.md
    개발서버_실행안내.md
    development/
    handoff/
  common/
    README.md
    개발_현황과_문서_이력.md
    handoff/
    integration/
      handoff/
      API_계약/
    review/
    references/
```

## 작업을 이어갈 때

- [백엔드·AI 분리 서버 연동](backend-ai-integration/README.md): 공유 DB 의존성 해소, 내부 데이터 전달·인증 구현 계획과 검증 기록.
- [프론트 API 연동 정비](frontend-integration/README.md): 이번 작업의 상세 조사·사용자 확인·검증 기록 진입점.
- [프론트 독립 및 원격 서버 연동 정비](common/integration/프론트엔드_독립_및_원격_서버_연동_정비.md): 현재 작업 계획. 실제 원격 서버 연동 검증은 별도 후속 작업이다.
- [인수인계 안내](common/handoff/README.md): 각 파트의 읽기 순서와 문서 전달 범위.
- [기존 개발 현황과 문서 이력](common/개발_현황과_문서_이력.md): 정리 이전 안내와 과거 검증 기록.

## 문서 관리 기준

새 문서는 담당 프로젝트 폴더에 추가하고, 여러 프로젝트가 공유하는 계약·연동 계획·참고 자료는 `common/`에 둔다. 각 프로젝트의 README에서 주요 문서로 연결하며, 링크는 해당 문서 위치를 기준으로 작성한다.

저장소 루트 README는 프로젝트 진입점으로 유지한다. 2026-11-11 백엔드·AI 개발 서버 소스와 로컬 서버 전용 검사 스크립트를 프론트 저장소에서 제거했다. backend·AI 문서의 과거 개발 서버 실행 기록과 소스 경로는 이전 구현 이력이며 현재 실행 안내가 아니다. handoff 계약·프롬프트 인계 문서는 유지한다. Swagger는 `docs/frontend-integration/openapi/`의 독립 명세와 handoff 문서를 읽어 `public/swagger/`에 생성한다.
