#!/usr/bin/env python3
"""tests/smoke_ws_e2e.py — End-to-end WebSocket smoke test for the sidecar pipeline."""

import asyncio
import io
import json
import os
import shutil
import struct
import sys
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


async def run_e2e():
    test_vault = tempfile.mkdtemp(prefix="hey_scribe_e2e_")
    piper_model = os.path.expanduser("~/piper/en_US-lessac-medium.onnx")

    print(f"Temporary test vault: {test_vault}")

    # Start sidecar in-process server
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
    ws_url = f"ws://127.0.0.1:{port}"
    print(f"Sidecar listening at {ws_url}")

    try:
        async with websockets.connect(ws_url) as client:
            # 1. Expect ready
            ready_raw = await asyncio.wait_for(client.recv(), timeout=5.0)
            ready_msg = json.loads(ready_raw)
            print(f"[1] Received ready: {ready_msg}")
            assert ready_msg.get("t") == "ready"

            # 2. Test Demo Trigger
            print("\n[2] Testing Demo Trigger...")
            t0 = time.perf_counter()
            await client.send(json.dumps({"t": "demo", "file": "hello.wav"}))

            demo_events = []
            while True:
                msg_raw = await asyncio.wait_for(client.recv(), timeout=10.0)
                msg = json.loads(msg_raw)
                demo_events.append(msg)
                print(f"  Demo event: {msg.get('t')} -> {msg}")
                if msg.get("t") == "say":
                    break

            demo_latency = (time.perf_counter() - t0) * 1000
            print(f"Demo complete in {demo_latency:.1f} ms")

            # Check demo results
            types = [e.get("t") for e in demo_events]
            assert "listening" in [e.get("state") for e in demo_events if e.get("t") == "state"]
            assert "thinking" in [e.get("state") for e in demo_events if e.get("t") == "state"]
            assert "speaking" in [e.get("state") for e in demo_events if e.get("t") == "state"]
            assert "transcript" in types
            assert "note" in types
            say_event = [e for e in demo_events if e.get("t") == "say"][0]
            assert say_event.get("text") == "Noted."
            assert say_event.get("pcm_b64") is not None

            # Verify note exists in test vault
            vault_files = os.listdir(test_vault)
            md_files = [f for f in vault_files if f.endswith(".md")]
            print(f"Vault files: {md_files}")
            assert len(md_files) == 1, f"Expected 1 note file, found {len(md_files)}"

            with open(os.path.join(test_vault, md_files[0]), "r") as f:
                content = f.read()
                print(f"Vault file content:\n{content}")
                assert "Design Review" in content or "Thursday" in content or "Priya" in content

            # Tell sidecar playback is done
            await client.send(json.dumps({"t": "playback_done"}))
            idle_raw = await asyncio.wait_for(client.recv(), timeout=2.0)
            assert json.loads(idle_raw).get("state") == "idle"

            # 3. Test Live Audio Streaming (Wake phrase -> utterance -> silence)
            print("\n[3] Testing Live Streaming: Wake -> Utterance -> Silence...")
            wake_pcm = load_wav_pcm16(WAKE_WAV)
            hello_pcm = load_wav_pcm16(HELLO_WAV)
            silence_pcm = np.zeros(16000 * 2, dtype=np.int16)  # 2 seconds silence

            full_audio = np.concatenate([wake_pcm, hello_pcm, silence_pcm])
            chunk_size = 320  # 20 ms
            seq = 0

            wake_detected = False
            listening_started = False
            note_emitted = False
            say_emitted = False

            t_wake_fired = None
            t_say_fired = None

            for i in range(0, len(full_audio), chunk_size):
                chunk = full_audio[i : i + chunk_size]
                if len(chunk) < chunk_size:
                    chunk = np.pad(chunk, (0, chunk_size - len(chunk)))

                # 0x01 | uint32 seq | 640 bytes
                packet = struct.pack(">BI", 0x01, seq) + chunk.tobytes()
                seq += 1
                await client.send(packet)

                # Check if messages arrived without blocking long
                try:
                    while True:
                        msg_raw = await asyncio.wait_for(client.recv(), timeout=0.005)
                        msg = json.loads(msg_raw)
                        print(f"  Live event: {msg.get('t')} -> {msg}")
                        if msg.get("t") == "wake":
                            wake_detected = True
                            t_wake_fired = time.perf_counter()
                        elif msg.get("t") == "state" and msg.get("state") == "listening":
                            listening_started = True
                        elif msg.get("t") == "note":
                            note_emitted = True
                        elif msg.get("t") == "say":
                            say_emitted = True
                            t_say_fired = time.perf_counter()
                            break
                except asyncio.TimeoutError:
                    pass

                if say_emitted:
                    break

                await asyncio.sleep(0.01)

            # If not yet finished, wait for say
            if not say_emitted:
                print("Waiting for completion of speech...")
                while not say_emitted:
                    msg_raw = await asyncio.wait_for(client.recv(), timeout=10.0)
                    msg = json.loads(msg_raw)
                    print(f"  Final event: {msg.get('t')} -> {msg}")
                    if msg.get("t") == "note":
                        note_emitted = True
                    elif msg.get("t") == "say":
                        say_emitted = True
                        t_say_fired = time.perf_counter()

            print(f"Wake detected: {wake_detected}")
            print(f"Listening started: {listening_started}")
            print(f"Note emitted: {note_emitted}")
            print(f"Say emitted: {say_emitted}")

            if t_wake_fired and t_say_fired:
                latency = (t_say_fired - t_wake_fired) * 1000
                print(f"Wake -> Spoken latency: {latency:.1f} ms")

            assert wake_detected, "Wake word was not detected"
            assert note_emitted, "Note was not emitted"
            assert say_emitted, "Say was not emitted"

            # 4. Test Mumble handling
            print("\n[4] Testing Mumble Utterance...")
            await client.send(json.dumps({"t": "playback_done"}))
            # Wait for idle
            while True:
                msg_raw = await asyncio.wait_for(client.recv(), timeout=2.0)
                msg = json.loads(msg_raw)
                if msg.get("t") == "state" and msg.get("state") == "idle":
                    break

            # PTT start
            await client.send(json.dumps({"t": "ptt", "on": True}))
            msg_raw = await asyncio.wait_for(client.recv(), timeout=2.0)  # state listening

            # Send 500 ms of low noise / mumble
            mumble_pcm = (np.random.randn(8000) * 100).astype(np.int16)
            for i in range(0, len(mumble_pcm), chunk_size):
                chunk = mumble_pcm[i : i + chunk_size]
                if len(chunk) < chunk_size:
                    chunk = np.pad(chunk, (0, chunk_size - len(chunk)))
                packet = struct.pack(">BI", 0x01, seq) + chunk.tobytes()
                seq += 1
                await client.send(packet)
                await asyncio.sleep(0.01)

            # PTT stop
            await client.send(json.dumps({"t": "ptt", "on": False}))

            # Expect say "I didn't catch that" and NO note
            mumble_say = None
            mumble_note = False
            while True:
                msg_raw = await asyncio.wait_for(client.recv(), timeout=10.0)
                msg = json.loads(msg_raw)
                print(f"  Mumble event: {msg.get('t')} -> {msg}")
                if msg.get("t") == "note":
                    mumble_note = True
                if msg.get("t") == "say":
                    mumble_say = msg
                    break

            assert not mumble_note, "Note must NOT be emitted for mumble"
            assert mumble_say.get("text") == "I didn't catch that. Say it again?", (
                f"Unexpected say response: {mumble_say}"
            )
            print("Mumble properly rejected with clarifying spoken prompt!")

            print("\n ALL E2E PIPELINE TESTS PASSED!")

    finally:
        server.close()
        await server.wait_closed()
        shutil.rmtree(test_vault, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(run_e2e())
