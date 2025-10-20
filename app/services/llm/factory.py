from typing import Optional
from .base import LLMProvider
from app.config import settings


def get_llm_provider() -> Optional[LLMProvider]:
    provider = (settings.LLM_PROVIDER or "").lower().strip()
    if provider == "openai":
        from .openai_provider import OpenAIProvider
        return OpenAIProvider(api_key=settings.OPENAI_API_KEY, default_model=settings.OPENAI_MODEL)
    if provider in ("huggingface", "hf", "hugging_face"):
        from .hf_provider import HuggingFaceProvider
        return HuggingFaceProvider(api_key=settings.HF_API_KEY, default_model=settings.HF_MODEL)
    return None
