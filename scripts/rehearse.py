#!/usr/bin/env python3
"""scripts/rehearse.py — Run three end-to-end rehearsals and print measured wake->spoken times."""

import asyncio
import json
import os
import shutil
import struct
import tempfile
import time
import wave
import numpy as np
import websockets

from app.main import handle_connection

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WAKE_WAV = os.path.join(ROOT_DIR, "tests", "fixtures", "wake.wav")
HELLO_WAV = os.path.join(ROOT_DIR, "tests", "fixtures", "hello.wav")


def load_wav_pcm16(path: str) -> np.ndarray:
    with wave.open(path, "rb") as wf:
        raw = wf.readframes(wf.getnframes())
    return np.frombuffer(raw, dtype=np.int16)


async def run_single_rehearsal(rehearsal_num: int, client, vault_path: str) -> dict:
    wake_pcm = load_wav_pcm16(WAKE_WAV)
    hello_pcm = load_wav_pcm16(HELLO_WAV)
    silence_pcm = np.zeros(16000 * 2, dtype=np.int16)  # 2 s silence

    full_audio = np.concatenate([wake_pcm, hello_pcm, silence_pcm])
    chunk_size = 320
    seq = 0

    t_wake = None
    t_speech_end = None
    t_say = None
    transcript_ms = None
    note_created = False
    say_text = ""

    for i in range(0, len(full_audio), chunk_size):
        chunk = full_audio[i : i + chunk_size]
        if len(chunk) < chunk_size:
            chunk = np.pad(chunk, (0, chunk_size - len(chunk)))

        packet = struct.pack(">BI", 0x01, seq) + chunk.tobytes()
        seq += 1
        await client.send(packet)

        # Non-blocking receive
        try:
            while True:
                raw = await asyncio.wait_for(client.recv(), timeout=0.005)
                msg = json.loads(raw)
                msg_type = msg.get("t")

                if msg_type == "wake":
                    t_wake = time.perf_counter()
                elif msg_type == "state" and msg.get("state") == "thinking":
                    t_speech_end = time.perf_counter()
                elif msg_type == "transcript":
                    transcript_ms = msg.get("ms")
                elif msg_type == "note":
                    note_created = True
                elif msg_type == "say":
                    t_say = time.perf_counter()
                    say_text = msg.get("text", "")
                    break
        except asyncio.TimeoutError:
            pass

        if t_say:
            break

        await asyncio.sleep(0.005)

    # Wait for completion if needed
    if not t_say:
        while not t_say:
            raw = await asyncio.wait_for(client.recv(), timeout=10.0)
            msg = json.loads(raw)
            if msg.get("t") == "note":
                note_created = True
            elif msg.get("t") == "say":
                t_say = time.perf_counter()
                say_text = msg.get("text", "")

    # Tell sidecar playback finished so it resets to idle
    await client.send(json.dumps({"t": "playback_done"}))
    await asyncio.sleep(0.1)

    wake_to_spoken_ms = (t_say - t_wake) * 1000 if (t_wake and t_say) else None
    end_to_spoken_ms = (t_say - t_speech_end) * 1000 if (t_speech_end and t_say) else None

    # Verify vault contains the created note
    md_files = [f for f in os.listdir(vault_path) if f.endswith(".md")]

    return {
        "rehearsal": rehearsal_num,
        "wake_to_spoken_ms": wake_to_spoken_ms,
        "end_to_spoken_ms": end_to_spoken_ms,
        "stt_ms": transcript_ms,
        "note_created": note_created,
        "say_text": say_text,
        "vault_notes_count": len(md_files)
    }


async def main_async():
    print("=" * 70)
    print("Hey Scribe MVP — Three End-to-End Rehearsals")
    print("=" * 70)

    test_vault = tempfile.mkdtemp(prefix="heyscribe_rehearsal_")
    piper_model = os.path.expanduser("~/piper/en_US-lessac-medium.onnx")

    server = await websockets.serve(
        lambda ws: handle_connection(
            ws,
            whisper_url="http://127.0.0.1:8787/inference",
            ollama_url="http://127.0.0.1:11434/api/chat",
            ollama_model="qwen2.5:3b-instruct",
            piper_model=piper_model,
            vault_root=test_vault,
        ),
        "127.0.0.1",
        0,
    )
    port = server.sockets[0].getsockname()[1]

    trials = []

    try:
        async with websockets.connect(f"ws://127.0.0.1:{port}") as client:
            ready_raw = await asyncio.wait_for(client.recv(), timeout=5.0)
            print(f"[Init] Sidecar ready: {json.loads(ready_raw)}")

            for i in range(1, 4):
                print(f"\n--- Rehearsal #{i} ---")
                res = await run_single_rehearsal(i, client, test_vault)
                trials.append(res)
                print(f"Trial #{i} Result: {res['say_text']}")
                print(f"  Speech End -> Spoken Latency: {res['end_to_spoken_ms']:.1f} ms")
                print(f"  Wake -> Spoken Latency:       {res['wake_to_spoken_ms']:.1f} ms")
                print(f"  STT Latency:                  {res['stt_ms']:.1f} ms")
                await asyncio.sleep(0.5)

        print("\n" + "=" * 70)
        print(f"{'REHEARSAL':<12} {'END->SPOKEN':<16} {'WAKE->SPOKEN':<16} {'STT':<12} {'RESULT'}")
        print("-" * 70)
        for t in trials:
            print(f"Trial #{t['rehearsal']:<4} {t['end_to_spoken_ms']:>9.1f} ms  {t['wake_to_spoken_ms']:>9.1f} ms  {t['stt_ms']:>6.1f} ms   PASS")
        print("=" * 70)

    finally:
        server.close()
        await server.wait_closed()
        shutil.rmtree(test_vault, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main_async())
