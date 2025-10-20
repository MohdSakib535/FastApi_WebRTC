import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from dotenv import load_dotenv


# Load .env once at import time (support running from any cwd)
BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))

    # STUN/TURN
    STUN_SERVER: str | None = os.getenv("STUN_SERVER")
    TURN_URL: str | None = os.getenv("TURN_URL")
    TURN_USERNAME: str | None = os.getenv("TURN_USERNAME")
    TURN_PASSWORD: str | None = os.getenv("TURN_PASSWORD")

    # Database
    DATABASE_URL: str = os.getenv("postgresql+psycopg2://postgres:admin@host.docker.internal:5432/webrtc")

    # LLM Provider selection
    LLM_PROVIDER: str | None = os.getenv("LLM_PROVIDER")
    print("LLM_PROVIDER:--------", LLM_PROVIDER)

    # OpenAI
    OPENAI_API_KEY: str | None = os.getenv("OPENAI_API_KEY")
    print("OPENAI_API_KEY:--------", OPENAI_API_KEY)

    OPENAI_MODEL: str | None = os.getenv("OPENAI_MODEL")
    print("OPENAI_MODEL:--------", OPENAI_MODEL)

    # Hugging Face
    HF_API_KEY: str | None = os.getenv("HF_API_KEY")
    HF_MODEL: str | None = os.getenv("HF_MODEL")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()

# Convenient module-level alias
settings = get_settings()
