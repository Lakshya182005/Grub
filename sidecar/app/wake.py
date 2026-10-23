"""app/wake.py — Wake word detection using openWakeWord ('hey_jarvis')."""

import logging
import os
import time
import numpy as np

logger = logging.getLogger("sidecar.wake")

DEFAULT_MODEL_DIR = os.path.expanduser("~/models/openwakeword")
DEFAULT_ONNX = os.path.join(DEFAULT_MODEL_DIR, "hey_jarvis_v0.1.onnx")


class Wake:
    """Detects 'Hey Jarvis' wake phrase on incoming Int16 audio frames."""

    def __init__(self, onnx_path: str = DEFAULT_ONNX, threshold: float = 0.50, cooldown_s: float = 1.5, model_name: str = "hey_jarvis"):
        self.onnx_path = os.path.abspath(os.path.expanduser(onnx_path)) if onnx_path else DEFAULT_ONNX
        self.threshold = threshold
        self.cooldown_s = cooldown_s
        self.last_hit_time = 0.0
        self.buffer = np.zeros(0, dtype=np.int16)
        self.chunk_size = 1280  # 80 ms window for openWakeWord

        import openwakeword
        from openwakeword.model import Model

        res_dir = os.path.join(os.path.dirname(openwakeword.__file__), "resources", "models")
        have = os.path.isdir(res_dir) and any(f.endswith(".onnx") for f in os.listdir(res_dir))
        if not have:
            logger.warning("openWakeWord models missing — downloading once (needs network)")
            from openwakeword.utils import download_models
            download_models(model_names=["hey_jarvis_v0.1", "melspectrogram", "embedding_model"])

        melspec = os.path.join(DEFAULT_MODEL_DIR, "melspectrogram.onnx")
        embedding = os.path.join(DEFAULT_MODEL_DIR, "embedding_model.onnx")

        if os.path.exists(self.onnx_path) and os.path.exists(melspec) and os.path.exists(embedding):
            self.model = Model(
                wakeword_models=[self.onnx_path],
                melspec_model_path=melspec,
                embedding_model_path=embedding,
                inference_framework="onnx",
            )
        else:
            self.model = Model(
                wakeword_models=[self.onnx_path if os.path.exists(self.onnx_path) else model_name],
                inference_framework="onnx",
            )

        logger.info("Wake ready: %s", list(self.model.models.keys()))

    def feed(self, pcm: np.ndarray) -> bool:
        """Feed Int16 audio frame. Returns True if a wake phrase was detected."""
        if len(pcm) == 0:
            return False

        if pcm.dtype != np.int16:
            pcm = pcm.astype(np.int16)

        # Accumulate samples
        self.buffer = np.concatenate((self.buffer, pcm))
        hit_detected = False

        while len(self.buffer) >= self.chunk_size:
            chunk = self.buffer[: self.chunk_size]
            self.buffer = self.buffer[self.chunk_size :]

            predictions = self.model.predict(chunk)
            for model_name, score in predictions.items():
                if score >= self.threshold:
                    now = time.monotonic()
                    if now - self.last_hit_time >= self.cooldown_s:
                        self.last_hit_time = now
                        self.last_score = float(score)
                        logger.info("Wake hit detected! model=%s score=%.4f", model_name, score)
                        hit_detected = True
                        # Flush remaining buffer after a hit to prevent immediate re-trigger
                        self.buffer = np.zeros(0, dtype=np.int16)
                        break

        return hit_detected

    def reset(self) -> None:
        """Reset internal sample buffer."""
        self.buffer = np.zeros(0, dtype=np.int16)
        if hasattr(self.model, "reset"):
            self.model.reset()
