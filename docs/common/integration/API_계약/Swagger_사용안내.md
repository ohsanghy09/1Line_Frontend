# API 문서 확인 안내 — Swagger 화면 제공 종료

2026-11-14 프론트의 Swagger 화면과 handoff HTML 제공 기능을 제거했습니다. 개발·빌드 시 정적 문서를 생성하지 않으며, 이 변경을 배포하면 `/swagger`와 하위 경로는 404로 응답합니다. 배포 전 기존 운영 화면은 그대로 남아 있을 수 있습니다.

## 유지되는 자료

- [백엔드 OpenAPI](../../../frontend-integration/openapi/backend.openapi.json)
- [AI OpenAPI](../../../frontend-integration/openapi/ai.openapi.json)
- [서버 간 데이터 전달 계약](../../../common/handoff/서버간_데이터_전달_계약.md)
- [인계 문서 목록](../../../common/handoff/README.md)

명세 JSON과 원본 마크다운은 저장소에서 확인합니다. OpenAPI 계약·Journey 예시 검사는 유지합니다. 프론트의 API 요청 경로와 앱 기능은 변경하지 않습니다.

## 실행 명령

`npm run dev`는 앱 개발 서버를, `npm run build`는 TypeScript 검사와 Vite 빌드를 실행합니다. `docs:build`와 Swagger 자동 생성 훅은 제거했습니다.

이 문서의 과거 Swagger 사용 절차는 더 이상 현재 실행 안내가 아닙니다. 별도 Swagger 화면이 필요하면 각 서버 담당자와 제공 위치를 협의합니다.
