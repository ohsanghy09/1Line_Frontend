# 백엔드 문서

[전체 문서](../README.md) · [공통 인수인계](../common/handoff/README.md)

2026-11-11 프론트 독립화 후 api-server 소스·검사는 이 저장소에서 제거했다. 아래 handoff 계약은 유지하며 과거 로컬 실행 안내와 소스 링크는 이전 구현 이력이다. 현재 상태·보존 경로는 [프론트 연동 정비](../frontend-integration/README.md)를 따른다.

- [구현 인수인계](handoff/README.md): 백엔드 담당자의 읽기 순서와 책임.
- [API 정의서](handoff/API_정의서.md)
- [데이터베이스 정의서](handoff/데이터베이스_정의서.md) · [ERD](handoff/ERD.md)
- [저장과 삭제 규칙](handoff/저장과_삭제_규칙.md)
- [로컬 개발 서버 실행 안내](개발서버_실행안내.md): 기존 `api-server/`의 실행·설정·구현 기록. 명령은 안내에 지정된 소스 폴더에서 실행한다.

원격 서버 구현 계약과 기존 로컬 서버 동작 이력을 구분한다. 담당자에게 문서를 전달할 때는 [공통 전달 범위](../common/handoff/README.md#문서-전달-범위)를 따른다.
