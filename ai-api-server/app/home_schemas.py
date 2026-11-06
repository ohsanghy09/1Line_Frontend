"""실제 홈 입력과 모델 출력 계약. 시스템 식별자는 서비스가 발급한다."""

from dataclasses import dataclass
from typing import Literal

from pydantic import Field

from .schemas import AnalysisContext, Identifier, StrictModel, Text, TextAnalysis


class FileDecision(StrictModel):
    id: Identifier
    materialType: Text


class HomeAnalysis(TextAnalysis):
    files: list[FileDecision] = Field(max_length=10)


class HomeModelInput(StrictModel):
    message: str
    sourceUrl: str | None = None
    linkContent: str | None = None
    context: AnalysisContext
    files: list[dict]


class LinkRequest(StrictModel):
    url: str = Field(min_length=1, max_length=4096)
    conversationId: str | None = Field(default=None, min_length=1, max_length=200)
    requestId: str | None = Field(default=None, min_length=1, max_length=200)


@dataclass(frozen=True)
class UploadedFile:
    id: str
    name: str
    mime_type: str
    content: bytes


class ProgressStep(StrictModel):
    label: str
    status: Literal["completed", "working"]


class Progress(StrictModel):
    title: str
    steps: list[ProgressStep]


class Attachment(StrictModel):
    id: str
    name: str
    size: int


class CompletedResult(StrictModel):
    analysisId: str
    conversationId: str
    message: str
    # 화면용 ChatReply는 실제 카드 변환과 백엔드 저장 검증기로 추가 검증한다.
    reply: dict
    attachments: list[Attachment]
    createdAt: str


class JobResponse(StrictModel):
    jobId: str
    status: Literal["running", "completed", "failed"]
    analysisProvider: Literal["openai"]
    progress: Progress | None = None
    pollAfterMs: int | None = None
    result: CompletedResult | None = None
    error: str | None = None
    code: str | None = None
