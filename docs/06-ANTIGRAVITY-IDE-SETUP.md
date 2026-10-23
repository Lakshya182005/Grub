# Antigravity **IDE** setup — click-by-click (macOS)

This is the IDE application from `antigravity.google/download`, not the `agy` CLI.
Version note: from **v2.17.0 (Sept 2026)** planning is a `/plan` **command** plus an Implementation
Plan artifact. On older builds you'll see a **Planning / Fast** mode toggle instead — both work, the
prompt is identical.

---

## 1. Install & first launch (5 min)

1. Download the macOS build from **antigravity.google/download**, drag to `/Applications`, open it.
2. **Sign in with a personal Google account** (Workspace accounts may be restricted — the free tier
   is limited to personal Gmail).
3. On the setup wizard, when it asks for an autonomy preset, choose:

   > **Review-driven development** — a.k.a. **Request Review**

   Not *Turbo*, not *Always Proceed*. For a 24-hour deadline you want the agent to stop before it
   writes or runs anything surprising. You will approve a lot of commands today; that is the point.
4. Open **Settings** (`Cmd+,`) → **Agent** and set these three:

| Setting | Value | Why for this project |
|---|---|---|
| **Plan Review Policy** | *Review every plan* | You need to read the plan before code exists; a 3B-model demo has no room for drift |
| **Terminal Command Auto Execution** | **Require Review** | See the sandbox trap below |
| **Enable Terminal Sandbox** | **Off** for this project | The sandbox **has no network access** — `pnpm install`, `ollama pull`, `pip/uv` and localhost probing will all stall or ask |
| Browser JavaScript execution | Request Review | Unused here — it can't drive an Electron window anyway |

> **Trap #1 — the sandbox.** With *Default* (sandbox on), agent commands run in an isolated shell with
> **no network** and visibility limited to your workspace. Our pipeline needs `127.0.0.1:8787`
> (whisper) and `11434` (Ollama), plus package downloads. Either keep *Request Review* (sandbox off,
> every command approved) or, under *Default*, expect an approval card for every command that leaves
> the sandbox. For a one-day build, **Request Review** is less friction.

---

## 2. Open the project correctly (2 min)

1. **File → Open Folder…** → `~/dev/heyscribe-mvp` (the folder where `AGENTS.md` sits at the root).
   Do **not** open `~` or `~/dev`. Scope = the open folder; a narrow scope is your best drift guard.
2. The agent lives in the **right-hand panel**. If you can't see it: **`Cmd + L`** toggles it.
3. In the agent panel input, type:

   ```
   Summarise AGENTS.md in 5 bullets, then tell me which model you are running.
   ```

   - **If it can't find `AGENTS.md`** → wrong folder opened, or the file is named `AGENTS.md.md` /
     `agents.md` (lowercase works, but check the exact name in Finder with extensions visible).
   - This message is also your sanity check that the panel, the workspace index, and the model are alive.
4. **Model picker** (top of the agent panel): choose the strongest coding model available to you
   (Gemini 3 Pro / Claude Sonnet-tier). Switch to a fast model only for trivial edits.
5. **`@` mentions**: type `@docs/` to pull the plan files into context without pasting them. Use
   `@AGENTS.md` when a session feels like it has forgotten the rules.

---

## 3. Session 1 — the spike, exactly as it looks on screen

### 3.1 Start the servers *in the IDE's terminal* (not the agent's)

`Terminal → New Terminal` (`` Ctrl+` ``), then split it: `Cmd+\` or the `+` dropdown → two panes.

```bash
# pane A — leave running all day
whisper-server -m ~/models/ggml-base.en.bin --host 127.0.0.1 --port 8787 -t 4

# pane B — leave running all day
ollama serve          # skip if the Ollama menubar app is already up

# pane C (new tab) — your working shell
cd ~/dev/heyscribe-mvp && git status
```

> **Trap #2 — long-running processes.** If the *agent* starts `whisper-server` or `pnpm dev`, its turn
> never ends: it sits waiting for a process that doesn't exit, and you lose minutes to a spinner.
> Put this line in your first prompt every session:
> **“Assume `whisper-server` (8787) and `ollama` (11434) are already running, and that I run `pnpm dev`
> in my own terminal. Never start long-running servers.”**

### 3.2 Send the first prompt

Paste the whole of **Prompt 0** from `docs/01-MVP-PROMPTS.md`, prefixed with `/plan`:

```
/plan Build ONLY a preflight script + four tiny spikes for a one-day demo. No app code.
        … (rest of Prompt 0) …
```

### 3.3 Review the plan (this is the whole workflow)

1. A **task list** appears, then an **Implementation Plan** artifact.
2. Open the **Auxiliary Pane** (icon top-right) to read artifacts full-width.
3. Check: it should name **4 spike files + preflight + 2 scripts**, and nothing else. If it proposes
   the Electron app, a framework, or extra dependencies, **highlight that step → add a comment**, then
   use **Review → submit feedback**. Comments only count when submitted.
4. Click **Proceed** (in the chat or the artifact header). The agent executes step by step.

> **Trap #3 — it will "fix" a failing preflight by editing the checks.** The first run fails because
> your servers aren't up yet, not because the script is wrong. Say:
> *"The engines are down, not the script. Don't weaken the checks — wait while I start them."*

### 3.4 Verify it yourself

In **pane C**:

```bash
./scripts/preflight.py --model qwen2.5:3b-instruct
```

Four green lines with real numbers = tonight's gate. Commit in your own terminal:

```bash
git add -A && git commit -m "spike: engines verified"
```

---

## 4. The build loop (repeat 4× tomorrow)

```
git checkout -b p1-audio
  ↓
[agent panel]  /plan + Paste Prompt 1
  ↓
[auxiliary pane]  read plan → inline comments → Review → Proceed
  ↓
[agent]  writes files, may run `pnpm typecheck`, `pytest`, `curl` (short commands only)
  ↓
[your terminal]  pnpm verify · pnpm dev · THEN SPEAK INTO THE MIC
  ↓
git commit -m "feat: shell + live audio"  →  merge  →  next branch
```

**Your** verification for each session (the agent cannot do these):

| Session | Only you can check |
|---|---|
| Prompt 1 | Waveform follows your voice; denying mic shows the recovery card |
| Prompt 2 | Card appears + “Noted.” in one breath; a mumble produces **no file** |
| Prompt 3 | The four orb states look right at full screen; nothing is clipped at 1280×820 |
| Prompt 4 | Three clean rehearsals in a row; Demo Mode works with Wi-Fi off |

> **Trap #4 — the agent has no ears and no Electron window.** Its built-in browser tool cannot drive a
> native Electron app, so it will never see your UI. Don't accept “verified visually” in a walkthrough.
> Take `Cmd+Shift+4` screenshots and paste them into the chat — that's the only visual feedback it gets.

---

## 5. Recommended permission setup (paste into Settings → Agent)

With **Request Review** everything asks, which is slow but safe. If the approval fatigue gets to you
mid-afternoon, allowlist *exactly* these and nothing else:

```jsonc
{
  "permissions": {
    "allow": [
      "command(git)",
      "command(regex:pnpm (install|typecheck|lint|test|verify|dev))",
      "command(regex:uv (add|run|sync))",
      "command(regex:python3? .*preflight)  ",
      "command(regex:curl -s http://127\\.0\\.0\\.1.*)",
      "read_file(src/)", "write_file(src/)",
      "write_file(apps/)", "write_file(sidecar/)", "write_file(scripts/)"
    ],
    "deny": [
      "command(sudo)",
      "command(regex:rm -rf .*)",
      "command(regex:killall .*)",
      "write_file(.git/)",
      "write_file(~/Documents/Hey Scribe/)"
    ]
  }
}
```

Two of those denials matter: **never let the agent `killall`** (it will happily kill your whisper/ollama
terminals and blame the app), and **never let it write into the vault** outside the app's own path —
you want the note cards to be proof the *pipeline* wrote them.

Precedence is **Deny > Ask > Allow**, so a deny always wins.

---

## 6. If something looks wrong

| What you see | What it means | Fix |
|---|---|---|
| `/plan` does nothing | Older build without the command | Look for the **Planning / Fast** mode toggle above the input instead |
| Every command pops an approval for *nothing* | Sandbox on (*Default* preset) | Switch to **Request Review** in Settings → Agent |
| `pnpm install` / `uv sync` hangs | Sandbox network block | Approve the “run outside sandbox” prompt, or turn the sandbox off |
| Agent says “server not running” | It can't see your other terminal pane | Confirm with `curl -s http://127.0.0.1:8787/health` in pane C and tell it the server is up |
| Agent spins forever | It started a long-running process | Interrupt (`Esc` / stop button) and remind it of the no-servers rule |
| It re-reads the same files, forgets rules | Session grew too long | Start a new conversation; `@AGENTS.md` + `docs/00-MVP-PLAN.md §3` as context |
| It edited tests to pass | Classic | Paste: *“Don't modify tests or fixtures. Fix the implementation, explain the root cause in 3 lines.”* |
| Attachments/screenshots missing in walkthrough | It couldn't screenshot an Electron app | Paste your own screenshots and ask it to finalise the walkthrough |

---

## 7. The 12-minute version

1. Install → sign in → preset **Review-driven development**.
2. Settings → Agent: Plan Review = *every plan*, Terminal = *Require Review*, **sandbox off**.
3. `File → Open Folder` → `~/dev/heyscribe-mvp`. `Cmd+L` for the panel.
4. Ask it to summarise `AGENTS.md` (proves the rules are loaded).
5. `<Ctrl+`>` → two panes: `whisper-server` · `ollama serve`.
6. `/plan` + Prompt 0 → read artifact → **Proceed**.
7. Run `./scripts/preflight.py` yourself → four green → commit → sleep.

Tomorrow you repeat step 6 four times with Prompts 1–4, and the only things you personally judge are
the waveform, the note card, the voice, and how it looks on a projector.
