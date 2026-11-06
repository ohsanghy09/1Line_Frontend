"""FastAPI 진입점. 텍스트 분석은 OpenAI를 호출하며 DB 저장은 후속 단계다."""

from typing import Literal
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .config import Settings, get_settings
from .analysis import AnalysisError, analyze_text
from .schemas import TextAnalysisRequest, TextAnalysisResponse


class OpenAIConfiguration(BaseModel):
    apiKeyConfigured: bool
    modelConfigured: bool
    # 설정 존재 여부와 실제 OpenAI 연결 성공 여부는 다르다.
    connectionStatus: Literal["not_checked"] = "not_checked"


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: Literal["ai-api-server"] = "ai-api-server"
    openai: OpenAIConfiguration


def create_app(settings: Settings | None = None) -> FastAPI:
    config = settings if settings is not None else get_settings()
    application = FastAPI(
        title="1Line AI API 개발 서버",
        version="0.2.0",
        description="OpenAI 텍스트 분석 개발 API. 활동·분석 DB 저장과 프론트 연동은 후속 구현입니다.",
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @application.get("/api/health", response_model=HealthResponse, tags=["상태"])
    def health() -> HealthResponse:
        """키를 노출하거나 모델을 호출하지 않고 서버와 설정 상태만 확인한다."""
        return HealthResponse(openai=OpenAIConfiguration(
            apiKeyConfigured=bool(config.openai_api_key),
            modelConfigured=bool(config.openai_model),
        ))

    @application.exception_handler(AnalysisError)
    async def analysis_error_handler(_request, error: AnalysisError):
        return JSONResponse(status_code=error.status_code,
                            content={"error": error.message, "code": error.code})

    @application.post("/api/analyze/text", response_model=TextAnalysisResponse, tags=["분석"],
                      responses={422: {"description": "입력 검증 실패 또는 분석 거절"},
                                 429: {"description": "OpenAI 사용 한도·요청 제한"},
                                 502: {"description": "OpenAI 요청·응답 검증 실패"},
                                 503: {"description": "키·모델 미설정"},
                                 504: {"description": "분석 시간 초과"}})
    async def text_analysis(payload: TextAnalysisRequest) -> TextAnalysisResponse:
        """텍스트 분석만 수행한다. 활동 생성·기록 저장·analysisId 발급은 아직 하지 않는다."""
        analysis = await analyze_text(payload, config)
        return TextAnalysisResponse(requestId=str(uuid4()), model=config.openai_model, analysis=analysis)

    return application


app = create_app()
