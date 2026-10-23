"""app/endpointer.py — Energy-based Voice Activity Detection with adaptive noise floor."""

import collections
import logging
import math
from typing import Deque, Literal, Optional
import numpy as np

logger = logging.getLogger("sidecar.endpointer")


class Endpointer:
    """Detects start and end of speech based on adaptive energy thresholds."""

    def __init__(
        self,
        frame_ms: float = 20.0,
        rolling_window_s: float = 2.0,
        start_ratio: float = 3.0,
        end_ratio: float = 1.8,
        min_speech_ms: float = 400.0,
        end_silence_ms: float = 700.0,
        hard_cap_s: float = 20.0,
    ):
        self.frame_ms = frame_ms
        self.start_ratio = start_ratio
        self.end_ratio = end_ratio
        self.min_speech_frames = int(min_speech_ms / frame_ms)
        self.end_silence_frames = int(end_silence_ms / frame_ms)
        self.hard_cap_frames = int((hard_cap_s * 1000.0) / frame_ms)
        self.rolling_len = int((rolling_window_s * 1000.0) / frame_ms)

        self.energy_history: Deque[float] = collections.deque(maxlen=self.rolling_len)
        self.is_speaking = False
        self.speech_frames = 0
        self.silence_frames = 0
        self.total_utterance_frames = 0

    def feed(self, pcm: np.ndarray) -> Optional[Literal["start", "end"]]:
        """Feed one 20 ms PCM frame (320 samples). Returns 'start', 'end', or None."""
        if len(pcm) == 0:
            return None

        # Compute Root Mean Square (RMS) energy
        float_samples = pcm.astype(np.float32)
        mean_sq = float(np.mean(float_samples ** 2))
        rms = math.sqrt(mean_sq) if mean_sq > 0 else 0.0

        # Update noise floor (rolling 2 s minimum)
        self.energy_history.append(rms)
        noise_floor = max(50.0, min(self.energy_history))

        start_threshold = noise_floor * self.start_ratio
        end_threshold = noise_floor * self.end_ratio

        if not self.is_speaking:
            if rms > start_threshold:
                self.is_speaking = True
                self.speech_frames = 1
                self.silence_frames = 0
                self.total_utterance_frames = 1
                logger.info("Speech start detected: rms=%.1f floor=%.1f thold=%.1f", rms, noise_floor, start_threshold)
                return "start"
            return None
        else:
            self.total_utterance_frames += 1
            if rms < end_threshold:
                self.silence_frames += 1
            else:
                self.silence_frames = 0
                self.speech_frames += 1

            # Hard cap reached (20 s)
            if self.total_utterance_frames >= self.hard_cap_frames:
                logger.info("Speech end reached: hit 20s hard cap (%d frames)", self.total_utterance_frames)
                self.is_speaking = False
                return "end"

            # Trailing silence reached after minimum speech duration
            if self.speech_frames >= self.min_speech_frames and self.silence_frames >= self.end_silence_frames:
                logger.info(
                    "Speech end detected: %d speech frames, %d trailing silence frames",
                    self.speech_frames,
                    self.silence_frames,
                )
                self.is_speaking = False
                return "end"

            return None

    def reset(self) -> None:
        """Reset detection state."""
        self.is_speaking = False
        self.speech_frames = 0
        self.silence_frames = 0
        self.total_utterance_frames = 0
