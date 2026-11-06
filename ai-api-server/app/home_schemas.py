"""실제 홈 입력과 모델 출력 계약. 시스템 식별자는 서비스가 발급한다."""

from dataclasses import dataclass
from typing import Literal

from pydantic import Field, model_validator

from .schemas import ActivityDecision, AnalysisContext, Identifier, StrictModel, Text, TextAnalysis


class FileDecision(StrictModel):
    id: Identifier
    materialType: Text


class HomeActivityDecision(ActivityDecision):
    # 활동 종류는 자료 유형과 별개이며, 판단 근거가 없으면 null이다.
    category: Identifier | None = None

    @model_validator(mode="after")
    def validate_category(self):
        if self.category in {"all", "전체"}:
            raise ValueError("전체는 활동 유형으로 사용할 수 없습니다.")
        if self.match == "unresolved" and self.category is not None:
            raise ValueError("미확정 활동은 유형을 지정할 수 없습니다.")
        return self


class HomeAnalysis(TextAnalysis):
    activity: HomeActivityDecision
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
