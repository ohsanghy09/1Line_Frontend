"""네트워크·DB 접근 없이 FastAPI 현재 명세를 프론트 정적 문서용으로 내보낸다."""

import json
from pathlib import Path

from app.main import app


if __name__ == "__main__":
    target = Path(__file__).resolve().parents[2] / "api-server/docs/ai-openapi.json"
    spec = app.openapi()
    spec["servers"] = [{"url": "http://127.0.0.1:8000", "description": "FastAPI AI 개발 서버"}]
    target.write_text(json.dumps(spec, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Exported FastAPI OpenAPI to api-server/docs/ai-openapi.json")
