#!/usr/bin/env python3
# /// script
# dependencies = [
#     "openwakeword",
#     "onnxruntime",
#     "numpy",
# ]
# ///
"""scripts/preflight.py — Check all 4 engines and report measured metrics."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
import wave

NOTE_PROMPT = """You convert one spoken transcript into a note. Reply with JSON only:
{"kind":"note"|"unclear","title":"3-7 words","body":"markdown bullets"}
Keep every name, number and date. body is 1-5 short bullets, no preamble.
Use "unclear" when the text is noise, under 3 meaningful words, or not worth keeping."""


def check_binaries() -> dict[str, str | None]:
    binaries = ["whisper-server", "ollama", "piper"]
    paths = {}
    print("\n" + "=" * 60)
    print(f"{'BINARY':<18} {'STATUS':<8} {'PATH'}")
    print("-" * 60)
    for b in binaries:
        p = shutil.which(b)
        paths[b] = p
        status = "OK" if p else "MISSING"
        print(f"{b:<18} {status:<8} {p or 'Not found in PATH'}")
    print("=" * 60 + "\n")
    return paths


def wait_for_url(url: str, timeout_s: float = 20.0, method: str = "GET") -> bool:
    start = time.time()
    while time.time() - start < timeout_s:
        try:
            req = urllib.request.Request(url, method=method)
            with urllib.request.urlopen(req, timeout=1.5):
                return True
        except urllib.error.HTTPError as e:
            # 405 Method Not Allowed or 400 still means server is alive and responding
            if e.code in (400, 404, 405):
                return True
        except (urllib.error.URLError, ConnectionError, OSError):
            pass
        time.sleep(0.5)
    return False


def ensure_server(
    name: str,
    check_url: str,
    start_cmd: list[str],
    timeout_s: float = 20.0
) -> bool:
    if wait_for_url(check_url, timeout_s=1.0):
        print(f"[{name}] Already running at {check_url}")
        return True

    print(f"[{name}] Not running. Starting via: {' '.join(start_cmd)}")
    try:
        subprocess.Popen(
            start_cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as e:
        print(f"[{name}] Failed to launch process: {e}", file=sys.stderr)
        return False

    print(f"[{name}] Waiting up to {timeout_s}s for readiness...")
    if wait_for_url(check_url, timeout_s=timeout_s):
        print(f"[{name}] Ready!")
        return True
    print(f"[{name}] Timed out waiting for {check_url}", file=sys.stderr)
    return False


def _encode_multipart_formdata(fields: dict, files: dict) -> tuple[bytes, str]:
    boundary = f"----PreflightBoundary{int(time.time() * 1000)}"
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
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def check_stt(url: str, audio_path: str) -> tuple[bool, str, float]:
    if not os.path.exists(audio_path):
        return False, f"File not found: {audio_path}", 0.0

    with open(audio_path, "rb") as f:
        audio_bytes = f.read()

    fields = {"language": "en", "response_format": "json", "temperature": "0"}
    files = {"file": (os.path.basename(audio_path), audio_bytes, "audio/wav")}
    body, ctype = _encode_multipart_formdata(fields, files)

    req = urllib.request.Request(url, data=body, headers={"Content-Type": ctype}, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            elapsed = time.perf_counter() - t0
            raw = resp.read().decode("utf-8")
        data = json.loads(raw)
        text = data.get("text", "").strip()
        ok = len(text) > 0
        return ok, text, elapsed
    except Exception as e:
        return False, str(e), 0.0


def check_llm(url: str, model: str, transcript: str) -> tuple[bool, str, float]:
    payload = {
        "model": model,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0, "num_ctx": 2048, "num_predict": 160},
        "messages": [
            {"role": "system", "content": NOTE_PROMPT},
            {"role": "user", "content": transcript},
        ],
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            elapsed = time.perf_counter() - t0
            raw = resp.read().decode("utf-8")
        data = json.loads(raw)
        content = data.get("message", {}).get("content", "").strip()
        parsed = json.loads(content)
        ok = "kind" in parsed and ("title" in parsed or "body" in parsed)
        return ok, content, elapsed
    except Exception as e:
        return False, str(e), 0.0


def check_tts(piper_bin: str, model_path: str, text: str = "Noted.") -> tuple[bool, str, float]:
    out_wav = "/tmp/preflight.wav"
    if os.path.exists(out_wav):
        try:
            os.remove(out_wav)
        except OSError:
            pass

    cmd = [piper_bin, "--model", model_path, "-f", out_wav]
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(
            cmd,
            input=text.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=15,
        )
        elapsed = time.perf_counter() - t0
        if proc.returncode != 0:
            return False, proc.stderr.decode("utf-8", errors="replace"), elapsed
        if not os.path.exists(out_wav) or os.path.getsize(out_wav) == 0:
            return False, "Output WAV empty or missing", elapsed
        size = os.path.getsize(out_wav)
        return True, f"{size} bytes generated", elapsed
    except Exception as e:
        return False, str(e), 0.0


def check_wake(wake_wav: str) -> tuple[bool, str, float]:
    if not os.path.exists(wake_wav):
        return False, f"File not found: {wake_wav}", 0.0

    try:
        import numpy as np
        from openwakeword.model import Model
    except ImportError as e:
        return False, f"Import error: {e}", 0.0

    models_dir = os.path.expanduser("~/models/openwakeword")
    jarvis_model = os.path.join(models_dir, "hey_jarvis_v0.1.onnx")
    melspec_model = os.path.join(models_dir, "melspectrogram.onnx")
    embedding_model = os.path.join(models_dir, "embedding_model.onnx")

    t0 = time.perf_counter()
    try:
        if os.path.exists(jarvis_model) and os.path.exists(melspec_model) and os.path.exists(embedding_model):
            oww = Model(
                wakeword_models=[jarvis_model],
                melspec_model_path=melspec_model,
                embedding_model_path=embedding_model,
                inference_framework="onnx",
            )
        else:
            oww = Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")

        with wave.open(wake_wav, "rb") as wf:
            framerate = wf.getframerate()
            raw_bytes = wf.readframes(wf.getnframes())

        audio_samples = np.frombuffer(raw_bytes, dtype=np.int16)
        chunk_size = 1280
        hits = []
        max_score = 0.0

        for idx in range(0, len(audio_samples), chunk_size):
            chunk = audio_samples[idx : idx + chunk_size]
            if len(chunk) < chunk_size:
                chunk = np.pad(chunk, (0, chunk_size - len(chunk)))
            preds = oww.predict(chunk)
            for m_name, score in preds.items():
                if score > max_score:
                    max_score = score
                if score > 0.3:
                    ts = idx / framerate
                    hits.append((ts, m_name, score))
                    print(f"    openwakeword score > 0.3: t={ts:.2f}s  {m_name}={score:.4f}")

        elapsed = time.perf_counter() - t0
        ok = len(hits) > 0
        detail = f"{len(hits)} hit(s), peak={max_score:.4f}"
        return ok, detail, elapsed
    except Exception as e:
        return False, str(e), time.perf_counter() - t0


def resolve_ollama_model(preferred_model: str) -> str:
    try:
        req = urllib.request.Request("http://127.0.0.1:11434/api/tags")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            installed = [m.get("name", "") for m in data.get("models", [])]
            for m in installed:
                if preferred_model in m:
                    return preferred_model
            # Fall back to any installed model
            if "llama3.2:3b" in " ".join(installed):
                print(f"[preflight] '{preferred_model}' not installed yet; using 'llama3.2:3b'")
                return "llama3.2:3b"
            if installed:
                chosen = installed[0]
                print(f"[preflight] '{preferred_model}' not installed yet; using '{chosen}'")
                return chosen
    except Exception:
        pass
    return preferred_model


def main() -> None:
    parser = argparse.ArgumentParser(description="Hey Scribe MVP Preflight Engine Check")
    parser.add_argument("--model", default="qwen2.5:3b-instruct", help="Ollama model name")
    parser.add_argument("--piper-model", default=os.path.expanduser("~/piper/en_US-lessac-medium.onnx"), help="Piper model ONNX path")
    parser.add_argument("--whisper-model", default=os.path.expanduser("~/models/ggml-base.en.bin"), help="Whisper model path")
    parser.add_argument("--whisper-port", default="8787", help="whisper-server port")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434/api/chat", help="Ollama chat API URL")
    parser.add_argument("--hello-wav", default=os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "hello.wav"), help="Audio fixture for STT")
    parser.add_argument("--wake-wav", default=os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "wake.wav"), help="Audio fixture for Wake Word")
    args = parser.parse_args()

    # 1. Binary checks
    bin_paths = check_binaries()

    # 2. Server checks & readiness
    whisper_server_url = f"http://127.0.0.1:{args.whisper_port}/inference"
    ollama_check_url = "http://127.0.0.1:11434/api/tags"

    whisper_cmd = [bin_paths.get("whisper-server") or "whisper-server", "-m", args.whisper_model, "--host", "127.0.0.1", "--port", args.whisper_port, "-t", "4"]
    ollama_cmd = [bin_paths.get("ollama") or "ollama", "serve"]

    whisper_ready = ensure_server("whisper-server", whisper_server_url, whisper_cmd, timeout_s=20.0)
    ollama_ready = ensure_server("ollama", ollama_check_url, ollama_cmd, timeout_s=20.0)

    # Resolve model
    active_model = resolve_ollama_model(args.model)

    results = []

    # Check 1: STT
    print("\n[1/4] Running STT Spike (whisper-server)...")
    if whisper_ready:
        stt_ok, stt_detail, stt_ms = check_stt(whisper_server_url, args.hello_wav)
        print(f"      Transcript: {stt_detail}")
        results.append(("STT (whisper)", f'"{stt_detail[:40]}..."', f"{stt_ms*1000:.1f} ms", "PASS" if stt_ok else "FAIL"))
    else:
        results.append(("STT (whisper)", "Server not ready", "N/A", "FAIL"))

    # Check 2: LLM
    print(f"\n[2/4] Running LLM Spike (Ollama: {active_model})...")
    if ollama_ready:
        test_transcript = "Design review moved to Thursday at four, Priya is presenting."
        llm_ok, llm_detail, llm_ms = check_llm(args.ollama_url, active_model, test_transcript)
        print(f"      Raw JSON: {llm_detail}")
        results.append((f"LLM ({active_model})", llm_detail.replace("\n", " ")[:40], f"{llm_ms*1000:.1f} ms", "PASS" if llm_ok else "FAIL"))
    else:
        results.append(("LLM (ollama)", "Server not ready", "N/A", "FAIL"))

    # Check 3: Piper TTS
    print(f"\n[3/4] Running TTS Spike (Piper)...")
    piper_bin = bin_paths.get("piper")
    if piper_bin and os.path.exists(args.piper_model):
        tts_ok, tts_detail, tts_s = check_tts(piper_bin, args.piper_model, "Noted.")
        print(f"      Piper output: {tts_detail}")
        results.append(("TTS (piper)", tts_detail, f"{tts_s*1000:.1f} ms", "PASS" if tts_ok else "FAIL"))
    else:
        results.append(("TTS (piper)", f"Model or binary missing", "N/A", "FAIL"))

    # Check 4: Wake Word
    print(f"\n[4/4] Running Wake Word Spike (openWakeWord 'hey_jarvis')...")
    wake_ok, wake_detail, wake_s = check_wake(args.wake_wav)
    results.append(("Wake (openWakeWord)", wake_detail, f"{wake_s*1000:.1f} ms", "PASS" if wake_ok else "FAIL"))

    # Summary table
    print("\n" + "=" * 80)
    print(f"{'ENGINE':<22} {'METRIC / DETAIL':<38} {'LATENCY':<12} {'RESULT'}")
    print("-" * 80)
    all_passed = True
    for engine, detail, latency, res in results:
        if res != "PASS":
            all_passed = False
        print(f"{engine:<22} {detail:<38} {latency:<12} {res}")
    print("=" * 80)

    if all_passed:
        print("\nALL 4 ENGINES PASSED\n")
        sys.exit(0)
    else:
        print("\nONE OR MORE ENGINES FAILED\n", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
