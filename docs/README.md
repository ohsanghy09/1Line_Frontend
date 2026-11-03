# 프로젝트 문서

개발 문서와 참고 자료를 `docs/` 아래에 모아 관리한다.

## 작업을 이어갈 때

1. [개발 규칙](개발_규칙.md)에서 작업 방식과 기준을 확인한다.
2. [개발 기록](개발_기록.md)에서 최신 구현 상태와 남은 작업을 확인한다.
3. [기능별 구현 기록](구현_기능/README.md)에서 관련 코드와 동작을 확인한다.

## 폴더 구성

```text
docs/
  README.md
  개발_규칙.md
  개발_기록.md
  구현_기능/          # 기능별 구현 내용과 검증 기록
  api/                # 화면용 응답 구조와 API 협의 사항
  references/         # 기준 HTML, 구현 가이드, 기능명세서, 캡처
```

## 참고 자료

- [화면·UI 동작 기준 HTML](references/1Line_reference.html)
- [React·TypeScript 구현 가이드](references/구현_가이드라인.md)
- [기능명세서](<references/기능명세서/개인 페이지 & 공유된 페이지/기능명세서 40363f66ceec80bdb207f2cb4e6ac0fe.md>)
- [사용자 캡처](references/screenshots/)

화면 기준 HTML은 프로젝트 루트 기준 `docs/references/1Line_reference.html`이다. 이후 사용자 요청으로 확정한 변경 사항은 해당 기록을 따른다.
