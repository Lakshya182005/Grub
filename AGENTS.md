# AGENTS.md — Hey Scribe MVP (demo build)

**Goal: one flawless loop — wake phrase → note card → spoken “Noted.” — on an 8 GB Mac, by tomorrow.**
Read `00-MVP-PLAN.md` and `01-MVP-PROMPTS.md` before any task. This build is a demo, not a product.

## The loop is the whole product
`mic → wake → endpointer → whisper → one LLM call → one .md file → Piper → renderer`

If a change does not make that loop work, look better, or fail more gracefully **today**, it is out of scope.

## Hard rules
1. **No new dependencies.** The entire allowlist is: `electron`, `electron-vite`, `react`, `react-dom`,
   `typescript`, `tailwindcss`, `zod` (config only) · Python: `websockets`, `numpy`, `httpx`,
   `onnxruntime`, `openwakeword` · system binaries: `whisper-server`, `ollama`, `piper`. Anything else
   requires a written justification in the PR and a licence check.
2. **No runtime network.** Localhost only (`127.0.0.1`): whisper-server, Ollama, the sidecar socket.
   No telemetry, no fonts from a CDN, no remote images. Everything bundled so it works with Wi-Fi off.
3. **Microphone lives in the renderer** (`getUserMedia` + AudioWorklet). The sidecar never opens an
   audio device. Audio reaches Python only as PCM over the local WebSocket.
4. **One stage, one file.** `wake.py`, `endpointer.py`, `stt.py`, `brain.py`, `vault.py`, `speak.py`
   each expose one class with one public method. `main.py` orchestrates and contains no feature logic.
5. **The pipeline freezes at end of Prompt 2.** After that, only the renderer, assets and scripts may
   change. If polish "requires" touching the pipeline, it doesn't.
6. **Only `vault.py` writes to disk.** Atomic temp+rename, snapshot before overwrite, filenames
   sanitised, path resolved and confined to the vault root.
7. **No half-features in the UI.** No disabled buttons, no empty tabs, no "coming soon", no fake data.
   If it isn't working, it isn't visible.
8. **Measure, don't claim.** Report real numbers (wake→spoken latency, frames/second, RAM) obtained by
   running the code. Never estimate a latency you did not observe.

## Scope guards
- Out of scope until after the demo: agent tools, search/FTS, meeting & dictation modes, settings UI,
  onboarding, model manager, custom wake model, signing/notarization/DMG, auto-update, multi-language,
  streaming partial transcripts, LLM-phrased replies (fixed strings only).
- Cut features must leave a **named seam** (see plan §2), never a stub wired into the UI.

## Stack facts (don't rediscover these)
- macOS 14+, Apple Silicon, **8 GB RAM target.** Whisper `base.en`; LLM ≤ 3B Q4; `num_ctx 2048`;
  `keep_alive 10m`; whisper unloads after 5 min idle.
- `whisper-server` = `POST /inference`, multipart, `language=en`, `temperature=0`, `response_format=json`.
- Ollama = `POST /api/chat`, `stream:false`, `format:"json"`, `options{temperature:0,num_ctx,num_predict}`.
- Piper = one subprocess call, writes a WAV; strip the 44-byte header for raw PCM16.
- If Ollama is missing/slow, the app must still write the note and say “Saved.” — never block the demo path.
- If Piper is missing, fall back to macOS `say` inside `speak.py` only.

## Code style
- TypeScript strict, no `any`, no non-null assertions. Python 3.12, type hints, `ruff`-clean.
- Events are the renderer contract: `state`, `transcript`, `note`, `say`, `error`. UI reacts, never infers.
- Errors are one of `mic_denied`, `wake_failed`, `stt_unavailable`, `llm_unavailable`, `write_failed`,
  `internal` — each with a visible, non-technical message.
- No `print` in Python (use logging); no `console.log` left in the renderer at the end.
- Files kebab-case, components PascalCase, <= 250 lines per file. Prefer deleting code to abstracting it.

## Definition of done
`pnpm typecheck && pnpm lint` clean · the pipeline measured under 2.5 s wake→spoken · a mumble produces
no file · `scripts/preflight.py` all green · app works with Wi-Fi off · three clean rehearsals.

## When unsure
Choose the smaller, more boring option and cut the feature. Ask one specific question and stop.
Never invent an API. Never let a model do what 10 lines of deterministic code can do.
