# AI 문서

[전체 문서](../README.md) · [공통 인수인계](../common/handoff/README.md)

2026-11-11 프론트 독립화 후 ai-api-server 소스·검사는 이 저장소에서 제거했다. handoff 계약과 프롬프트 인계 원문은 유지한다. 아래 로컬 실행·구현 기록과 소스 링크는 이전 이력이며 현재 상태·보존 경로는 [프론트 연동 정비](../frontend-integration/README.md)를 따른다.

- [구현 인수인계](handoff/README.md): AI 담당자의 읽기 순서와 책임.
- [API 정의서](handoff/API_정의서.md)
- [분석 입출력과 검증 규칙](handoff/분석_입출력과_검증_규칙.md)
- [프롬프트 정의서](handoff/프롬프트_정의서.md): 전달용 프롬프트 전문.
- [로컬 개발 서버 실행 안내](개발서버_실행안내.md): 기존 `ai-api-server/`의 설치·환경설정·실행.
- [홈 실제 AI 연동](development/홈_실제_AI_연동.md) · [텍스트 분석 API](development/텍스트_분석_API.md)
- [DB 직접 연결](development/DB_직접_연결.md) · [기본 서버 구현](development/기본_서버_구현.md) · [작업 계획](development/작업_계획.md)

`development/`는 로컬 개발 서버의 구현 이력이다. 원격 서버 계약은 `handoff/`를 기준으로 읽고, 명령은 안내에 지정된 소스 폴더에서 실행한다. 실행 시 사용하는 프롬프트 파일은 `ai-api-server/app/prompts/`에 유지한다.
