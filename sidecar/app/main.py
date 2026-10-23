#!/usr/bin/env python3
"""sidecar/app/main.py — Complete voice-to-note orchestrator."""

import argparse
import asyncio
import collections
import io
import json
import logging
import os
import signal
import struct
import sys
import time
import urllib.parse
import wave
import numpy as np
import websockets

from app.wake import Wake
from app.endpointer import Endpointer
from app.stt import Stt
from app.brain import Brain
from app.vault import Vault
from app.speak import Speak

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("sidecar")

EXPECTED_TOKEN = os.environ.get("SIDECAR_TOKEN", "")
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


class PipelineOrchestrator:
    """Manages audio buffer, ML stages, and client state machine."""

    def __init__(self, websocket, whisper_url: str, ollama_url: str, ollama_model: str, piper_model: str, vault_root: str):
        self.ws = websocket
        self.state = "idle"  # idle | listening | thinking | speaking
        self.ring_buffer = collections.deque(maxlen=1000)  # 20 s of 20 ms frames (1000 frames)
        self.utterance_frames = []

        # Instantiate ML stages
        self.wake = Wake()
        self.endpointer = Endpointer()
        self.stt = Stt(base_url=whisper_url)
        self.brain = Brain(ollama_url=ollama_url, model=ollama_model)
        self.vault = Vault(root=vault_root)
        self.speak = Speak(piper_model=piper_model)

        self.last_seq = 0
        self.is_ptt = False
        self.processing_task: asyncio.Task | None = None

    async def emit(self, data: dict) -> None:
        try:
            await self.ws.send(json.dumps(data))
        except Exception as e:
            logger.warning("Failed to emit message: %s", e)

    async def set_state(self, new_state: str) -> None:
        if self.state != new_state:
            self.state = new_state
            logger.info("State transition -> %s", new_state)
            await self.emit({"t": "state", "state": new_state})

    async def handle_cancel(self) -> None:
        logger.info("Cancel requested.")
        if self.processing_task and not self.processing_task.done():
            self.processing_task.cancel()
            self.processing_task = None
        self.utterance_frames.clear()
        self.endpointer.reset()
        self.wake.reset()
        self.is_ptt = False
        await self.set_state("idle")

    async def on_wake_hit(self) -> None:
        logger.info("Wake word hit! Transitioning to listening.")
        await self.emit({"t": "wake"})
        await self.set_state("listening")
        self.endpointer.reset()
        self.utterance_frames.clear()

    async def process_utterance(self, audio_frames: list[np.ndarray]) -> None:
        """Execute STT -> Brain -> Vault -> Speak pipeline."""
        if not audio_frames:
            await self.set_state("idle")
            return

        await self.set_state("thinking")

        # 1. Package audio frames into WAV
        concatenated = np.concatenate(audio_frames)
        wav_buf = io.BytesIO()
        with wave.open(wav_buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(concatenated.tobytes())
        wav_bytes = wav_buf.getvalue()

        # 2. STT via whisper-server
        loop = asyncio.get_running_loop()
        stt_res = await loop.run_in_executor(None, self.stt.transcribe, wav_bytes)
        text = stt_res.get("text", "").strip()
        elapsed_ms = stt_res.get("ms", 0.0)

        await self.emit({"t": "transcript", "text": text, "ms": elapsed_ms})

        meaningful_words = [w for w in text.split() if len(w) > 2]
        is_unclear = not text or len(meaningful_words) < 3

        # 3. Brain formatting via Ollama
        brain_res = None
        if not is_unclear:
            brain_res = await loop.run_in_executor(None, self.brain.format, text)

        # 4. Routing logic
        if is_unclear or (brain_res and brain_res.get("kind") == "unclear"):
            logger.info("Utterance unclear -> spoken prompt.")
            reply_text = "I didn't catch that. Say it again?"
            speak_res = await loop.run_in_executor(None, self.speak.say, reply_text)
            await self.set_state("speaking")
            await self.emit({
                "t": "say",
                "text": reply_text,
                "pcm_b64": speak_res.get("pcm_b64") if speak_res else None,
                "rate": speak_res.get("rate") if speak_res else 22050,
            })
        elif brain_res is None and len(meaningful_words) >= 3:
            # Fallback: save raw transcript when LLM is unavailable
            logger.info("LLM unavailable, writing raw transcript note.")
            note_title = " ".join(text.split()[:5])
            note_body = f"- {text}"
            note_data = await loop.run_in_executor(None, self.vault.create, note_title, note_body)
            await self.emit({
                "t": "note",
                "id": note_data["id"],
                "title": note_data["title"],
                "path": note_data["path"],
                "body": note_data["body"],
            })
            reply_text = "Saved."
            speak_res = await loop.run_in_executor(None, self.speak.say, reply_text)
            await self.set_state("speaking")
            await self.emit({
                "t": "say",
                "text": reply_text,
                "pcm_b64": speak_res.get("pcm_b64") if speak_res else None,
                "rate": speak_res.get("rate") if speak_res else 22050,
            })
        else:
            # Note created successfully
            title = brain_res.get("title", "Untitled Note")
            body = brain_res.get("body", "")
            note_data = await loop.run_in_executor(None, self.vault.create, title, body)
            await self.emit({
                "t": "note",
                "id": note_data["id"],
                "title": note_data["title"],
                "path": note_data["path"],
                "body": note_data["body"],
            })
            reply_text = "Noted."
            speak_res = await loop.run_in_executor(None, self.speak.say, reply_text)
            await self.set_state("speaking")
            await self.emit({
                "t": "say",
                "text": reply_text,
                "pcm_b64": speak_res.get("pcm_b64") if speak_res else None,
                "rate": speak_res.get("rate") if speak_res else 22050,
            })

    async def handle_audio_frame(self, pcm: np.ndarray) -> None:
        # Push to 20 s ring buffer
        self.ring_buffer.append(pcm)

        # Wake detection (disabled when speaking)
        if self.state in ("idle", "listening") and not self.is_ptt:
            if self.wake.feed(pcm):
                await self.on_wake_hit()
                return

        # Endpointer VAD when listening
        if self.state == "listening":
            self.utterance_frames.append(pcm)
            evt = self.endpointer.feed(pcm)

            if evt == "end" and not self.is_ptt:
                # Capture pre-roll (300 ms = 15 frames)
                preroll_frames = list(self.ring_buffer)[-len(self.utterance_frames) - 15 : -len(self.utterance_frames)]
                full_utterance = preroll_frames + self.utterance_frames
                self.utterance_frames = []

                # Launch async processing
                self.processing_task = asyncio.create_task(self.process_utterance(full_utterance))

    async def run_demo(self, fixture_name: str) -> None:
        """Stream fixture WAV at real-time pace through the pipeline."""
        fixture_path = os.path.join(ROOT_DIR, "tests", "fixtures", fixture_name)
        if not os.path.exists(fixture_path):
            logger.error("Demo fixture not found: %s", fixture_path)
            return

        logger.info("Starting demo playback of %s...", fixture_path)
        with wave.open(fixture_path, "rb") as wf:
            raw_bytes = wf.readframes(wf.getnframes())

        samples = np.frombuffer(raw_bytes, dtype=np.int16)
        await self.set_state("listening")
        self.endpointer.reset()
        self.utterance_frames.clear()

        chunk_size = 320
        for i in range(0, len(samples), chunk_size):
            chunk = samples[i : i + chunk_size]
            if len(chunk) < chunk_size:
                chunk = np.pad(chunk, (0, chunk_size - len(chunk)))
            await self.handle_audio_frame(chunk)
            await asyncio.sleep(0.02)

        # Force end of utterance if still listening
        if self.state == "listening":
            full_utterance = list(self.utterance_frames)
            self.utterance_frames = []
            self.processing_task = asyncio.create_task(self.process_utterance(full_utterance))


async def handle_connection(websocket, whisper_url, ollama_url, ollama_model, piper_model, vault_root):
    # Verify token
    raw_path = getattr(websocket, "path", None)
    if raw_path is None and hasattr(websocket, "request"):
        raw_path = websocket.request.path

    query_params = {}
    if raw_path and "?" in raw_path:
        query_params = urllib.parse.parse_qs(raw_path.split("?", 1)[1])

    token = query_params.get("token", [""])[0]
    if EXPECTED_TOKEN and token != EXPECTED_TOKEN:
        logger.warning("Unauthorized connection attempt.")
        await websocket.close(4001, "Unauthorized token")
        return

    logger.info("Client connected and authorized.")
    orchestrator = PipelineOrchestrator(
        websocket, whisper_url, ollama_url, ollama_model, piper_model, vault_root
    )

    await websocket.send(
        json.dumps({
            "t": "ready",
            "model": ollama_model,
            "voice": os.path.basename(piper_model),
        })
    )

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                # Unpack binary frame: 0x01 | uint32 seq | 640 bytes PCM
                if len(message) == 645 and message[0] == 0x01:
                    _seq = struct.unpack(">I", message[1:5])[0]
                    pcm_bytes = message[5:]
                elif len(message) == 640:
                    pcm_bytes = message
                else:
                    logger.warning("Unexpected binary message size: %d", len(message))
                    continue

                pcm_array = np.frombuffer(pcm_bytes, dtype=np.int16)
                await orchestrator.handle_audio_frame(pcm_array)

            elif isinstance(message, str):
                try:
                    data = json.loads(message)
                    msg_type = data.get("t")

                    if msg_type == "cancel":
                        await orchestrator.handle_cancel()
                    elif msg_type == "playback_done":
                        if orchestrator.state == "speaking":
                            await orchestrator.set_state("idle")
                    elif msg_type == "ptt":
                        on = data.get("on", False)
                        orchestrator.is_ptt = on
                        if on:
                            await orchestrator.on_wake_hit()
                        else:
                            if orchestrator.state == "listening":
                                full_utterance = list(orchestrator.utterance_frames)
                                orchestrator.utterance_frames = []
                                orchestrator.processing_task = asyncio.create_task(
                                    orchestrator.process_utterance(full_utterance)
                                )
                    elif msg_type == "demo":
                        fixture_file = data.get("file", "hello.wav")
                        asyncio.create_task(orchestrator.run_demo(fixture_file))
                except json.JSONDecodeError:
                    logger.warning("Invalid JSON received: %s", message)

    except websockets.exceptions.ConnectionClosed:
        logger.info("Client disconnected.")
    except Exception as e:
        logger.error("Error in websocket session: %s", e)


async def main_async(port: int, token: str, whisper_url: str, ollama_url: str, ollama_model: str, piper_model: str, vault_root: str):
    global EXPECTED_TOKEN
    if token:
        EXPECTED_TOKEN = token

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop_event.set)
        except NotImplementedError:
            pass

    handler = lambda ws: handle_connection(ws, whisper_url, ollama_url, ollama_model, piper_model, vault_root)

    async with websockets.serve(handler, "127.0.0.1", port) as server:
        actual_port = port
        for s in server.sockets:
            actual_port = s.getsockname()[1]
            break

        sys.stdout.write(f'READY {{"port":{actual_port}}}\n')
        sys.stdout.flush()
        logger.info("Sidecar server listening on ws://127.0.0.1:%d", actual_port)

        await stop_event.wait()
        logger.info("Sidecar server shutdown completed.")


def main():
    parser = argparse.ArgumentParser(description="Hey Scribe voice pipeline sidecar")
    parser.add_argument("--port", type=int, default=0, help="Port to listen on (0 for dynamic)")
    parser.add_argument("--token", type=str, default="", help="Auth token")
    parser.add_argument("--whisper-url", default="http://127.0.0.1:8787/inference")
    parser.add_argument("--ollama-url", default="http://127.0.0.1:11434/api/chat")
    parser.add_argument("--ollama-model", default="qwen2.5:3b-instruct")
    parser.add_argument("--piper-model", default=os.path.expanduser("~/piper/en_US-lessac-medium.onnx"))
    parser.add_argument("--vault-root", default=os.path.expanduser("~/Documents/Hey Scribe"))
    args = parser.parse_args()

    asyncio.run(main_async(args.port, args.token, args.whisper_url, args.ollama_url, args.ollama_model, args.piper_model, args.vault_root))


if __name__ == "__main__":
    main()
