# AI 서버의 백엔드 SQLite 직접 연결

작성일: 2026-11-06. 상태: 기존 DB 직접 연결·분석 문맥 조회 구현 완료. 자동 신규 활동 생성·분석 결과 저장은 후속 단계다.

## 연결 방식과 데이터 보존

백엔드 Node 서버와 Python AI 서버가 같은 로컬 SQLite 파일을 사용한다. 기본 파일은 프로젝트 루트의 `api-server/data/1line.db`다. AI 서버의 접근은 백엔드 HTTP를 경유하지 않으며 Python 표준 sqlite3 모듈을 사용한다.

기존 백엔드의 `database.js`가 DB 생성·마이그레이션을 담당한다. Python은 별도 DB·테이블·시드 데이터를 생성하지 않는다. 두 언어가 같은 모듈을 실행하는 것이 아니라 기존 스키마를 각자의 접근 코드로 사용한다.

| 설정 | AI 서버 기준 |
| --- | --- |
| AI_DB_PATH | 기본 `../api-server/data/1line.db`. 상대 경로는 터미널 위치와 무관하게 ai-api-server 기준 |
| AI_DB_TIMEOUT_SECONDS | 기본 5초, 0.1~30초. 다른 프로세스의 잠금 대기 |
| DB 초기화 | 기존 백엔드를 먼저 실행. AI 서버는 SQLite URI mode=rw로 기존 파일만 연결 |
| 외래 키 | 연결마다 PRAGMA foreign_keys=ON |
| WAL | 백엔드가 설정한 WAL을 유지하며 AI 서버가 저널 모드를 변경하지 않음 |

백엔드의 DB_PATH가 사용자 지정이라면 AI_DB_PATH도 동일한 실제 파일로 맞춘다. AI 서버는 백엔드 프로세스의 환경변수를 자동으로 읽지 않는다. 기본 경로 사용 시 기존 `.env` 수정은 필요 없다. 실제 키·모델 설정은 이번 작업에서 변경하지 않았다.

이 방식은 같은 컴퓨터의 로컬 개발을 위한 구성이다. 향후 서버를 다른 호스트로 분리할 때 DB 연결 방식도 다시 구성한다.

## 현재 읽는 데이터와 API

- `GET /api/health`: 실제 DB 연결과 필요한 스키마를 검사한다. database.status는 connected/unavailable, code는 오류 코드 또는 null이다. 서버 생존 상태와 구분한다.
- `GET /api/context`: 활동과 확정 기록을 DB에서 읽어 반환한다. OpenAI 호출·DB 쓰기 없음.
- `POST /api/analyze/text`: context 생략/null이면 DB에서 읽은 문맥을 OpenAI 분석에 사용한다. 명시한 context는 독립 개발 테스트용 요청 문맥으로 유지한다.
- `SharedDatabase.read_file(file_id)`: files에서 원본 BLOB·메타정보를 실제 ID로 읽는 내부 함수다. 파일 분석 API나 별도 원본 다운로드 라우트를 이번에 추가한 것은 아니다.

DB 기반 텍스트 요청 예시:

```json
{ "input": { "kind": "text", "message": "1호선톤 회의 내용을 정리했습니다." } }
```

문맥 조회 결과는 아래 구조다. 수치는 구조 설명용이다.

```json
{
  "context": { "activities": [], "records": [] },
  "selection": {
    "activitiesTotal": 0,
    "activitiesIncluded": 0,
    "recordsTotal": 0,
    "recordsIncluded": 0,
    "truncated": false
  }
}
```

activities는 id·name·활동 summary, records는 id·activityId·실제 입력 message·기록 분석 summary를 포함한다. 파일 BLOB·미저장 분석 초안은 문맥 목록에 넣지 않는다. `read_file`은 원본 접근 경계만 제공하며 본문 추출·모델 전달은 별도 구현이다.

DB 문맥은 활동 updated_at DESC/rowid DESC 기준 최대 50개, 그 활동에 속한 확정 기록 created_at DESC/rowid DESC 기준 최대 50개다. selection은 DB 전체 개수와 포함 개수를 구분하고 일부만 사용했다면 truncated=true다. 전체 기록을 분석했다고 간주하지 않는다. 현재 검색·관련성 기반 문맥 선택은 미구현이다.

한 읽기 트랜잭션에서 활동·기록·개수를 조회하고 연결을 닫은 뒤 OpenAI를 호출한다. SQLite 조회는 스레드에서 처리해 비동기 서버 루프를 막지 않는다. 이전의 Pydantic 문맥 크기 제한 100000자는 유지하며, 잘못된 저장 데이터나 초과 문맥을 빈 성공으로 대체하지 않는다.

분석 응답에는 contextSource(database/request), contextSelection(DB 문맥 선택 정보 또는 null)을 추가했다. DB에서 기존 활동을 읽어도 해당 요청이 새 활동이나 분석을 저장한 것은 아니므로 activityPersisted와 analysisPersisted는 계속 false다.

## 쓰기 책임과 오류

직접 연결은 읽기/쓰기 가능한 연결이며 임시 DB에서 Python INSERT가 Node에 보이는 것을 검증했다. 다만 현재 HTTP API는 조회와 분석만 제공하고, 사용자 DB에는 이번 작업으로 행을 추가·수정·삭제하지 않았다. 임의 SQL 실행 API는 제공하지 않는다.

현재 스키마 관리·기록 확정 저장·Timeline 처리는 백엔드가 유지한다. 앞으로 AI 서버에 신규 활동 생성·분석 보관을 추가하되 기록 저장과 구분하고 트랜잭션·중복 생성 규칙을 함께 구현한다.

DB 문맥 요청 오류는 HTTP 503과 `{error, code}`다.

| code | 의미 |
| --- | --- |
| database_missing | DB 파일 없음. 백엔드 실행·경로 확인 필요 |
| database_schema_mismatch | 필요한 테이블·컬럼 없음. 백엔드 마이그레이션 확인 필요 |
| database_unavailable | DB 접근·잠금·SQL 처리 실패 |
| database_context_invalid | 저장 JSON·활동/기록 관계·문맥 형식 또는 크기 오류 |

상태 확인은 동일 오류를 database.status=unavailable로 표시하면서 HTTP 200을 유지한다. DB 오류 응답에는 실제 파일 경로·SQL·기록 내용을 노출하지 않는다. 현재 사용자별 인증·권한 필터는 없으며 기존 개발 DB 전체를 대상으로 제한된 문맥을 조회한다.

## 검증 기록

- unittest 총 21개 통과. 기존 13개 + DB 검사 8개. DB 검사는 Node의 실제 openDatabase로 초기화한 임시 파일을 사용했다.
- Python이 Node 스키마의 활동·기록·원본 파일을 읽는 것과 Python 쓰기를 다른 Node 프로세스에서 조회하는 것을 확인했다.
- DB 기반 분석 문맥 주입은 OpenAI 호출을 대체한 자동 검사로 확인했다. 요청 문맥의 기존 분석 검사도 유지했다.
- 없는 DB를 자동 생성하지 않음, 다른 스키마를 변경하지 않음, 잘못된 기록을 무시하지 않음, 문맥 개수 제한·상대 경로·파일 ID 바인딩을 확인했다.
- 현재 실제 백엔드 DB는 활동 5개·확정 기록 0개였으며 상태 확인과 문맥 조회가 성공했다. 조회 전후 여섯 테이블의 행 내용 해시를 대조하여 기존 데이터 유지 확인.
- 이번 작업에서는 실제 사용자 DB 문맥을 OpenAI로 보내는 호출, 실제 DB 쓰기, 브라우저 조작·홈 연동을 수행하지 않았다. 기존 실제 OpenAI 합성 입력 검증과 구분한다.

실행·설정은 [README](../개발서버_실행안내.md), 전체 계획은 [작업 계획](작업_계획.md), 분석 계약은 [텍스트 분석 API](텍스트_분석_API.md)를 참고한다.

코드: [DB 접근](../../../ai-api-server/app/database.py), [설정](../../../ai-api-server/app/config.py), [라우트](../../../ai-api-server/app/main.py), [입출력 모델](../../../ai-api-server/app/schemas.py), [DB 검사](../../../ai-api-server/tests/test_database.py).
