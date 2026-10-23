# Demo checklist — tonight, then 09:00 tomorrow

Print this. Tick as you go. Nothing here takes judgment; it's all mechanical.

---

## A. Tonight (≈2 h, mostly waiting)

### A1. Install the four engines
```bash
brew install whisper-cpp ollama
uv tool install piper-tts
mkdir -p ~/models ~/piper

# whisper base.en (142 MB, English-only)
curl -L -o ~/models/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

# piper voice (63 MB)
curl -L -o ~/piper/en_US-lessac-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -L -o ~/piper/en_US-lessac-medium.onnx.json \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

# the local LLM (3B, ~1.9 GB — correct size for 8 GB)
ollama pull qwen2.5:3b-instruct
```
- [ ] `whisper-server --help | head -3` works
- [ ] `piper --help | head -3` works
- [ ] `ollama list` shows the model

### A2. Prove each engine by hand (10 min, in four terminals)
```bash
whisper-server -m ~/models/ggml-base.en.bin --host 127.0.0.1 --port 8787 -t 4
echo "Noted." | piper --model ~/piper/en_US-lessac-medium.onnx -f /tmp/t.wav && afplay /tmp/t.wav

# quick STT test using macOS speech synthesis as a fixture
say -o /tmp/probe.wav --data-format=LEI16@16000 \
  "Design review moved to Thursday at four, Priya is presenting."
curl -s http://127.0.0.1:8787/inference -F file=@/tmp/probe.wav -F language=en \
  -F temperature=0 -F response_format=json

# LLM strict-JSON test
curl -s http://127.0.0.1:11434/api/chat -d '{
  "model":"qwen2.5:3b-instruct","stream":false,"format":"json",
  "options":{"temperature":0,"num_ctx":2048,"num_predict":160},
  "messages":[{"role":"system","content":"You convert one spoken transcript into a note. Reply with JSON only: {\"kind\":\"note\"|\"unclear\",\"title\":\"3-7 words\",\"body\":\"markdown bullets\"}. Keep every name, number and date. body is 1-5 short bullets, no preamble. Use \"unclear\" when the text is noise, under 3 meaningful words, or not worth keeping."},
  {"role":"user","content":"design review moved to thursday at four priya is presenting"}]}' | python3 -m json.tool
```
- [ ] STT returns the sentence in **under 1 s**
- [ ] LLM returns valid JSON with a sensible title in **under 2 s**
- [ ] `afplay /tmp/t.wav` sounds acceptable (this voice is the app's voice — approve it now)

### A3. Wake word — **20-minute timebox, this is the only risky piece**
```bash
cd sidecar && uv add openwakeword onnxruntime numpy httpx websockets
python -c "import openwakeword.utils as u; u.download_models()"   # one-time download
```
- [ ] `preflight.py` reports a hit for `hey_jarvis` on a recorded WAV
- [ ] Live mic test: say “Hey Jarvis” five times → at least 4 hits, no false hit while music/TV plays

> If either box is unchecked at the 20-minute mark: **stop and adopt Fallback A0** — the demo runs on
> `⌥Space` push-to-talk only, and the wake word is described as “the trigger layer, wired but parked
> for this build”. That is an honest, working demo. Do not spend the night on ONNX.

### A4. Fixtures for Demo Mode (10 min)
Record with QuickTime (File ▸ New Audio Recording), save into `tests/fixtures/`:
- [ ] `design-review.wav` — “Design review moved to Thursday at four, Priya is presenting.”
- [ ] `vendor-quotes.wav` — “Note that we need three quotes from vendors by Monday.”
- [ ] `unclear.wav` — a deliberate mumble: “ehh the thing with the, you know, that guy”

Convert to 16 kHz mono: `ffmpeg -i in.wav -ar 16000 -ac 1 out.wav` (ffmpeg via `brew install ffmpeg`).

### A5. Machine hygiene
- [ ] Wi-Fi is something you can *turn off on camera* (it's your proof of offline)
- [ ] Do Not Disturb ON · notifications OFF · Slack/Chrome quit
- [ ] Terminal font ≥ 14pt, dark theme, hidden during the demo
- [ ] `caffeinate -d` running so the Mac never sleeps
- [ ] Battery ≥ 60 %, charger plugged in (Metal throttles under power pressure)
- [ ] Screen recording permission granted to QuickTime **before** tomorrow

---

## B. Tomorrow 09:00 — preflight (5 min)

```bash
cd heyscribe-mvp
./scripts/demo-reset.sh          # clean vault, fresh sidecar
./scripts/preflight.py           # must be all green
./scripts/warm.sh                # loads whisper + the LLM, plays the chime
pnpm dev                         # app opens, chip says "Listening for Hey Jarvis"
```
- [ ] all four engines green
- [ ] your voice moves the waveform (not just a static bar)
- [ ] one live test → card + “Noted.”
- [ ] Activity Monitor: memory pressure **green**, app total under ~5 GB

---

## C. The demo (45 s) — script

**Before you start:** Wi-Fi OFF. Finder window with `~/Documents/Hey Scribe` minimised behind the app.

| Time | You do | You say |
|---|---|---|
| 0:00 | app in front, orb breathing | “This is a note-taking app that hears you — and nothing leaves this laptop. Wi-Fi is off.” |
| 0:08 | “Hey Jarvis.” | “No wake word training, no cloud trigger.” |
| 0:11 | “Design review moved to Thursday at four, Priya is presenting.” | *(silence — let the card land)* |
| 0:15 | card springs in, “Noted.” plays | “It decided what mattered, wrote a real Markdown file, and told me.” |
| 0:22 | click the card → Finder reveals the .md | “That's a plain file in my Documents folder. No database, no account.” |
| 0:28 | “Hey Jarvis … ehh the thing with the, you know, that guy.” | “When I'm unclear, it doesn't invent a note.” → “I didn't catch that.” |
| 0:36 | “Hey Jarvis, note we need three quotes from vendors by Monday.” | “Under two and a half seconds, fully local, on an 8 gig Mac.” |
| 0:45 | orb back to idle | “Speech, language and voice are three swappable local models. This is the whole loop.” |

**Rules on stage**
- Three utterances maximum. If time is short, drop the third.
- Never debug. If the orb doesn't react to the wake word, hold `⌥Space` and keep the same sentence — nobody notices.
- Never open a terminal, never explain architecture with jargon mid-demo; one sentence per beat.

---

## D. If this happens on stage

| Symptom | Do this (instantly) | Say this |
|---|---|---|
| Wake word doesn't fire | hold `⌥Space`, speak the sentence | “I'll use the push-to-talk key — same engine underneath.” |
| Card doesn't appear | menu ▸ Demo Mode ▸ `design-review.wav` | “Let me replay the exact capture from rehearsal.” |
| “I didn't catch that” repeatedly | check mic input in System Settings ▸ Sound; retry once slowly | “The room mic is struggling — here's the recorded run.” |
| App frozen / beachball | Cmd+Tab to the pre-recorded `demo/backup.mov` | “I recorded this morning's clean run so we don't gamble.” |
| Something crashes | keep talking, play the video | “Nothing here touches a server — which is also why it can't fail on stage.” (then don't joke again) |

---

## E. After the demo (10 min)

- [ ] Move `~/Documents/Hey Scribe` to `~/Desktop/demo-notes-<date>` (evidence, if asked)
- [ ] Turn Wi-Fi back on
- [ ] Note the one thing that felt slow — that's your first post-MVP task
- [ ] Commit and tag `v0.1-demo` so the demo build is retrievable forever
