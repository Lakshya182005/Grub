#!/usr/bin/env python3
"""scripts/spike_stt.py — Isolated spike for whisper-server transcription."""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_URL = "http://127.0.0.1:8787/inference"
DEFAULT_AUDIO = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "hello.wav")


def _encode_multipart_formdata(fields: dict, files: dict) -> tuple[bytes, str]:
    boundary = f"----WebKitFormBoundary{int(time.time() * 1000)}"
    body = bytearray()

    for key, value in fields.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode("utf-8"))
        body.extend(f"{value}\r\n".encode("utf-8"))

    for key, (filename, filedata, content_type) in files.items():
        body.extend(f"--{boundary}\r\n".encode("utf-8"))
        body.extend(f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'.encode("utf-8"))
        body.extend(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
        body.extend(filedata)
        body.extend(b"\r\n")

    body.extend(f"--{boundary}--\r\n".encode("utf-8"))
    content_type = f"multipart/form-data; boundary={boundary}"
    return bytes(body), content_type


def run_stt_spike(url: str = DEFAULT_URL, audio_path: str = DEFAULT_AUDIO) -> tuple[str, float]:
    resolved_path = os.path.abspath(audio_path)
    if not os.path.exists(resolved_path):
        print(f"[FAIL] Audio fixture not found at {resolved_path}", file=sys.stderr)
        sys.exit(1)

    with open(resolved_path, "rb") as f:
        audio_bytes = f.read()

    fields = {
        "language": "en",
        "response_format": "json",
        "temperature": "0",
    }
    files = {
        "file": (os.path.basename(resolved_path), audio_bytes, "audio/wav")
    }

    body, content_type = _encode_multipart_formdata(fields, files)
    req = urllib.request.Request(url, data=body, headers={"Content-Type": content_type}, method="POST")

    start_time = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            elapsed_s = time.perf_counter() - start_time
            resp_body = resp.read().decode("utf-8")
    except urllib.error.URLError as e:
        print(f"[FAIL] Could not connect to whisper-server at {url}: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        data = json.loads(resp_body)
    except json.JSONDecodeError:
        print(f"[FAIL] Invalid JSON response from whisper-server:\n{resp_body}", file=sys.stderr)
        sys.exit(1)

    transcript = data.get("text", "").strip()
    latency_ms = elapsed_s * 1000.0
    print(f"[PASS] STT whisper-server: transcript=\"{transcript}\" in {elapsed_s:.3f} s ({latency_ms:.1f} ms)")
    return transcript, elapsed_s


def main() -> None:
    parser = argparse.ArgumentParser(description="Test whisper-server STT transcription")
    parser.add_argument("--url", default=DEFAULT_URL, help="whisper-server inference URL")
    parser.add_argument("--audio", default=DEFAULT_AUDIO, help="Path to WAV audio file")
    args = parser.parse_args()

    run_stt_spike(args.url, args.audio)


if __name__ == "__main__":
    main()
