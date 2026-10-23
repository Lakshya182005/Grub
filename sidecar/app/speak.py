"""app/speak.py — Local Text-to-Speech synthesis using Piper (macOS say fallback)."""

import base64
import logging
import os
import shutil
import subprocess
import uuid
import wave

logger = logging.getLogger("sidecar.speak")

DEFAULT_MODEL = os.path.expanduser("~/piper/en_US-lessac-medium.onnx")


class Speak:
    """Synthesizes text into base64 raw PCM16 audio."""

    def __init__(self, piper_model: str = DEFAULT_MODEL):
        self.piper_model = os.path.abspath(os.path.expanduser(piper_model))
        self.piper_bin = shutil.which("piper")
        if not self.piper_bin:
            logger.warning("Piper binary not found in PATH; will use macOS say fallback")

    def _synthesize_piper(self, text: str, output_wav: str) -> bool:
        if not self.piper_bin or not os.path.exists(self.piper_model):
            return False

        cmd = [self.piper_bin, "--model", self.piper_model, "-f", output_wav]
        try:
            proc = subprocess.run(
                cmd,
                input=text.encode("utf-8"),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                timeout=10,
            )
            return proc.returncode == 0 and os.path.exists(output_wav) and os.path.getsize(output_wav) > 44
        except Exception as e:
            logger.warning("Piper synthesis error: %s", e)
            return False

    def _synthesize_macos_say(self, text: str, output_wav: str) -> bool:
        aiff_path = f"/tmp/say_{uuid.uuid4().hex}.aiff"
        try:
            # Generate AIFF via macOS say
            subprocess.run(["say", "-o", aiff_path, text], check=True, timeout=10)

            # Convert to 16 kHz mono WAV via ffmpeg
            ffmpeg_bin = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
            subprocess.run(
                [ffmpeg_bin, "-y", "-i", aiff_path, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", output_wav],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
                timeout=10,
            )
            logger.info("Used macOS 'say' fallback for speech synthesis")
            return os.path.exists(output_wav) and os.path.getsize(output_wav) > 44
        except Exception as e:
            logger.warning("macOS 'say' fallback failed: %s", e)
            return False
        finally:
            if os.path.exists(aiff_path):
                try:
                    os.remove(aiff_path)
                except OSError:
                    pass

    def say(self, text: str) -> dict | None:
        """Synthesize text. Returns {"pcm_b64": str, "rate": int} or None."""
        clean_text = text.strip()
        if not clean_text:
            return None

        temp_wav = f"/tmp/speech_{uuid.uuid4().hex}.wav"
        success = False

        try:
            # 1. Try Piper
            success = self._synthesize_piper(clean_text, temp_wav)

            # 2. Fall back to macOS say
            if not success:
                success = self._synthesize_macos_say(clean_text, temp_wav)

            if not success:
                logger.error("Failed to synthesize speech for text: '%s'", clean_text)
                return None

            # Read sample rate and PCM16 data
            with wave.open(temp_wav, "rb") as wf:
                sample_rate = wf.getframerate()
                raw_pcm = wf.readframes(wf.getnframes())

            pcm_b64 = base64.b64encode(raw_pcm).decode("ascii")
            logger.info("Synthesized '%s' -> %d PCM bytes (%d Hz)", clean_text, len(raw_pcm), sample_rate)
            return {"pcm_b64": pcm_b64, "rate": sample_rate}
        except Exception as e:
            logger.error("Unexpected error in speak.say: %s", e)
            return None
        finally:
            if os.path.exists(temp_wav):
                try:
                    os.remove(temp_wav)
                except OSError:
                    pass
