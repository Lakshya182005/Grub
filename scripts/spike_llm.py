#!/usr/bin/env python3
"""scripts/spike_llm.py — Isolated spike for Ollama chat API note formatting."""

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1:11434/api/chat"
DEFAULT_MODEL = "qwen2.5:3b-instruct"
DEFAULT_TRANSCRIPT = "Design review moved to Thursday at four, Priya is presenting."

NOTE_SYSTEM_PROMPT = """You convert one spoken transcript into a note. Reply with JSON only:
{"kind":"note"|"unclear","title":"3-7 words","body":"markdown bullets"}
Keep every name, number and date. body is 1-5 short bullets, no preamble.
Use "unclear" when the text is noise, under 3 meaningful words, or not worth keeping."""


def run_llm_spike(url: str = DEFAULT_URL, model: str = DEFAULT_MODEL, transcript: str = DEFAULT_TRANSCRIPT) -> tuple[dict, float]:
    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "options": {
            "temperature": 0,
            "num_ctx": 2048,
            "num_predict": 160
        },
        "messages": [
            {"role": "system", "content": NOTE_SYSTEM_PROMPT},
            {"role": "user", "content": transcript}
        ]
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=req_data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    start_time = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            elapsed_s = time.perf_counter() - start_time
            raw_response = resp.read().decode("utf-8")
    except urllib.error.URLError as e:
        print(f"[FAIL] Could not connect to Ollama at {url}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        chat_resp = json.loads(raw_response)
    except json.JSONDecodeError:
        print(f"[FAIL] Invalid JSON response from Ollama API:\n{raw_response}", file=sys.stderr)
        sys.exit(1)

    content_str = chat_resp.get("message", {}).get("content", "").strip()
    try:
        parsed_note = json.loads(content_str)
    except json.JSONDecodeError:
        print(f"[FAIL] Ollama message content is not valid JSON:\n{content_str}", file=sys.stderr)
        sys.exit(1)

    latency_ms = elapsed_s * 1000.0
    print(f"[PASS] LLM Ollama ({model}): {content_str} in {elapsed_s:.3f} s ({latency_ms:.1f} ms)")
    return parsed_note, elapsed_s


def main() -> None:
    parser = argparse.ArgumentParser(description="Test Ollama LLM note generation")
    parser.add_argument("--url", default=DEFAULT_URL, help="Ollama chat API endpoint")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Model name (e.g. qwen2.5:3b-instruct)")
    parser.add_argument("--transcript", default=DEFAULT_TRANSCRIPT, help="Input transcript text")
    args = parser.parse_args()

    run_llm_spike(args.url, args.model, args.transcript)


if __name__ == "__main__":
    main()
