"""선택 검사: jsonschema(Draft 2020-12)로 Journey 명세·예시·거절 사례를 확인한다.

프로젝트 런타임 의존성이 아니다. python -m pip install jsonschema 후 실행할 수 있다.
"""
import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent.parent
checks = 0


def validate(document, schema_name, instance, valid=True):
    global checks
    schema = {"$ref": f"#/components/schemas/{schema_name}", "components": document["components"]}
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = list(validator.iter_errors(instance))
    assert bool(errors) != valid, (schema_name, valid, [error.message for error in errors])
    checks += 1


documents = {}
for name in ("backend", "ai"):
    doc = json.loads((ROOT / f"docs/frontend-integration/openapi/{name}.openapi.json").read_text(encoding="utf-8"))
    documents[name] = doc
    for schema_name, schema in doc["components"]["schemas"].items():
        if "Journey" in schema_name:
            Draft202012Validator.check_schema(schema)
            checks += 1
    for route, operations in doc["paths"].items():
        if "journey" not in route:
            continue
        for operation in operations.values():
            request = operation.get("requestBody", {}).get("content", {}).get("application/json")
            if request and "example" in request:
                validate(doc, "JourneyInput", request["example"])
            for response in operation["responses"].values():
                media = response.get("content", {}).get("application/json", {})
                for example in media.get("examples", {}).values():
                    validate(doc, "GrowthJourney" if name == "backend" else "JourneyResult", example["value"])

exchange = json.loads((ROOT / "docs/growth-journey-update/examples/journey-exchange.json").read_text(encoding="utf-8"))
validate(documents["ai"], "JourneyInput", exchange["request"])
validate(documents["ai"], "JourneyResult", exchange["providerResponse"])
validate(documents["backend"], "GrowthJourney", exchange["publicResponse"])

# 한 문장 비교의 허용과 필수 정보 누락·구형 형식의 거절을 독립 검증기로 확인한다.
for case in ("comparison", "transfer", "legacy", "version", "source", "role", "options", "length"):
    bad = copy.deepcopy(exchange["publicResponse"])
    event = bad["events"][0]
    if case == "comparison":
        del event["growthAssessments"][0]["comparison"]
    elif case == "transfer":
        del event["growthAssessments"][1]["transfer"]
    elif case == "legacy":
        event["type"] = "feedback"
    elif case == "version":
        bad["schemaVersion"] = "old"
    elif case == "source":
        del bad["evidenceSources"]
    elif case == "role":
        event["growthAssessments"][0]["comparison"]["beforeEvidence"] = []
    elif case == "options":
        bad["typeOptions"][1]["label"] = "자유 분류"
    else:
        event["growthAssessments"][0]["reason"] = "😀" * 501
    validate(documents["backend"], "GrowthJourney", bad, valid=False)

bad = copy.deepcopy(exchange["providerResponse"])
bad["result"]["evidenceSources"] = []
validate(documents["ai"], "JourneyResult", bad, valid=False)
bad = copy.deepcopy(exchange["request"])
del bad["criteriaVersion"]
validate(documents["ai"], "JourneyInput", bad, valid=False)
print(f"PASS: Journey JSON Schema checks {checks} (schema / examples / rejection cases)")
