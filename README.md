# Hey Scribe MVP
Local, private voice-to-note pipeline for macOS on Apple Silicon.

## Quick Start
Run `pnpm dev` to launch the Electron desktop shell and Python sidecar.

## Usage & Models
Say "Hey Jarvis" followed by your note. Vault saves to `~/Documents/Hey Scribe`.
Engines: openWakeWord (hey_jarvis), Whisper (base.en), Ollama (qwen2.5:3b-instruct), Piper (en_US-lessac-medium).
Config: `sidecar/app/main.py`. Demo video backup: `demo/backup.mov`.

Fallbacks: `⌥Space` (Push-to-Talk), `⌘D` (Demo Mode fixture), `Esc` (Cancel).
