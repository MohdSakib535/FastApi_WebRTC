import os
from typing import Optional, Dict, Any

from .base import LLMProvider


class OpenAIProvider(LLMProvider):
    def __init__(self, api_key: Optional[str] = None, default_model: Optional[str] = None):
        api_key = api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not configured")
        from openai import OpenAI  # lazy import
        self.client = OpenAI(api_key=api_key)
        self.default_model = default_model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def summarize(self, text: str, *, system_prompt: Optional[str] = None, model: Optional[str] = None,
                  max_tokens: Optional[int] = None, temperature: Optional[float] = None,
                  extra: Optional[Dict[str, Any]] = None) -> str:
        sys = system_prompt or (
            "You are a helpful assistant. Summarize the conversation into clear bullets "
            "with key decisions, action items, and topics. Keep it concise."
        )
        mdl = model or self.default_model
        max_tokens = max_tokens or 512
        temperature = 0.2 if temperature is None else temperature

        resp = self.client.chat.completions.create(
            model=mdl,
            messages=[
                {"role": "system", "content": sys},
                {"role": "user", "content": text},
            ],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return resp.choices[0].message.content.strip()

