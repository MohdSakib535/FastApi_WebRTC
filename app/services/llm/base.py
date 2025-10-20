from abc import ABC, abstractmethod
from typing import Optional, Dict, Any


class LLMProvider(ABC):
    @abstractmethod
    def summarize(self, text: str, *, system_prompt: Optional[str] = None, model: Optional[str] = None,
                  max_tokens: Optional[int] = None, temperature: Optional[float] = None,
                  extra: Optional[Dict[str, Any]] = None) -> str:
        """Return a concise summary of the provided text."""
        raise NotImplementedError

