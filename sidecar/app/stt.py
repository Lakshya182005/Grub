"""app/stt.py — Whisper server transcription client."""

import logging
import time
import httpx

logger = logging.getLogger("sidecar.stt")

DEFAULT_URL = "http://127.0.0.1:8787/inference"


class Stt:
    """Sends audio WAV bytes to whisper-server and returns text and latency."""

    def __init__(self, base_url: str = DEFAULT_URL, timeout_s: float = 15.0):
        self.url = base_url
        self.timeout_s = timeout_s

    def transcribe(self, wav_bytes: bytes) -> dict:
        """Transcribe 16 kHz 16-bit mono WAV. Returns {"text": str, "ms": float, "logprob": float}."""
        if len(wav_bytes) == 0:
            return {"text": "", "ms": 0.0, "logprob": -99.0}

        files = {"file": ("audio.wav", wav_bytes, "audio/wav")}
        data = {
            "language": "en",
            "temperature": "0",
            "response_format": "verbose_json",
        }

        t0 = time.perf_counter()
        try:
            with httpx.Client(timeout=self.timeout_s) as client:
                resp = client.post(self.url, data=data, files=files)
                resp.raise_for_status()
                payload = resp.json()

            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            text = payload.get("text", "").strip()

            # Extract average logprob if available
            avg_logprob = 0.0
            segments = payload.get("segments", [])
            if segments:
                logprobs = [s.get("avg_logprob", 0.0) for s in segments if "avg_logprob" in s]
                if logprobs:
                    avg_logprob = sum(logprobs) / len(logprobs)

            # If logprob is too low, treat as unclear
            if avg_logprob < -1.2 and segments:
                logger.warning("Low confidence transcript (logprob=%.2f < -1.2): '%s'", avg_logprob, text)
                text = ""

            logger.info("Transcribed (%0.1f ms): '%s'", elapsed_ms, text)
            return {"text": text, "ms": elapsed_ms, "logprob": avg_logprob}
        except Exception as e:
            elapsed_ms = (time.perf_counter() - t0) * 1000.0
            logger.error("STT transcription failed after %.1f ms: %s", elapsed_ms, e)
            return {"text": "", "ms": elapsed_ms, "logprob": -99.0}
