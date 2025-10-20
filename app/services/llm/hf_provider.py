import os
from typing import Optional, Dict, Any

from .base import LLMProvider


class HuggingFaceProvider(LLMProvider):
    def __init__(self, api_key: Optional[str] = None, default_model: Optional[str] = None):
        api_key = api_key or os.getenv("HF_API_KEY")
        if not api_key:
            raise RuntimeError("HF_API_KEY is not configured")
        from huggingface_hub import InferenceClient  # lazy import
        self.client = InferenceClient(token=api_key)
        # Good default summarization model; override with HF_MODEL
        self.default_model = default_model or os.getenv("HF_MODEL", "facebook/bart-large-cnn")

    def summarize(self, text: str, *, system_prompt: Optional[str] = None, model: Optional[str] = None,
                  max_tokens: Optional[int] = None, temperature: Optional[float] = None,
                  extra: Optional[Dict[str, Any]] = None) -> str:
        mdl = model or self.default_model
        # Prefer dedicated summarization for supported models; fallback to text_generation otherwise
        try:
            # Many summarization models support this high-level method
            out = self.client.summarization(text, model=mdl)
            # huggingface_hub returns dict or str depending on backend; normalize
            if isinstance(out, dict) and "summary_text" in out:
                return str(out["summary_text"]).strip()
            if isinstance(out, list) and out and isinstance(out[0], dict) and "summary_text" in out[0]:
                return str(out[0]["summary_text"]).strip()
            if isinstance(out, str):
                return out.strip()
        except Exception:
            pass

        # Fallback: prompt an instruct model via text_generation
        prompt = (
            (system_prompt + "\n\n") if system_prompt else ""
        ) + (
            "Summarize the following conversation into concise bullets with key points, decisions, and action items.\n\n"
            f"Conversation:\n{text}"
        )
        gen = self.client.text_generation(
            prompt,
            model=mdl,
            max_new_tokens=max_tokens or 512,
            temperature=0.2 if temperature is None else temperature,
            do_sample=False,
        )
        return str(gen).strip()

