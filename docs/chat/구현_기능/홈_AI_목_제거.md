# 홈 AI 목 실행 코드 제거

2026-11-06. 홈 입력은 `src/services/chat.ts`에서 FastAPI로 보내고 실제 OpenAI 분석 결과를 표시한다. 목 응답 fallback은 없다.

- `src/mocks/Home/chatResponse.ts`, `batchAnalysis.ts`, `chatStatus.ts`와 `src/examples/ExamplePage.tsx`를 제거했다. `/example`은 홈으로 이동한다.
- 기존 백엔드의 목 분석 생성·목 진행·testMockAnalysis 옵션을 제거했다. 분석 POST·작업 GET은 410으로 FastAPI를 안내한다.
- 회귀 검사 합성 결과는 `api-server/test-support/`, `tests/fixtures/chat.ts`에만 둔다. 실행 앱의 import와 분리했다. 문서 예시는 `api-server/docs/chat-examples.json`에서 읽는다.
- 사용자 DB·기존 저장 기록·세션은 보존했다. Growth Journey의 목 응답은 별도 후속 범위다.

실제 검증: `node scripts/check-live-ai.mjs --extended` 통과. 임시 DB와 실제 모델로 텍스트·단일 파일·다중 파일·공개 링크를 분석하고 활동 생성/연결·작업 복원·저장·중복 방지·분류 수정·아카이브 조회·다운로드 바이트를 확인했다. 합성 모델 검사와 구분하며 실행 시 모델 호출 비용이 발생한다.

빌드·lint(기존 경고 3개)·채팅 API/세션 회귀 검사 통과. 브라우저 직접 입력·클릭·반응형 전체 검증과 PDF/Office/이미지 품질 확인은 남아 있다.
