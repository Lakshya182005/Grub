# Start here — booting the project in Antigravity

Follow these in order. Total setup time ≈ 25 minutes, most of it downloads.
Nothing in this file requires judgement; the prompts do the thinking.

---

## 0. The mental model (30 seconds)

Antigravity is an **editor with an agent that has a terminal**. It will write files and run commands.
It cannot hear your microphone, cannot see your screen, and cannot keep a server alive between turns.

So the division of labour for the next 24 h is:

| Antigravity does | You do |
|---|---|
| Writes the code, runs tests, fixes its own errors | Say the sentences, judge the feel, watch memory |
| Runs short commands (`pnpm typecheck`, `pytest`, `curl`) | Owns the long-running servers (whisper, ollama) |
| Produces the Implementation Plan + Walkthrough artifacts | Approves / comments on those artifacts |
| — | Records fixtures, rehearses, decides what to cut |

---

## 1. Before you open Antigravity (10 min, Terminal)

```bash
# 1.1 toolchain
xcode-select --install                       # skip if already installed
brew install node@22 pnpm uv whisper-cpp ffmpeg
brew install --cask ollama                   # or: keep your existing install
uv tool install piper-tts

# 1.2 models — full commands in docs/02-DEMO-CHECKLIST.md §A1
#     ggml-base.en.bin · en_US-lessac-medium.onnx · qwen2.5:3b-instruct

# 1.3 verify each engine by hand BEFORE asking an agent to use it
whisper-server --help | head -2
piper --help | head -2
ollama list
python3 -c "import openwakeword" 2>/dev/null || echo "openwakeword comes with the sidecar venv"
```

**Rule:** if an engine doesn't work in *your* terminal, it will not work inside the agent's terminal.
Fix it here, not later.

---

## 2. Create the workspace exactly like this (2 min)

```bash
mkdir -p ~/dev/heyscribe-mvp && cd ~/dev/heyscribe-mvp
git init -b main
mkdir -p docs scripts tests/fixtures apps sidecar

# copy the pack in (from wherever you saved it — dropbox, downloads, the workspace)
cp <path-to>/hey-scribe/mvp/0*.md    docs/
cp <path-to>/hey-scribe/mvp/04-UI-MOCK.svg docs/
cp <path-to>/hey-scribe/mvp/03-AGENTS.md  AGENTS.md     # ← root, exact name

printf "node_modules\n.venv\n__pycache__\ndist\nout\n*.aiff\n" > .gitignore
git add -A && git commit -m "docs: MVP plan, prompt pack, agent rules"
```

**Why this shape:** `AGENTS.md` at the root is auto-loaded into every session (Antigravity reads it
before each task). `docs/` is what the prompts reference, so the agent can read detail without you
pasting it. Git from minute one means every prompt is revertible with one command.

Final tree before you start:

```
heyscribe-mvp/
├── AGENTS.md                    ← the rules
├── docs/00-MVP-PLAN.md … 04-UI-MOCK.svg
├── scripts/  tests/fixtures/  apps/  sidecar/     (empty for now)
└── .git/
```

---

## 3. Open it in Antigravity (2 min)

1. **Open Folder → `~/dev/heyscribe-mvp`.** Not the parent, not your home directory — the agent's
   scope is the folder you open, and a narrow scope is the single best guard against drift.
2. **Confirm it read the rules.** In the agent pane ask: `Summarise AGENTS.md in 5 bullets.`
   If it can't, the file isn't at the root or isn't named `AGENTS.md` — fix that first.
3. **Select the strongest available model** for coding (Gemini 3 Pro / Claude Sonnet-tier). Switch
   down to a faster model only for trivial edits.
4. **Turn on plan review** (Settings → Agent / Artifact review policy): the agent must pause for your
   approval before executing an Implementation Plan. For this project, never let it run unattended.
5. **Allow terminal commands**, but keep the approval prompt on. You want to see what it runs.
6. **Index / open the folder fully** so it can see `docs/` — if your version has a workspace index,
   let it finish before the first prompt.

---

## 4. Session 1 — tonight's spike (Prompt 0)

Antigravity's `/plan` produces an Implementation Plan artifact and waits. That's the loop:

```
/plan  + paste the entirety of "Prompt 0" from docs/01-MVP-PROMPTS.md
```

Then:

| Step | What you do |
|---|---|
| 1 | Read the plan artifact. It should name **4 spike files + preflight + 2 scripts**. Anything more = scope creep. |
| 2 | Comment inline if it proposes the Electron app, a framework, or extra deps. Then **Review → submit**. |
| 3 | Click **Proceed**. Watch it write files. |
| 4 | It will try to run `scripts/preflight.py`. **Expect it to fail the first time** — servers aren't running. That's the point: you start them in your own terminal. |
| 5 | When it reports failures, don't let it "fix" them by editing the checks. Tell it: *"The engines are down, not the script. Wait — I'll start them."* |

Start the servers yourself, in a terminal you keep open all day:

```bash
# terminal A (leave running)
whisper-server -m ~/models/ggml-base.en.bin --host 127.0.0.1 --port 8787 -t 4

# terminal B (leave running)
ollama serve            # skip if the Ollama menubar app is already running

# terminal C — where you work
cd ~/dev/heyscribe-mvp && ./scripts/preflight.py --model qwen2.5:3b-instruct
```

**Gate to pass tonight:** preflight prints four green lines and real numbers. Commit:
`git add -A && git commit -m "spike: engines verified"`.

If `openwakeword` is red at the 20-minute mark → adopt Fallback A0 (push-to-talk demo), note it in
`docs/02-DEMO-CHECKLIST.md`, and go to sleep. Do not debug ONNX at 1 a.m.

---

## 5. Sessions 2–5 — the build (tomorrow)

**One conversation per prompt. Always a fresh branch. Always a commit after.**

```bash
git checkout -b p1-audio
# paste Prompt 1 → approve plan → Proceed → verify yourself → commit
git checkout main && git merge p1-audio
```

| Session | Paste | You verify (not the agent) | Commit message |
|---|---|---|---|
| 1 | Prompt 0 | four green lines + numbers | `spike: engines verified` |
| 2 | Prompt 1 | speak → bars move; deny mic → recovery card | `feat: shell + live audio` |
| 3 | Prompt 2 | **your voice**: card + "Noted." under 2.5 s ×3; mumble → no file | `feat: voice-to-note pipeline` |
| 4 | Prompt 3 | four orb screenshots; it looks finished | `style: demo polish` |
| 5 | Prompt 4 | three clean rehearsals, then stop | `chore: demo harness` |

**After Prompt 2 the pipeline is frozen.** If Prompt 3 "needs" to change `sidecar/app/main.py`,
your answer is no.

---

## 6. The five rules of engagement

1. **Long-running servers live in your terminal, never the agent's.** An agent that starts
   `whisper-server` will sit there waiting for it to exit and burn your turn. Tell it:
   *"Assume whisper-server and ollama are already running on their default ports."*
2. **Never let a session run more than ~15 minutes unobserved.** Review the artifact, not the diff,
   every time it finishes a step. Catching a wrong turn at step 3 costs one comment; at step 30 it
   costs your evening.
3. **You are the only audio test harness.** The agent can't hear. Every claim about wake→note latency
   must come from *your* three run-throughs, not from its summary.
4. **Don't let it fix tests.** If you see it editing `tests/fixtures/` or the preflight checks to make
   output green, paste the "It edits tests" recovery prompt from `docs/01-MVP-PROMPTS.md`.
5. **Timebox, then cut.** At 11:00 / 13:30 / 15:00 check the table in Prompt 4's file. If a stage is
   red, take the cut listed there. A smaller demo that works beats a bigger one that is 80 % done.

---

## 7. What to say when it goes wrong

| Moment | Say exactly this |
|---|---|
| It proposes a big plan | *"Cut to files after `apps/desktop` and `sidecar/app`. No new dependencies. Anything not on the wake→note→speak path is out of scope."* |
| It starts refactoring | *"Stop. Revert outside `<paths>`. The task is limited to `<scope>`."* |
| It invents an API | *"Don't guess. Read the actual file / run `--help` and show me the output before writing code."* |
| It claims success | *"Show the command you ran and its output. Don't summarise — paste it."* |
| You're behind | *"Smallest version that still does wake → transcript → .md file → 'Noted.' Hide everything else."* |
| Context feels stale | *"Re-read AGENTS.md and docs/00-MVP-PLAN.md §3, then list: the phase goal, files in scope, acceptance gate. Wait for my go-ahead."* |

---

## 8. First 30 minutes, literally

- [ ] `brew` line in §1 finishes; all four engines answer `--help`
- [ ] `~/dev/heyscribe-mvp` exists with `AGENTS.md` at the root and `docs/` filled
- [ ] `git log --oneline` shows one commit
- [ ] Antigravity: Open Folder, confirm it summarises `AGENTS.md`, model = strongest, plan review on
- [ ] Paste Prompt 0 with `/plan`
- [ ] While it plans: start terminal A (whisper-server) and B (ollama serve)
- [ ] Approve the plan → Proceed → run preflight yourself → four green lines

If you have those eight boxes ticked, tomorrow is a build day, not a debugging day.
