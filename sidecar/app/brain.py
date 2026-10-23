"""app/brain.py — LLM note formatting client using Ollama strict JSON."""

import json
import logging
import os
from typing import Optional
import httpx

logger = logging.getLogger("sidecar.brain")

DEFAULT_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_MODEL = "qwen2.5:3b-instruct"
PROMPT_PATH = os.path.join(os.path.dirname(__file__), "prompts", "note.v1.txt")


class Brain:
    """Converts spoken transcript into structured note JSON via Ollama."""

    def __init__(self, ollama_url: str = DEFAULT_URL, model: str = DEFAULT_MODEL, timeout_s: float = 30.0):
        self.url = ollama_url
        self.model = model
        self.timeout_s = timeout_s
        self.system_prompt = self._load_prompt()

    def _load_prompt(self) -> str:
        if os.path.exists(PROMPT_PATH):
            with open(PROMPT_PATH, "r", encoding="utf-8") as f:
                return f.read().strip()
        return (
            'You convert one spoken transcript into a note. Reply with JSON only:\n'
            '{"kind":"note"|"unclear","title":"3-7 words","body":"markdown bullets"}\n'
            'Keep every name, number and date. body is 1-5 short bullets, no preamble.\n'
            'Use "unclear" when the text is noise, under 3 meaningful words, or not worth keeping.'
        )

    def _validate_response(self, data: dict) -> Optional[dict]:
        if not isinstance(data, dict):
            return None

        kind = data.get("kind")
        if kind not in ("note", "unclear"):
            return None

        if kind == "unclear":
            return {"kind": "unclear", "title": "", "body": ""}

        title = data.get("title", "")
        body = data.get("body", "")

        if not isinstance(title, str) or not title.strip():
            return None

        if isinstance(body, list):
            # Join list into markdown bullet strings
            bullets = [f"- {b.strip().lstrip('-').strip()}" for b in body if str(b).strip()]
            body = "\n".join(bullets)
        elif isinstance(body, str):
            body = body.strip()
        else:
            return None

        if not body:
            return None

        return {
            "kind": "note",
            "title": title.strip(),
            "body": body,
        }

    def _call_ollama(self, text: str) -> Optional[dict]:
        payload = {
            "model": self.model,
            "stream": False,
            "format": "json",
            "keep_alive": "10m",
            "options": {
                "temperature": 0,
                "num_ctx": 2048,
                "num_predict": 160,
            },
            "messages": [
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": text},
            ],
        }

        try:
            with httpx.Client(timeout=self.timeout_s) as client:
                resp = client.post(self.url, json=payload)
                resp.raise_for_status()
                res_json = resp.json()

            content_str = res_json.get("message", {}).get("content", "").strip()
            parsed = json.loads(content_str)
            return self._validate_response(parsed)
        except Exception as e:
            logger.warning("Ollama call failed: %s", e)
            return None

    def format(self, text: str) -> Optional[dict]:
        """Convert transcript to note schema: {"kind": "note"|"unclear", "title": str, "body": str} or None."""
        clean_text = text.strip()
        if not clean_text:
            return {"kind": "unclear", "title": "", "body": ""}

        # First attempt
        result = self._call_ollama(clean_text)
        if result is not None:
            return result

        # Retry once
        logger.info("Retrying Ollama formatting once...")
        return self._call_ollama(clean_text)
