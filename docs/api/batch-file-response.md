# 다중 파일 분석 목 응답

현재는 파일을 전송하면 약 1.3초 뒤 분석 결과 형태의 목 응답을 반환한다. 파일은 서버에 업로드하지 않으며, 실제 내용 대신 **파일명**으로 자료 유형과 버전 관계를 구성한다.

## 화면에 표시하는 결과

- 원본 시나리오의 예시 활동인 **1호선톤**으로 연결
- 선택한 파일 수에 맞는 자동 매칭 개수
- 기획안·와이어프레임·회의록·발표자료·기타 자료의 유형별 개수
- 같은 이름의 `v1 → v2/final` 버전 관계
- 전송한 파일명과 각 파일의 자료 유형

저장 버튼은 표시만 하며 실제 저장 기능은 아직 연결하지 않았다.

## 원본과 같은 결과를 확인하는 파일명

| 첨부 파일 | 분류 | 연결할 이전 버전 |
| --- | --- | --- |
| `idea_v1.pdf` | 기획안 | 없음 |
| `idea_final.pdf` | 기획안 | `idea_v1.pdf` |
| `wireframe_v1.pdf` | 와이어프레임 | 없음 |
| `wireframe_v2.pdf` | 와이어프레임 | `wireframe_v1.pdf` |
| `meeting.docx` | 회의록 | 없음 |

이 5개를 전송하면 기획안 2개, 와이어프레임 2개, 회의록 1개로 묶인다. 다른 파일을 보내면 실제 이름과 개수에 맞춰 결과가 달라진다.

파일명에 `idea`, `proposal`, `기획`, `제안`이 있으면 기획안, `wireframe`, `와이어프레임`은 와이어프레임, `meeting`, `회의`는 회의록, `presentation`, `발표`는 발표자료로 분류한다. 알 수 없는 파일은 기타 자료로 분류한다.

버전 관계는 같은 기본 이름과 확장자 안에서만 연결한다. 예를 들어 `idea_v1.docx`와 `idea_v2.pdf`는 서로 연결하지 않는다. 선택한 순서와 관계없이 버전 번호를 비교한다. 파일명에서 버전을 찾았다는 이유만으로 주요 변화나 Turning Point를 생성하지 않는다.

## API 연결을 위한 구조

| 파일 | 역할 |
| --- | --- |
| [services/chat.ts](../../src/services/chat.ts) | 화면에서 호출하는 API 진입 함수 |
| [mocks/Home/chatResponse.ts](../../src/mocks/Home/chatResponse.ts) | 대기 시간과 시나리오 분기를 담당하는 목 응답 함수 |
| [mocks/Home/batchAnalysis.ts](../../src/mocks/Home/batchAnalysis.ts) | 다중 파일의 분류·개수·버전 관계를 구성 |
| [types/chat.ts](../../src/types/chat.ts) | 공통 응답 타입인 `ChatReply` |
| [components/ChatReplyCard.tsx](../../src/components/ChatReplyCard.tsx) | 응답 데이터로 결과 카드를 표시 |

화면은 `getChatReply(message, files)`를 호출하고 `Promise<ChatReply>`를 기다린다. 실제 연결할 때는 `services/chat.ts`에서 목 함수 호출을 HTTP 요청으로 교체한다.

파일 전송은 서버 명세에 맞춰 `FormData`로 입력 문자열과 `File` 객체들을 담는 방식을 협의한다. API 주소·인증·요청 필드명·오류 형식은 아직 확정하지 않았다. 응답이 공통 타입과 같으면 화면의 메시지 추가와 카드 표시 코드는 유지할 수 있다.

다중 파일 응답은 `kind: "batch-analysis"`를 사용한다. `analysis.files`는 파일별 분류 및 이전 버전, `analysis.groups`는 유형별 합계, `analysis.summary`는 요약을 담는다. 공통 필드는 [텍스트 채팅 응답 문서](text-chat-response.md)를 참고한다.
