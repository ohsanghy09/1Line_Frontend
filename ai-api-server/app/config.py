"""서버 환경변수와 로컬 .env 설정을 읽는다."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # 실행 위치와 관계없이 AI 서버 폴더의 .env를 사용한다. 환경변수가 우선한다.
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    openai_api_key: SecretStr | None = None
    openai_model: str | None = None
    openai_timeout_seconds: float = Field(default=45, ge=1, le=120)
    ai_cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @field_validator("openai_api_key", "openai_model", mode="before")
    @classmethod
    def empty_to_none(cls, value: object) -> object:
        # 빈 예시 설정과 공백은 설정되지 않은 상태로 처리한다.
        if isinstance(value, str):
            return value.strip() or None
        return value

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.ai_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
