# 프론트 독립화 전 통합 검사 보존본

2026-11-11 프론트 검사를 독립화하면서 기존 DB·HTTP 시나리오와 단언을 보존했다.
경로만 현재 위치에 맞췄으며 자동 테스트에서는 실행하지 않는다.

- `check-chat-api.mjs`: 이전 채팅·SQLite 통합 검사. ID 없는 저장과 non-ai 작업 복원 등 과거 계약의 기대값을 포함하므로 현재 계약 검사로 사용하지 않는다.
- `footprint-file-timeline.mjs`: 저장·이동·삭제와 DB 조회를 연결한 이전 통합 시나리오.
- `journey-api.mjs`: 실제 DB의 미분석 상태와 프론트 응답 검증을 함께 수행하던 이전 검사.

현재 프론트 계약 검사는 루트 `npm test`로 실행한다. 서버 검색 함수 단위 검사는
`api-server/test/archive-filter.test.js`로 이동했으며 해당 폴더의 기존 archive·home·journey·progress 검사도 유지한다.
이 보존본은 서버 구현·DB 검증 목적을 추적하기 위한 자료이며 최신 분리 서버 연동 성공을 입증하지 않는다.
