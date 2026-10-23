#!/usr/bin/env python3
"""sidecar/app/main.py — WebSocket server stub for live audio frames."""

import argparse
import asyncio
import json
import logging
import os
import signal
import sys
import urllib.parse
import websockets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("sidecar")

EXPECTED_TOKEN = os.environ.get("SIDECAR_TOKEN", "")
FRAME_SAMPLE_COUNT = 320  # 320 Int16 samples = 640 bytes per frame


async def handle_connection(websocket):
    # Retrieve query token
    raw_path = getattr(websocket, "path", None)
    if raw_path is None and hasattr(websocket, "request"):
        raw_path = websocket.request.path

    query_params = {}
    if raw_path and "?" in raw_path:
        query_str = raw_path.split("?", 1)[1]
        query_params = urllib.parse.parse_qs(query_str)

    token = query_params.get("token", [""])[0]
    if EXPECTED_TOKEN and token != EXPECTED_TOKEN:
        logger.warning("Unauthorized connection attempt with token: %s", token)
        await websocket.close(4001, "Unauthorized token")
        return

    logger.info("Client connected and authorized.")

    # Handshake ready response
    await websocket.send(
        json.dumps({
            "t": "ready",
            "model": "qwen2.5:3b-instruct",
            "voice": "en_US-lessac-medium",
        })
    )

    frame_count = 0
    t0 = asyncio.get_running_loop().time()

    try:
        async for message in websocket:
            if isinstance(message, bytes):
                frame_count += 1
                if frame_count % 50 == 0:
                    now = asyncio.get_running_loop().time()
                    elapsed = now - t0
                    fps = 50.0 / elapsed if elapsed > 0 else 0.0
                    logger.info("Received %d frames (~%.1f fps, frame_size=%d bytes)", frame_count, fps, len(message))
                    t0 = now
            elif isinstance(message, str):
                try:
                    data = json.loads(message)
                    msg_type = data.get("t")
                    if msg_type == "ptt":
                        ptt_state = data.get("on", False)
                        logger.info("Push-to-talk event: on=%s", ptt_state)
                        await websocket.send(
                            json.dumps({
                                "t": "state",
                                "state": "listening" if ptt_state else "idle",
                            })
                        )
                    else:
                        logger.debug("Received message: %s", data)
                except json.JSONDecodeError:
                    logger.warning("Received invalid JSON message: %s", message)
    except websockets.exceptions.ConnectionClosed as e:
        logger.info("Connection closed: code=%s, reason=%s", e.code, e.reason)
    except Exception as e:
        logger.error("Error handling websocket connection: %s", e)


async def main_async(port: int, token: str):
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

    async with websockets.serve(handle_connection, "127.0.0.1", port) as server:
        # Determine bound port
        actual_port = port
        for s in server.sockets:
            actual_port = s.getsockname()[1]
            break

        # Emit READY handshake to stdout as required by main process
        sys.stdout.write(f'READY {{"port":{actual_port}}}\n')
        sys.stdout.flush()
        logger.info("Sidecar server listening on ws://127.0.0.1:%d", actual_port)

        await stop_event.wait()
        logger.info("Shutting down sidecar server...")


def main():
    parser = argparse.ArgumentParser(description="Hey Scribe sidecar WebSocket server")
    parser.add_argument("--port", type=int, default=0, help="Port to listen on (default: 0 for random)")
    parser.add_argument("--token", type=str, default="", help="Auth token for WebSocket connection")
    args = parser.parse_args()

    asyncio.run(main_async(args.port, args.token))


if __name__ == "__main__":
    main()
