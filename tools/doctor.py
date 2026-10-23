#!/usr/bin/env python3
"""tools/doctor.py — Comprehensive diagnostic check of all 4 engines and dependencies."""

import os
import sys
import time
import wave
import httpx
import numpy as np

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT_DIR, "sidecar"))

WAKE_WAV = os.path.join(ROOT_DIR, "tests", "fixtures", "wake.wav")
HELLO_WAV = os.path.join(ROOT_DIR, "tests", "fixtures", "hello.wav")


def check_whisper() -> tuple[bool, str]:
    url = "http://127.0.0.1:8787/inference"
    if not os.path.exists(HELLO_WAV):
        return False, f"Missing fixture {HELLO_WAV}"
    try:
        with open(HELLO_WAV, "rb") as f:
            wav_bytes = f.read()
        t0 = time.perf_counter()
        resp = httpx.post(
            url,
            data={"language": "en", "temperature": "0", "response_format": "json"},
            files={"file": ("hello.wav", wav_bytes, "audio/wav")},
            timeout=10.0,
        )
        ms = (time.perf_counter() - t0) * 1000
        if resp.status_code == 200:
            txt = resp.json().get("text", "").strip()
            return True, f"PASS ({ms:.0f} ms) — text: '{txt[:40]}...'"
        return False, f"FAIL HTTP {resp.status_code}"
    except Exception as e:
        return False, f"FAIL ({e})"


def check_ollama() -> tuple[bool, str]:
    url = "http://127.0.0.1:11434/api/chat"
    model = "qwen2.5:3b-instruct"
    try:
        t0 = time.perf_counter()
        payload = {
            "model": model,
            "stream": False,
            "format": "json",
            "messages": [{"role": "user", "content": "Respond with JSON: {\"status\": \"ok\"}"}],
        }
        resp = httpx.post(url, json=payload, timeout=10.0)
        ms = (time.perf_counter() - t0) * 1000
        if resp.status_code == 200:
            return True, f"PASS ({ms:.0f} ms) — model {model}"
        return False, f"FAIL HTTP {resp.status_code}"
    except Exception as e:
        return False, f"FAIL ({e})"


def check_tts() -> tuple[bool, str]:
    from app.speak import Speak
    try:
        t0 = time.perf_counter()
        spk = Speak()
        res = spk.say("Noted.")
        ms = (time.perf_counter() - t0) * 1000
        if res and res.get("pcm_b64"):
            engine_name = "piper" if spk.piper_bin and os.path.exists(spk.piper_model) else "macos say"
            return True, f"PASS ({ms:.0f} ms) — engine: {engine_name}, rate: {res.get('rate')}"
        return False, "FAIL — no PCM produced"
    except Exception as e:
        return False, f"FAIL ({e})"


def check_wake() -> tuple[bool, str]:
    from app.wake import Wake
    if not os.path.exists(WAKE_WAV):
        return False, f"Missing fixture {WAKE_WAV}"
    try:
        t0 = time.perf_counter()
        wake = Wake(threshold=0.40)
        with wave.open(WAKE_WAV, "rb") as wf:
            raw = wf.readframes(wf.getnframes())
        samples = np.frombuffer(raw, dtype=np.int16)

        chunk_size = 1280
        max_score = 0.0
        hit = False

        for i in range(0, len(samples), chunk_size):
            chunk = samples[i : i + chunk_size]
            if len(chunk) < chunk_size:
                chunk = np.pad(chunk, (0, chunk_size - len(chunk)))
            preds = wake.model.predict(chunk)
            for _, score in preds.items():
                if score > max_score:
                    max_score = score
                if score >= wake.threshold:
                    hit = True

        ms = (time.perf_counter() - t0) * 1000
        if hit or max_score >= 0.40:
            return True, f"PASS ({ms:.0f} ms) — peak score: {max_score:.3f}"
        return False, f"FAIL — peak score only {max_score:.3f}"
    except Exception as e:
        return False, f"FAIL ({e})"


def main():
    print("=" * 60)
    print("Grub Doctor — Engine Diagnostics")
    print("=" * 60)

    checks = [
        ("Whisper STT", check_whisper),
        ("Ollama Brain", check_ollama),
        ("TTS (Piper/Say)", check_tts),
        ("Wake: openWakeWord", check_wake),
    ]

    all_passed = True
    for name, check_fn in checks:
        passed, msg = check_fn()
        status_tag = "[PASS]" if passed else "[FAIL]"
        print(f"{name:<24} {status_tag} {msg}")
        if not passed:
            all_passed = False

    print("=" * 60)
    if all_passed:
        print("All engines healthy! System is ready.")
        sys.exit(0)
    else:
        print("Some engine checks failed. Review diagnostics above.")
        sys.exit(1)


if __name__ == "__main__":
    main()
