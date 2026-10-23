# MVP prompt pack — five prompts, one day

Paste **one prompt per session** in Antigravity (Planning mode), approve the plan, let it build.
Each prompt is self-contained; `AGENTS.md` carries the rules.

Rule for the day: **if a prompt is not below, you are not building it.**

---

## Prompt 0 — Tonight: prove the engines (2 h, mostly downloads)

```text
/plan Build ONLY a preflight script + four tiny spikes for a one-day demo. No app code.

scripts/preflight.py must:
1. Check binaries: `whisper-server`, `ollama`, `piper` (via shutil.which) and print a table.
2. Start whisper-server if not running (ollama serve if not running), wait up to 20 s, then:
   - POST tests/fixtures/hello.wav to http://127.0.0.1:8787/inference with language=en,
     response_format=json, temperature=0 → print the transcript and latency.
   - Call http://127.0.0.1:11434/api/chat with the note prompt below, model from --model,
     format={"type":"object"} … → print the raw JSON and latency.
3. Run `piper --model <path> -f /tmp/preflight.wav` on "Noted." and print the duration.
4. Load openwakeword with the "hey_jarvis" model, feed tests/fixtures/wake.wav in 1280-sample
   chunks, print every score > 0.3 and whether at least one hit fired.
5. Print a final PASS/FAIL line per engine and exit non-zero if any failed.

The note prompt to use:
"""You convert one spoken transcript into a note. Reply with JSON only:
{"kind":"note"|"unclear","title":"3-7 words","body":"markdown bullets"}
Keep every name, number and date. body is 1-5 short bullets, no preamble.
Use "unclear" when the text is noise, under 3 meaningful words, or not worth keeping."""

Also create scripts/warm.sh that starts both servers and pre-loads the model, and
scripts/gen-sounds.sh that copies /System/Library/Sounds/Tink.aiff and Pop.aiff into assets/.

Do not create the Electron app. Do not create the sidecar. Just these four files.
Report the measured numbers in a table; do not estimate.
```

**You need tonight:** all four lines PASS, plus two recorded WAVs in `tests/fixtures/` (a clean note, an unclear mumble).

---

## Prompt 1 — Shell + live audio (1.5 h)

```text
/plan Build the Electron shell with a live microphone pipeline. No wake word, no STT, no LLM yet.

apps/desktop via electron-vite + React 19 + TypeScript strict + Tailwind. Files exactly:
  src/main/index.ts, src/preload/index.ts,
  src/renderer/index.html, src/renderer/src/{App.tsx,Orb.tsx,audio.ts,pcm-worklet.js,ws.ts,index.css}

Main process:
- BrowserWindow 1280x820, titleBarStyle hiddenInset, backgroundColor '#0b0e14',
  contextIsolation true, sandbox true, nodeIntegration false, deny all navigation/new windows.
- On launch: systemPreferences.getMediaAccessStatus('microphone'); if not-determined call
  askForMediaAccess; expose the status over IPC. If denied, the window shows one card with an
  "Open System Settings" button that opens x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone.
- Spawn the sidecar (dev: `uv run --project sidecar python -m app.main`), read one
  `READY {"port":N}` line from stdout, expose the port + a per-launch token to the renderer.
  Kill the child on app quit. If it exits, show a red status chip and restart once after 2 s.
- Global shortcut Alt+Space: keydown sends {t:"ptt",on:true}, keyup {t:"ptt",on:false}.
- Tray icon with "Show window" / "Quit".

Renderer:
- Two panes: left 360 px note rail (empty state: "Your notes will appear here"), right stage.
- Orb component with four states (idle, listening, thinking, speaking) rendered as concentric
  rings + a radial gradient; idle uses a slow 4 s breathing animation, listening renders 24 bars
  driven by RMS, thinking renders a soft pulse, speaking renders a brighter ring.
  Respect prefers-reduced-motion.
- audio.ts: getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}})
  → AudioContext at the device rate → AudioWorklet from pcm-worklet.js → 320-sample Int16 frames.
- pcm-worklet.js: 3:1 decimation when the context is 48 kHz (average 3 samples, not drop), emit 320.
- ws.ts: connect to ws://127.0.0.1:<port>?token=<token>, queue at most 40 frames while connecting,
  drop the rest, reconnect once after 1 s.
- App.tsx shows the orb, a status chip ("Listening for Hey Jarvis" / "Listening" / "Thinking" /
  "Speaking") and connects everything. Sending frames starts automatically at launch.
- A dev-only hidden corner indicator showing frames/second (small, muted; remove later).

Sidecar stub: services/sidecar/app/main.py with a websockets server that accepts the token,
replies {"t":"ready",...} and logs frame counts every 50 frames.

Acceptance: speak and see the bars react at 45-55 fps (print the measured rate in the corner);
deny the mic in System Settings and see the recovery card; `pnpm typecheck && pnpm lint` clean.
```

---

## Prompt 2 — The pipeline (2.5 h) ← the whole product

```text
/plan Implement the complete voice-to-note pipeline in the sidecar. This is the demo.

Create exactly these modules, each with one class:
  app/wake.py        class Wake(onnx path)      .feed(pcm: np.int16) -> bool
  app/endpointer.py  class Endpointer()         .feed(pcm) -> "start"|"end"|None
  app/stt.py         class Stt(base_url)        .transcribe(wav: bytes) -> {text, ms}
  app/brain.py       class Brain(ollama_url, model) .format(text) -> {kind,title,body} | None
  app/vault.py       class Vault(root)          .create(title, body) -> {id,path,title,body}
  app/speak.py       class Speak(piper_model)   .say(text) -> {pcm_b64, rate}
  app/main.py        the orchestrator (below)

Behaviour (implement exactly this order, no additions):
1. Audio frames arrive as binary 0x01|uint32 seq|640 bytes. Push to a 20 s ring buffer.
2. wake.feed on every frame. On a hit: emit {"t":"wake"}, emit state "listening", play nothing yet
   (the renderer chimes). 1.5 s cooldown. Disable wake while state is speaking.
3. When state is listening, endpointer.feed each frame: energy VAD with an adaptive noise floor
   (rolling 2 s minimum), speech starts above 3x the floor, ends after 700 ms below 1.8x,
   minimum utterance 400 ms, hard cap 20 s, keep 300 ms of pre-roll from the ring buffer.
4. On end: emit state "thinking", POST the WAV (16 kHz mono 16-bit) to whisper-server /inference
   with language=en, temperature=0, response_format=json, timeout 15 s.
   Emit {"t":"transcript","text","ms"}. If empty or avg logprob < -1.2 → treat as unclear.
5. brain.format(text): Ollama /api/chat, stream=false, temperature 0, num_ctx 2048, num_predict 160,
   keep_alive 10m, format=json with this prompt (load from app/prompts/note.v1.txt):
     """You convert one spoken transcript into a note. Reply with JSON only:
        {"kind":"note"|"unclear","title":"3-7 words","body":"markdown bullets"}
        Keep every name, number and date. body is 1-5 short bullets, no preamble.
        Use "unclear" when the text is noise, under 3 meaningful words, or not worth keeping."""
   Validate keys and types yourself; on any failure return None (do not retry more than once).
6. If kind == "unclear" or brain is None with < 3 meaningful words: emit state "idle" and
   {"t":"say","text":"I didn't catch that. Say it again?"}.
   If brain is None but text is long: write the transcript as the note and say "Saved."
7. Else vault.create(title, body) and emit {"t":"note", id, title, path, body} and
   {"t":"say","text":"Noted."}. Emit state "speaking", then "idle" when the renderer reports done.
8. {"t":"cancel"} → stop listening/speaking immediately, clear buffers, state idle.
9. {"t":"demo","file":"x.wav"} → read tests/fixtures/x.wav, feed it through steps 3-7 with the
   wake step skipped, at real-time pace (20 ms per frame). Used for the demo fallback.

vault.py: root defaults to ~/Documents/Hey Scribe. Filename "<YYYY-MM-DD HHMM> - <title>.md"
(sanitised: keep letters/numbers/space/hyphen, max 60 chars). Body = the markdown bullets plus a
front matter block with created/source. Atomic write (tmp + os.replace). Snapshot previous versions
of the same file into .snapshots/ before overwriting.

speak.py: piper subprocess writing to a temp WAV, read it back, strip the 44-byte header, return
base64 PCM16 at the WAV's sample rate. If piper is missing, fall back to
`say -o /tmp/x.aiff` and note it in the log. Never raise to the caller — return None and let the
renderer show the text only.

Renderer: implement the full event handling: state changes drive the orb, transcript appears with a
typewriter reveal, note events push cards into the rail with a spring animation, "say" events are
decoded to an AudioBuffer and played (stop on Esc). Esc also sends {"t":"cancel"}.
Chime on "wake" using assets/Tink.aiff via an <audio> element.

Acceptance — run and paste measurements:
- Say "Hey Jarvis" then a sentence → card appears, "Noted." plays, total wake→spoken < 2.5 s. Measure 3 times.
- Say a mumble → "I didn't catch that" and no file created (`ls` the vault).
- Mic off, Demo Mode WAV → identical result.
```

---

## Prompt 3 — Make it beautiful (1.5 h)

```text
/plan Visual polish pass. No new features, no new dependencies. Touch only renderer files + assets.

Design language: deep charcoal #0B0E14 background, one accent (#7C8CF8), text #E6E9F2,
muted #8A93A6. Type: system font stack, 13px labels with 0.08em letter-spacing for chips,
22px transcript, 15px card titles. One 1px hairline (#1C2230) between panes. No shadows except
one soft highlight on the active orb.

1. Orb: 220 px, three concentric rings at decreasing opacity, a radial gradient core that scales
   1.00 → 1.03 on a 4 s ease-in-out loop when idle. Listening: 24 bars, 3 px wide, 2 px gap,
   symmetric around center, height from RMS with 120 ms decay. Thinking: core pulses at 1.5 s,
   bars hidden. Speaking: outer ring brightens and rotates slowly. All transitions 200 ms ease-out.
2. Transcript: center stage, max 2 lines, 22px/1.5, fades in per word (40 ms stagger), and clears
   to a quiet "Say Hey Jarvis" hint 4 s after the state returns to idle.
3. Note rail: section header "Today"; each card = title (15px semibold), first body bullet clamped
   to 2 lines, right-aligned time (13px muted). New card animates in from 8 px below with a
   180 ms spring and a 1 s accent left-border glow. Clicking a card calls main to reveal the file
   in Finder. Hover raises the card background by one step.
4. Chips: pill, 1px border, dot colored by state (idle muted, listening accent, thinking accent
   pulse, speaking green). Copy: "Listening for Hey Jarvis" / "Listening" / "Thinking" / "Speaking".
5. Bottom hint bar: "⌥ Space hold to talk · Esc to cancel", 12px, muted, fades after 10 s.
6. Menu bar icon: a tiny 3-bar waveform template image; states via title text (● listening).
7. Add a menu item "Demo Mode ▸" with the two fixture WAVs, plus "Open notes folder".
8. Empty state of the rail: an outline glyph and "Your first note will land here."

Acceptance: a full-window screenshot of each of the four orb states and one with two note cards.
Everything legible at 1280x820 and at 1440x900. No console errors.
```

---

## Prompt 4 — Rehearse (1 h)

```text
/plan Make the demo repeatable, then stop touching code.

1. scripts/demo-reset.sh: clears the vault (moves it to ~/Desktop/heyscribe-demo-backup-<ts>),
   restarts the sidecar, and prints the current engine status.
2. scripts/warm.sh: starts whisper-server, loads the Ollama model with a 1-token request,
   plays the chime, exits. Run this 60 s before the demo so nothing cold-loads on stage.
3. Add a "Preflight" menu item that runs the four engine checks and shows a green/red list in-app.
4. Record a 90 s screen capture with QuickTime of one perfect run; save it to demo/backup.mov and
   mention it in README.
5. README.md (12 lines max): what it is, how to run (`pnpm dev`), the trigger phrase, the models,
   the one config file, and the fallback keys (⌥Space, Demo Mode, Esc).
6. Then do three rehearsals end-to-end and paste the measured wake→"Noted." times.

Do not change the pipeline. Do not add features. If a rehearsal fails, fix only that failure.
```

---

## If Antigravity drifts

| Symptom | Paste this |
|---|---|
| Plan is huge / proposes a framework | “Cut the plan to files under `apps/desktop` and `sidecar/app`. No new dependencies. Anything not needed for wake→note→speak is out of scope.” |
| It refactors the pipeline mid-polish | “Stop. Revert changes outside renderer/ and assets/. The pipeline is frozen.” |
| It edits tests/fixtures to pass | “Do not modify fixtures or tests. Fix the implementation, explain the root cause in 3 lines.” |
| It adds a package | “Remove it. `websockets`, `numpy`, `httpx`, `openwakeword`, `onnxruntime` and Electron/Vite/React are the entire allowlist.” |
| You're behind schedule | “Cut to the smallest version that still does wake → transcript → note file → 'Noted.' Keep the orb idle/listening states only. Hide everything else.” |

---

## Time checkpoints (stop and triage)

| By | If not green |
|---|---|
| 09:30 | preflight has any red → spend 30 min max, then switch to that engine's fallback **now** |
| 11:00 | no live waveform → drop the AudioWorklet decimation, use `getUserMedia` + ScriptProcessor equivalent, ship whatever moves |
| 13:30 | no note card yet → drop the LLM entirely: title = first 6 words, body = transcript, reply “Noted.” (LLM appears in the demo as a one-line config flip if it comes back) |
| 15:00 | UI not polished → orb + cards only, no transitions, no waveform; a calm static orb beats a jittery animation |
| 15:30 | anything still red → demo via Demo Mode or PTT, and record the video |
