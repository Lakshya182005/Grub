# Hey Scribe — MVP for tomorrow's demo

**One sentence:** Say “Hey Jarvis” → speak → a clean note card appears on screen and the app says
“Noted.” Everything runs on an 8 GB Mac, offline, today.

**Success = one flawless 45-second loop, three times in a row.** Not features. Not robustness. The loop.

---

## 1. What the audience sees (design the demo before the software)

```
 0:00  App is open. Calm dark window. Big soft orb breathing. Chip: "Listening for Hey Jarvis".
 0:06  You say: "Hey Jarvis."
       → soft chime, orb turns into live waveform, chip: "Listening"
 0:09  You say: "Design review moved to Thursday at four, Priya is presenting."
       → orb pulses while thinking, transcript appears line by line
 0:12  → a note card springs into the left rail: "Design review moved to Thursday"
       → voice: "Noted."  → orb returns to breathing.
 0:18  You say: "Hey Jarvis ... mumble something unclear."
       → voice: "I didn't catch that. Say it again?"  (orb gently returns to idle)
 0:26  You say: "Hey Jarvis, note that we need three quotes from vendors by Monday."
       → second card appears, voice: "Noted."
 0:35  You say: "Hey Jarvis, what's in my notes?"  → (optional, only if green: see §9)
 0:45  Done. Click the note → it opens the .md file in Finder.
```

Two beats matter: **the card appearing** (proof it wrote a real file) and **"Noted."** (proof of the voice loop). Everything else is decoration.

---

## 2. Scope

### In (nothing else)
| # | Capability | Notes |
|---|---|---|
| 1 | macOS Electron app, one window, tray, `⌥Space` push-to-talk | dev-run is fine; no signing |
| 2 | Mic capture in the renderer → 16 kHz PCM over local WebSocket | the one macOS-correct way |
| 3 | Wake phrase **“Hey Jarvis”** (pretrained openWakeWord) | no custom training today |
| 4 | Energy endpointer (simple VAD) | Silero is a later swap |
| 5 | STT: whisper.cpp `base.en`, English only | fastest safe choice on 8 GB |
| 6 | One LLM call: transcript → `{kind, title, body}` | no agents, no tools, no memory |
| 7 | Write one Markdown file to `~/Documents/Hey Scribe/` | real file, real Finder path |
| 8 | TTS: fixed replies — “Noted.” / “I didn't catch that. Say it again?” | Piper, local |
| 9 | UI: orb states, live transcript, note cards, chime | this is where the beauty budget goes |
| 10 | **Demo Mode**: a menu item that pushes a bundled WAV through the real pipeline | insurance, build it |

### Out — and exactly where each one plugs back in
Nothing is deleted, everything has a named hole. “Attach later” means: add one file, register it, no rewiring.

| Cut for MVP | Re-attach at | Already in place for it |
|---|---|---|
| Custom “Hey Scribe” wake model | `sidecar/app/wake.py` → `WakeDetector(model_path)` | model path is config; training runbook stays in the full plan §5.4 |
| Push-to-talk is **kept** (it's the safety net), global hotkey config | `main/index.ts → registerHotkey()` | single function |
| Silero VAD | `sidecar/app/endpointer.py` → same `feed(frame) → events` API | stage boundary is already clean |
| Note agent (search/append/update/link/tasks) | `sidecar/app/vault.py` + new `agent/tools.py` | `vault.py` already has create/append/snapshot; `intent` field exists in the protocol |
| Rule router & 12 intents | `sidecar/app/brain.py → classify()` (one branch today) | returns a `Route` object already |
| Meetings / dictation modes | `sidecar/app/main.py → MODES` dict | state machine reads `mode` from config |
| FTS5 search + Cmd+K | `sidecar/app/vault.py → search()` empty + `ui/Search.tsx` | index path reserved in config |
| Notes editor / chat UI | `renderer/src/App.tsx` right pane | layout is already two-pane |
| Settings screen | `config.json` + one menu item ("Open config") | zod schema exists |
| Onboarding & model manager | `main/models.ts` stub | manifest shape defined in the full plan §10 |
| Parakeet STT / Kokoro TTS | `stt.py` / `speak.py` are single-class adapters | config has `engine` |
| Signing, notarization, DMG, auto-update | full plan Phases 9–10, untouched | — |
| Non-English | nothing to remove; prompts and voices are `en` | — |

> The rule: **a cut feature may not leave a half-wired stub in the UI.** No greyed-out buttons, no empty tabs. The MVP looks finished because it only shows what works.

---

## 3. Architecture (the same shape, 70 % less of it)

```
Electron main ── spawns ──▶ python sidecar (uv run, from source)
   │                          │
   │   WS 127.0.0.1:PORT      ├─ wake.py      openWakeWord, "hey_jarvis"
   │◀──────── audio ────────▶ ├─ endpointer   energy VAD, 300 ms pre-roll, 1.2 s tail
   │        events            ├─ stt.py       POST /inference → whisper-server (base.en)
   │                          ├─ brain.py     ONE Ollama call, strict JSON
   │   renderer               ├─ vault.py     atomic write + snapshot → ~/Documents/Hey Scribe
   │   ├─ getUserMedia        └─ speak.py     Piper → 22 kHz PCM → base64 → renderer
   │   ├─ AudioWorklet 16 kHz
   │   └─ orb, cards, player
   └─ spawns ──▶ whisper-server (brew whisper-cpp, model resident, Metal)
   └─ supervises ▶ ollama serve (only if not already running)
```

**Kept on purpose (do not simplify further):**
- **Python sidecar** — the ML stack is Python; a sidecar also means a crash doesn't kill the window.
- **Mic in the renderer** — Chromium owns the TCC permission. A Python mic loop is the #1 way this demo dies.
- **whisper-server, not in-process** — model stays warm; a 5 s utterance transcribes in ~0.3 s.

**Cut on purpose:** JSON-Schema codegen, protocol versioning, contract tests, retries, circuit breakers, config migrations, telemetry, multi-language, streaming partial transcripts, barge-in (Esc still stops audio — 10 lines).

### The whole pipeline, in order (this is the spec)

```python
on_frame(pcm16_320):                     # 20 ms, 16 kHz mono
    ring.push(pcm16)
    if wake.feed(pcm16).fired:           # 3 consecutive hits ≥ 0.55, 1.5 s cooldown
        emit("wake"); chime(); mode = LISTEN
    if mode is LISTEN and endpointer.feed(pcm16).ended:
        wav = ring.slice(preroll=300ms, tail=1200ms)      # ≤ 20 s
        t = stt.transcribe(wav)                            # whisper-server, lang=en
        emit("transcript", t.text)
        r = brain.format(t.text)        # → {"kind":"note"|"unclear","title","body"}
        if r.kind == "unclear":  emit("say", "I didn't catch that. Say it again?")
        else:  path = vault.create(r.title, r.body); emit("note", ...); emit("say","Noted.")
        mode = IDLE
```

**Brain prompt (complete, don't inflate it):**

```text
You convert one spoken transcript into a note. Reply with JSON only:
{"kind":"note"|"unclear","title":"3-7 words","body":"markdown bullets"}

Rules: keep every name, number and date exactly as spoken. body is 1-5 short bullets, no preamble.
Use "unclear" when the text is noise, under 3 meaningful words, or not something worth keeping.
Never invent content. Never comment on the request.
```

Decoding: `temperature 0`, `num_ctx 2048`, `num_predict 160`, `keep_alive 10m`, `format` = the JSON schema.

**Spoken replies are fixed strings, not generated** (deterministic, instant, always on-brand):
`Noted.` · `I didn't catch that. Say it again?` · `Saved.` (when the LLM is unavailable) · `Sorry, the local model is busy.` (timeout).
If you later want the model to phrase them, flip `config.llm.phraseReplies` — the seam is one function.

---

## 4. 8 GB budget (everything below is chosen to fit)

| Process | Idle | Peak | Notes |
|---|---|---|---|
| Electron (main + renderer) | ~450 MB | ~600 MB | no dev tools open during the demo |
| Sidecar (wake + endpointer + Piper loaded) | ~280 MB | ~450 MB | ONNX Runtime, no torch |
| whisper-server, `base.en` | ~450 MB | ~650 MB | `-t 4`, unload after 5 min idle |
| Ollama, 3B Q4 | 0 | ~2.6 GB | `keep_alive 10m`, `num_ctx 2048` |
| macOS + background | ~2.5 GB | ~2.5 GB | |
| **Total** | **~3.7 GB** | **~6.8 GB** | fits, with ~1 GB of headroom |

**Model picks (fixed for today):**

| Role | Pick | Size | Why |
|---|---|---|---|
| Wake | openWakeWord `hey_jarvis` | ~1.5 MB | pretrained, zero setup |
| STT | `ggml-base.en.bin` | 142 MB | English-only, fast on Metal; `small.en` only if you see < 4 GB free |
| LLM | `qwen2.5:3b-instruct` (fallback `llama3.2:3b`) | ~1.9 GB | reliable strict JSON at this size |
| TTS | Piper `en_US-lessac-medium` | 63 MB | one binary + one file; **simplest** possible local TTS today |

**Why Piper and not Kokoro for the MVP:** Kokoro is better-sounding and Apache-licensed, but it drags in a Python runtime, a G2P lexicon and `espeak-ng`. Piper is a single binary that takes text and writes a WAV — 20 lines of code, no surprises. It's GPL-3.0, which is irrelevant for a demo and for personal use; swap to Kokoro behind `speak.py` before you ever ship commercially. That swap is a 40-minute job, not a redesign.

**8 GB hygiene for the demo:** close Chrome/Slack; don't screen-record *and* run the pipeline at full chat quality; warm everything 60 s before (`scripts/warm.sh`) so no model is cold-loading on stage.

---

## 5. Repo (16 files you can actually finish)

```
heyscribe-mvp/
├── AGENTS.md                      # copy of mvp/03-AGENTS.md
├── package.json                   # root scripts only
├── scripts/
│   ├── preflight.py               # checks all 4 engines, prints a green/red table
│   ├── warm.sh                    # loads whisper model + ollama model, plays a test tone
│   └── gen-sounds.sh              # copies two macOS system sounds into assets/
├── apps/desktop/
│   ├── electron.vite.config.ts
│   └── src/
│       ├── main/index.ts          # window, tray, mic permission, sidecar, hotkey, Demo Mode
│       ├── preload/index.ts       # window.scribe: {onEvent, send, mic, demo}
│       └── renderer/
│           ├── index.html
│           └── src/
│               ├── App.tsx        # two panes: note rail + stage
│               ├── Orb.tsx        # idle | listening | thinking | speaking
│               ├── NoteCard.tsx
│               ├── audio.ts       # getUserMedia → worklet → WS frames
│               ├── pcm-worklet.js # 48k→16k, Float32→Int16, 320-sample batches
│               └── ws.ts          # connect, reconnect once, send frames, emit events
└── sidecar/
    ├── pyproject.toml
    └── app/
        ├── main.py                # WS server + the pipeline above (~140 lines)
        ├── wake.py                ├─ endpointer.py     ├─ stt.py
        ├─ brain.py                ├─ vault.py          └─ speak.py
        └── prompts/note.v1.txt
```

That's roughly 1,100 lines total. Antigravity should produce it in five prompts (see `01-MVP-PROMPTS.md`).

---

## 6. Protocol subset (deliberately tiny)

```jsonc
// renderer → sidecar
{"t":"hello","config":{...}}
{"t":"audio.config","rate":16000,"ch":1,"frame":320}
{"t":"ptt","on":true}                     // ⌥Space held
{"t":"cancel"}                            // Esc: stop listening/speaking
{"t":"demo","file":"design-review.wav"}    // Demo Mode injection
// binary: 0x01 | uint32 seq | 640 bytes pcm16le

// sidecar → renderer
{"t":"ready","models":{"wake":"hey_jarvis","stt":"base.en","llm":"qwen2.5:3b","tts":"lessac"}}
{"t":"state","s":"idle"|"listening"|"thinking"|"speaking"}
{"t":"wake","score":0.81}
{"t":"transcript","text":"design review moved to thursday at four priya is presenting","ms":312}
{"t":"note","id":"n_01","title":"Design review moved to Thursday","path":"…/2026-10-23 1432 — Design review moved to Thursday.md","body":"…"}
{"t":"say","text":"Noted.","pcm":"<base64 22kHz pcm16>"}
{"t":"error","code":"llm_unavailable","message":"…"}
```

No schema package, no versioning today. `05-sidecar-protocol.md` remains the reference for the grown-up version; this subset is a strict prefix of it, so upgrading later is additive.

---

## 7. Build schedule (hours, not phases)

### Tonight (~2 h, mostly downloads)
1. `brew install whisper-cpp ollama` · `uv tool install piper-tts` · download `piper` voice.
2. `whisper-server -m ~/models/ggml-base.en.bin --port 8787 --host 127.0.0.1` → transcribe a test WAV.
3. `ollama pull qwen2.5:3b-instruct` → run the brain prompt on two transcripts, confirm strict JSON.
4. `uv add openwakeword` → **20-minute timebox**: `wake_spike.py` must print hits for “Hey Jarvis”. If it does not, switch to Fallback A (see §9) tonight, not tomorrow.
5. `piper --model en_US-lessac-medium.onnx -f out.wav` → hear it.
6. Record two fixture WAVs with QuickTime: a clean note sentence, and a deliberately unclear one.

### Tomorrow
| Time | Work | Gate |
|---|---|---|
| 09:00–09:30 | `scripts/preflight.py` green on all four engines | table all green |
| 09:30–11:00 | **P1** shell + mic + WS + orb idle/listening | waveform reacts to your voice |
| 11:00–13:30 | **P2** wake → endpointer → STT → brain → file → Piper | say a sentence, card + “Noted.” |
| 13:30–15:00 | **P3** polish: type scale, transitions, chime, note cards, Demo Mode, Esc | looks intentional on video |
| 15:00–16:00 | **P4** rehearsal ×3, record a screen capture, load fixtures | 3 clean runs |
| 16:00–17:00 | buffer — fix the slowest thing only | — |

Do **not** start packaging, settings, search, or a custom wake model today.

---

## 8. Definition of done

- [ ] Cold launch → first note in under 15 s (including model warm-up), no console visible.
- [ ] Wake → card + “Noted.” in under 2.5 s on the demo Mac, measured 5×.
- [ ] An unclear utterance gets the right reply and leaves the vault untouched.
- [ ] Every produced card corresponds to a real `.md` file that opens from Finder.
- [ ] Esc stops speech instantly; ⌥Space works without the wake word.
- [ ] Demo Mode replays a WAV end-to-end with the network off.
- [ ] No greyed-out buttons, no "coming soon", no empty panels.
- [ ] Three consecutive clean rehearsals.

---

## 9. Fallback ladder (rehearse these, don't improvise)

| If | Then | Built when |
|---|---|---|
| Wake word doesn't fire | hold `⌥Space` — identical pipeline, say the sentence | P1 |
| Wake word is flaky all morning | **Fallback A:** whisper-always-on — endpointer transcribes every utterance, strips a leading “hey scribe/jarvis” if present. Costs ~0.4 s latency, needs no KWS. | 45 min, only if needed |
| Mic/room is bad | **Demo Mode** menu → inject `design-review.wav` through the live pipeline | P3 |
| LLM is slow or OOM | code path `kind="note_"` — write the transcript as the note, say “Saved.” (title = first 6 words) | P2, 15 min |
| Piper fails | macOS `say -v Samantha "Noted."` behind the same `speak()` function | P2, 10 min |
| Whole app fails on stage | the screen recording from 15:00 | P4 |

The one thing you must never do: debug on stage. Every failure above has a visible, honest path that still shows the idea working.

---

## 10. What "modular" means in practice

Tomorrow's code should be organised so that re-adding a cut feature is *additive*, and you can demo that claim:

1. **One stage, one file.** `wake.py`, `endpointer.py`, `stt.py`, `brain.py`, `vault.py`, `speak.py` — each exposes exactly one class with one method. Swapping engines = one new class + one config line.
2. **`main.py` is an orchestrator, not a brain.** It contains the pipeline in §3 verbatim; no feature logic lives there.
3. **Events are the UI contract.** The renderer reacts to `state`, `transcript`, `note`, `say`; adding a feature means emitting a new event, not editing the UI's state machine.
4. **The vault is the only writer.** Every future tool (search, append, tasks) calls `vault.py`; nothing else touches disk.
5. **Config is the feature flag.** `config.json` already has keys for the cut features (`stt.engine`, `tts.engine`, `wake.model`, `modes`, `search.enabled`). They read as "reserved", not "broken".

When you add search next week, you add `vault.search()`, one event, one component — and nothing in today's pipeline changes. That is what you claim on stage, and it will be true.

---

## 11. Eight hours from now, if you only do one thing

Build the **P2 pipeline** and accept the ugly UI for an hour. A demo where the note card appears and a voice says “Noted.” is the entire product thesis. The orb is a coat of paint on top; the pipeline is the idea.
