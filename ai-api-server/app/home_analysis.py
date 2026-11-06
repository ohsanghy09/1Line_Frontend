"""실제 파일 내용·웹 본문을 포함한 홈 분석과 카드 변환."""

import base64
from collections import Counter
from pathlib import Path

from .analysis import AnalysisError, structured_response
from .home_schemas import HomeAnalysis, HomeModelInput

PROMPT_PATH = Path(__file__).parent / "prompts/home.md"
SUPPORTED_FILES = {".txt", ".md", ".json", ".csv", ".tsv", ".html", ".xml", ".py", ".js", ".ts",
                   ".pdf", ".doc", ".docx", ".rtf", ".odt", ".ppt", ".pptx", ".xls", ".xlsx",
                   ".png", ".jpg", ".jpeg", ".webp", ".gif"}
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}
TEXT_FILES = {".txt", ".md", ".json", ".csv", ".tsv", ".html", ".xml", ".py", ".js", ".ts"}


def validate_files(files):
    if len(files) > 10 or sum(len(file.content) for file in files) > 25 * 1024 * 1024:
        raise AnalysisError(400, "files_too_large", "파일은 최대 10개, 전체 25MiB까지 전송해 주세요.")
    for file in files:
        if len(file.content) > 10 * 1024 * 1024 or not file.content:
            raise AnalysisError(400, "invalid_file", "파일은 비어 있지 않아야 하고 각각 10MiB 이하여야 해요.")
        if Path(file.name).suffix.lower() not in SUPPORTED_FILES:
            raise AnalysisError(415, "unsupported_file", "지원하지 않는 파일 형식이에요. 문서·텍스트·PDF·이미지로 전송해 주세요.")


async def analyze_home(*, message, files, source_url, link_content, context, config):
    validate_files(files)
    metadata = [{"id": file.id, "name": file.name} for file in files]
    payload = HomeModelInput(message=message, files=metadata, sourceUrl=source_url,
                             linkContent=link_content, context=context)
    parts = [{"type": "input_text", "text": payload.model_dump_json()}]
    text_sources = [message, link_content or ""]
    for file in files:
        suffix = Path(file.name).suffix.lower()
        if suffix in TEXT_FILES:
            try:
                text = file.content.decode("utf-8-sig")
            except UnicodeDecodeError:
                raise AnalysisError(415, "file_encoding", "텍스트 파일은 UTF-8 인코딩으로 저장해 주세요.") from None
            if len(text) > 100_000:
                raise AnalysisError(400, "file_text_too_large", "텍스트 파일 본문은 100000자 이내로 전송해 주세요.")
            parts.append({"type": "input_text", "text": f"file:{file.id}\n파일명: {file.name}\n본문:\n{text}"})
            text_sources.append(text)
        else:
            encoded = base64.b64encode(file.content).decode("ascii")
            parts.append({"type": "input_text", "text": f"다음 첨부는 file:{file.id}, 파일명: {file.name}"})
            if suffix in IMAGE_TYPES:
                parts.append({"type": "input_image", "image_url": f"data:{IMAGE_TYPES[suffix]};base64,{encoded}"})
            else:
                parts.append({"type": "input_file", "filename": file.name,
                              "file_data": f"data:{file.mime_type};base64,{encoded}"})
    result = await structured_response(config, instructions=PROMPT_PATH.read_text(encoding="utf-8"),
                                       input=[{"role": "user", "content": parts}], schema=HomeAnalysis)
    activities = {activity.id: activity for activity in context.activities}
    decision = result.activity
    if decision.match == "existing":
        if decision.id not in activities:
            raise AnalysisError(502, "invalid_analysis", "분석 결과의 활동 ID가 실제 문맥과 일치하지 않아요.")
        decision.name = activities[decision.id].name
        for record in context.records:
            if record.activityId == decision.id:
                text_sources.extend(value for value in [record.message, record.summary] if value)
    elif decision.id is not None:
        raise AnalysisError(502, "invalid_analysis", "신규 활동에 잘못된 ID가 반환됐어요.")
    expected = {file.id for file in files}
    if len(result.files) != len(expected) or {file.id for file in result.files} != expected:
        raise AnalysisError(502, "invalid_analysis", "분석 결과의 파일 목록이 실제 첨부와 다릅니다.")
    for change in result.changes:
        for quote in change.evidence:
            if quote.startswith("file:") and quote[5:] in expected:
                continue
            if not any(quote in source for source in text_sources):
                raise AnalysisError(502, "invalid_analysis", "분석 근거가 실제 입력·자료와 일치하지 않아요.")
    return result


def build_reply(result, files, source_url, reply_id):
    types = {file.id: file.materialType for file in result.files}
    names = {f"file:{file.id}": file.name for file in files}
    changes = [change.model_dump() for change in result.changes]
    for change in changes:
        change["evidence"] = [names.get(value, value) for value in change["evidence"]]
    kind = ("link-analysis" if source_url else "batch-analysis" if len(files) > 1
            else "file-analysis" if files and changes else "no-change" if files else "text-analysis")
    counts = Counter(types.values())
    reply = {"id": reply_id, "role": "assistant", "kind": kind, "content": result.summary,
             "analysis": {"activity": result.activity.model_dump(), "materialType": result.materialType,
                          "stage": result.stage, "summary": result.summary, "changes": changes,
                          "files": [{"name": file.name, "materialType": types[file.id], "previousVersion": None} for file in files],
                          "groups": [{"materialType": key, "count": value} for key, value in counts.items()],
                          "suggestedSaveMode": "record-change" if changes else "archive"}}
    if source_url:
        reply["sourceUrl"] = source_url
    if files and not changes:
        reply["analysis"]["noChangeMessage"] = "이 자료에서 중요한 변화는 확인되지 않았어요."
    return reply
