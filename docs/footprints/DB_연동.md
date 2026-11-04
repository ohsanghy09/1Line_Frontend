# 나의 발자국 DB 연동

작성: 2026-11-04

개발용 서버를 실행하고 홈에서 분석 결과를 저장하면 나의 발자국에서 조회할 수 있다. 파일 업로드/분석 완료만으로는 아카이브에 포함되지 않는다. 서버와 프론트는 같은 `DB_PATH`를 사용하는 API에 연결해야 한다.

## 실행

기존 서버를 다시 시작해 새 조회 API와 DB 마이그레이션을 반영한다. `npm.cmd run dev`의 watch로 이미 재시작되었다면 추가 재시작은 필요 없다.

```powershell
# 프로젝트 루트에서 개발 API 실행
npm.cmd --prefix api-server run dev
```

다른 터미널에서 프로젝트 루트의 `npm.cmd run dev`로 프론트를 실행한다. 기본 Vite `/api` 프록시는 127.0.0.1:3001로 연결한다. 서버의 기본 DB는 `api-server/data/1line.db`다. 기존 파일을 삭제하거나 초기화하지 않는다.

## DB 변경

기존 `activities(id, name)`에 nullable TEXT 컬럼 category·status·role·period·summary·start_date·end_date를 없는 경우에만 추가한다. 기존 활동·기록·파일·이벤트를 보존하고 시드 INSERT는 컬럼을 명시한다. 메타정보의 예시 값을 자동 주입하지 않는다. 활동 이름만 있는 기존 5개 활동은 기본적으로 미분류/미설정과 전체 요약 없음으로 표시된다. 카드의 [활동 정보 확인·저장](../chat/api/활동_정보_응답_저장.md)에서 확인된 정보만 적용한다.

새 조회는 기존 records·analyses·files·timeline_events를 그대로 읽는다. 새 저장 테이블이나 가짜 자료를 만들지 않는다.

홈 최근 목록 연동 후속: activities에 nullable updated_at을 추가하고 기존 기록의 최신 수정 시각을 이관한다. 저장·수정·이동 때 활동 시각을 갱신하며 이동은 양쪽 활동에 반영한다. 나의 발자국과 홈이 같은 시각·자료 ID를 사용한다. [최근 활동·추가 기록](../chat/구현_기능/최근_활동_기록.md) 참고.

## 조회 API

| 메서드·경로 | 응답 |
| --- | --- |
| GET `/api/archive/activities` | q/category/status/sort 조건, `{ items, total }`. [검색 계약](검색_API.md) |
| GET `/api/archive/activities/:id` | 카드 필드 + 자료 유형별 folders + timeline |
| GET `/api/archive/activities/:id/materials/:fileId` | activityId·file·관련 events·versionHistory |
| GET `/api/home/recent` | 같은 DB의 최근 변경 활동 최대 3개·최초 저장순 자료 최대 3개 |

기존 `/api/activities`의 id/name 활동 선택과 `/records`의 activityId 저장 요청을 유지하면서 nullable 메타정보와 newActivity/activityUpdates를 추가했다. 조회용 `/activities/:id/records`, `/activities/:id/timeline`도 유지한다. 존재하지 않는 활동/자료는 404, 서버 처리 실패는 500이다. 프론트는 404만 없음으로 표시하고 연결 오류를 빈 목록으로 바꾸지 않는다.

주요 필드:

- 활동: id·title·category·status·role·period·summary·materialsCount·updatedAt(ISO 또는 null).
- 폴더: id·name·materialsCount·files. ID는 활동+분류이고 개수는 실제 배열 길이다.
- 자료: id·recordId·name·type·kind(file/text/link)·originalFileId(없으면 null)·uploadedAt·updatedAt·summary·summaryScope(record)·content·sourceUrl.
- 이벤트: id·occurredAt·title·isTurningPoint·change(before/after)·evidenceFileIds·evidenceLabels. 일반 이벤트는 description, Turning Point는 before/after/reason도 제공한다.
- 파일 원본은 DB files의 실제 ID를 유지한다. 파일 없는 텍스트/링크는 `record:기록ID`, 독립 카드 파일은 `record:기록ID:file:인덱스`다. 자료 URL에서는 반드시 encodeURIComponent를 사용한다.

홈의 오늘/어제/이전 날짜 표시는 프론트의 현재 날짜 비교로 처리한다. 활동 updatedAt과 기록 savedAt의 ISO 원본·저장값·정렬 기준은 변경하지 않는다. 상세 표기와 카드 줄바꿈 규칙은 위 홈 기능 문서를 참고한다.

분류·요약·변화가 저장되어도 현재 분석 공급자는 mock이다. 파일별 개별 요약과 ID 기반 버전 관계가 없는 경우 이를 추측하지 않는다. 이름으로 연결할 수 없는 근거는 문자열로 남긴다. 현재 저장 API는 is_turning_point를 false로 저장하며 주요 변화를 자동 전환점으로 승격하지 않는다.

## 확인 흐름

1. 홈에서 실제 텍스트·파일·링크를 입력하고 카드의 저장을 실행한다.
2. 나의 발자국에서 선택한 활동의 자료 수·상세·해당 자료의 입력 내용/요약을 확인한다.
3. 홈에서 저장된 카드의 활동/분류를 수정하고 상세에 다시 방문해 자료 이동과 폴더 변경을 확인한다.
4. 일반 홈 전송은 변화 없음 목 응답이므로 Timeline이 비어 있어도 정상이다. 변화 있는 서버 모드나 독립 예시 카드 저장을 통해 변화 흐름을 확인한다.

사용자는 2026-11-04 화면 확인을 마쳤다고 알렸으며 현재 범위에서 작업을 마무리했다. 자동 검사는 임시 DB만 사용하며 실제 사용자의 저장 기록을 수정하지 않는다. 열린 페이지의 실시간 동기화는 없고 재진입 시 다시 조회한다.
