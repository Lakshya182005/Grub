#!/usr/bin/env python3
"""scripts/spike_tts.py — Isolated spike for Piper TTS synthesis."""

import argparse
import os
import shutil
import subprocess
import sys
import time

DEFAULT_MODEL = os.path.expanduser("~/piper/en_US-lessac-medium.onnx")
DEFAULT_OUTPUT = "/tmp/preflight.wav"


def run_tts_spike(model_path: str = DEFAULT_MODEL, text: str = "Noted.", output_path: str = DEFAULT_OUTPUT) -> float:
    piper_bin = shutil.which("piper")
    if not piper_bin:
        print("[FAIL] piper binary not found in PATH", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(model_path):
        print(f"[FAIL] Piper model not found at {model_path}", file=sys.stderr)
        sys.exit(1)

    if os.path.exists(output_path):
        try:
            os.remove(output_path)
        except OSError:
            pass

    cmd = [piper_bin, "--model", model_path, "-f", output_path]
    start_time = time.perf_counter()
    proc = subprocess.run(
        cmd,
        input=text.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    elapsed_s = time.perf_counter() - start_time

    if proc.returncode != 0:
        print(f"[FAIL] Piper exited with code {proc.returncode}:\n{proc.stderr.decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
        print(f"[FAIL] Output file {output_path} not found or empty", file=sys.stderr)
        sys.exit(1)

    size = os.path.getsize(output_path)
    print(f"[PASS] Piper TTS: text=\"{text}\" -> {output_path} ({size} bytes) in {elapsed_s:.3f} s ({elapsed_s * 1000:.1f} ms)")
    return elapsed_s


def main() -> None:
    parser = argparse.ArgumentParser(description="Test Piper TTS synthesis")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Path to Piper ONNX model")
    parser.add_argument("--text", default="Noted.", help="Text to synthesize")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Output WAV path")
    args = parser.parse_args()

    run_tts_spike(args.model, args.text, args.output)


if __name__ == "__main__":
    main()
