# 프로젝트 문서

개발 문서와 참고 자료를 `docs/` 아래에 모아 관리한다.

## 작업을 이어갈 때

현재 상태는 [홈 채팅 현재 구현 상태](chat/현재_구현_상태.md)에 통합했다. 구현 완료·목 데이터·실제 서버 연결·검증 한계를 구분해 읽는다.

채팅 문서는 [docs/chat](chat/README.md)에 모았다. 공통 규칙과 원본 참고 자료는 이 폴더에 유지한다.

다음 ‘나의 발자국’ 작업은 [작업 시작 안내](footprints/README.md)의 문서·코드 확인 순서로 시작한다.

1. [개발 규칙](개발_규칙.md)에서 작업 방식과 기준을 확인한다.
2. [개발 기록](chat/개발_기록.md)에서 최신 구현 상태와 남은 작업을 확인한다.
3. [기능별 구현 기록](chat/구현_기능/README.md)에서 관련 코드와 동작을 확인한다.

## 폴더 구성

```text
docs/
  README.md
  개발_규칙.md
  chat/
    README.md
    개발_기록.md
    현재_구현_상태.md
    구현_기능/        # 채팅 기능별 설명과 검증
    api/              # 채팅 API와 실제 서버 전환
  후속_화면_검토사항.md # 아직 만들지 않은 화면의 대조 메모
  footprints/
    README.md          # 나의 발자국 작업 시작 안내
  references/         # 기준 HTML, 기능명세서, 캡처
```

## 참고 자료

- [화면·UI 동작 기준 HTML](references/1Line_reference.html)
- [공통 개발 규칙](개발_규칙.md)
- [후속 화면 검토사항](후속_화면_검토사항.md)
- [기능명세서](<references/기능명세서/개인 페이지 & 공유된 페이지/기능명세서 40363f66ceec80bdb207f2cb4e6ac0fe.md>)
- 사용자 캡처는 `docs/references/screenshots/`에 추가한다. 현재 이 폴더는 없다.

화면 기준 HTML은 프로젝트 루트 기준 `docs/references/1Line_reference.html`이다. 이후 사용자 요청으로 확정한 변경 사항은 해당 기록을 따른다.
