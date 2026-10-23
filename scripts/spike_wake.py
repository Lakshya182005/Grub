#!/usr/bin/env python3
# /// script
# dependencies = [
#     "openwakeword",
#     "onnxruntime",
#     "numpy",
# ]
# ///
"""scripts/spike_wake.py — Isolated spike for openWakeWord 'hey_jarvis' detection."""

import argparse
import os
import sys
import wave
import numpy as np

DEFAULT_WAV = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "wake.wav")
CHUNK_SIZE = 1280  # 1280 samples = 80 ms at 16 kHz
MODELS_DIR = os.path.expanduser("~/models/openwakeword")


def load_openwakeword_model():
    from openwakeword.model import Model

    jarvis_model = os.path.join(MODELS_DIR, "hey_jarvis_v0.1.onnx")
    melspec_model = os.path.join(MODELS_DIR, "melspectrogram.onnx")
    embedding_model = os.path.join(MODELS_DIR, "embedding_model.onnx")

    if os.path.exists(jarvis_model) and os.path.exists(melspec_model) and os.path.exists(embedding_model):
        return Model(
            wakeword_models=[jarvis_model],
            melspec_model_path=melspec_model,
            embedding_model_path=embedding_model,
            inference_framework="onnx",
        )
    return Model(wakeword_models=["hey_jarvis"], inference_framework="onnx")


def run_wake_spike(wav_path: str = DEFAULT_WAV, threshold: float = 0.3) -> bool:
    resolved_wav = os.path.abspath(wav_path)
    if not os.path.exists(resolved_wav):
        print(f"[FAIL] Audio fixture not found at {resolved_wav}", file=sys.stderr)
        sys.exit(1)

    try:
        oww = load_openwakeword_model()
    except Exception as e:
        print(f"[FAIL] Failed to load openWakeWord hey_jarvis model: {e}", file=sys.stderr)
        sys.exit(1)

    with wave.open(resolved_wav, "rb") as wf:
        n_channels = wf.getnchannels()
        framerate = wf.getframerate()
        sampwidth = wf.getsampwidth()
        n_frames = wf.getnframes()
        raw_bytes = wf.readframes(n_frames)

    if framerate != 16000 or n_channels != 1 or sampwidth != 2:
        print(f"[FAIL] Expected 16 kHz 16-bit mono WAV, got {framerate}Hz, {n_channels}ch, {sampwidth*8}bit", file=sys.stderr)
        sys.exit(1)

    audio_samples = np.frombuffer(raw_bytes, dtype=np.int16)
    duration_s = len(audio_samples) / framerate
    print(f"Loaded {resolved_wav}: {len(audio_samples)} samples ({duration_s:.2f} s)")

    hits = []
    max_score = 0.0

    for idx in range(0, len(audio_samples), CHUNK_SIZE):
        chunk = audio_samples[idx : idx + CHUNK_SIZE]
        if len(chunk) < CHUNK_SIZE:
            chunk = np.pad(chunk, (0, CHUNK_SIZE - len(chunk)))

        predictions = oww.predict(chunk)
        for model_name, score in predictions.items():
            if score > max_score:
                max_score = score
            if score > threshold:
                timestamp_s = idx / framerate
                hits.append((timestamp_s, model_name, score))
                print(f"  hit: t={timestamp_s:05.2f}s  model={model_name}  score={score:.4f}")

    hit_fired = len(hits) > 0
    if hit_fired:
        print(f"[PASS] openWakeWord hey_jarvis: {len(hits)} hit(s) > {threshold} (peak: {max_score:.4f})")
    else:
        print(f"[FAIL] openWakeWord hey_jarvis: No hits > {threshold} (peak: {max_score:.4f})", file=sys.stderr)
        sys.exit(1)

    return hit_fired


def main() -> None:
    parser = argparse.ArgumentParser(description="Test openWakeWord on audio fixture")
    parser.add_argument("--wav", default=DEFAULT_WAV, help="Path to 16 kHz mono WAV")
    parser.add_argument("--threshold", type=float, default=0.3, help="Score threshold (default 0.3)")
    args = parser.parse_args()

    run_wake_spike(args.wav, args.threshold)


if __name__ == "__main__":
    main()
