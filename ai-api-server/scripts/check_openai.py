"""수동 실행 전용: 합성 입력으로 실제 OpenAI 호출 1회를 검증한다(사용료 발생 가능)."""

import json

from fastapi.testclient import TestClient

from app.main import app


def main() -> int:
    # 실제 사용자 기록·DB를 전송하지 않고 개발 API 경계 전체를 확인한다.
    with TestClient(app) as client:
        response = client.post("/api/analyze/text", json={
            "input": {"kind": "text", "message": "1호선톤 회의록을 정리했습니다. 별도의 기획 변경은 없었습니다."},
            "context": {"activities": [{"id": "synthetic-activity-1", "name": "1호선톤"}], "records": []},
        })
    if response.status_code != 200:
        print(json.dumps({"status": response.status_code, **response.json()}, ensure_ascii=False))
        return 1
    data = response.json()
    analysis = data["analysis"]
    assert data["analysisProvider"] == "openai"
    assert not data["activityPersisted"] and not data["analysisPersisted"]
    assert analysis["activity"]["match"] == "existing"
    assert analysis["activity"]["id"] == "synthetic-activity-1"
    assert analysis["changes"] == []
    print(json.dumps({"status": "PASS", "model": data["model"],
                      "activityMatch": analysis["activity"]["match"],
                      "changes": len(analysis["changes"]), "persisted": False}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
