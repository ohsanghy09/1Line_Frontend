# 개발용 REST API 서버

홈 전송・링크 접수・준비 상태・진행 조회와 홈 카드 저장·수정을 실제 REST API로 연결했다. 홈 대화와 작업 복원은 sessionStorage를 사용한다. [통합 현황](../현재_구현_상태.md)과 [연결 설명](../api/로컬_채팅_연결.md)을 참고한다.

최종 정리: 2026-11-04

## 구현 범위

`api-server/`에 독립 Node.js 24 + Express + SQLite 서버를 구현했다. Express·CORS·Multer·Zod를 별도 package.json과 lockfile로 설치했다. SQLite는 Node 내장 기능을 사용한다.

텍스트·파일 전송 시 사용자 입력과 원본 파일·목 응답을 초안으로 저장한다. 기록 API를 호출하면 활동 아카이브 기록으로 확정하고 변화가 있는 경우 Timeline 이벤트도 함께 저장한다. 변화가 없으면 이벤트를 생성하지 않는다. 활동·분류·요약·본문·변화를 수정할 수 있다.

홈은 분석 초안 ID로 원본 파일 연결을 유지한다. 직접 reply 저장은 서버의 개발 계약으로 남아 있으나 현재 홈은 사용하지 않는다.

## 데이터와 실제 입력 구분

- 실제 입력: 텍스트, 한글 포함 파일명, 크기, MIME, 파일 원본, 서버 저장 시각.
- 목 분석: 예시 활동·자료 유형·요약·Before/After. 파일 내용 분석은 수행하지 않는다.
- 요청의 `mode`로 변화 있음/없음을 선택한다. 기본은 변화 없음이다.
- SQLite `data/1line.db`의 activities, analyses, files, records, timeline_events, analysis_jobs 테이블에 보관한다.
- 활동은 예시 5개로 초기화한다. DB·의존성 폴더는 Git에서 제외한다.

## 사용법과 API 교체

[서버 README](../../../backend/개발서버_실행안내.md)에 실행·환경변수·요청·오류·제한을 기록했다. 실제 AI 연결 시 서버의 `src/mock-reply.js`와 목 진행 계산을 교체한다. 프론트는 이미 `src/services/chat.ts`와 기록 서비스를 통해 요청하고 응답의 `reply`를 카드에 전달한다.

이 서버는 인증 없는 로컬 개발용이며 기본적으로 이 컴퓨터에서만 접속한다. 저장 중·성공·실패 표시와 수정 모달은 구현했다. Growth Journey, 후속 화면의 DB 조회, 실제 AI, 문서/웹 내용 추출, 삭제 정책은 남은 작업이다.

## 검증

`api-server`의 `npm.cmd test`와 루트의 `node scripts/check-chat-api.mjs`, `check-chat-session.mjs`로 원본 업로드·다운로드, 링크, 진행·재개, 기록·수정·Timeline, DB 유지, 세션 복원·중복 방지·오류를 확인했다. build/lint도 통과했다. 브라우저 직접 검증은 미실시다. 이번 문서 정리에서 재실행하지는 않았다.
