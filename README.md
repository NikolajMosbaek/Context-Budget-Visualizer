<div align="center">

# 🪟 Windowpane

### See what's eating your Claude Code context window — live.

A `tool_result` you forgot about is holding 57K tokens. You've read the same file four times.
**Windowpane shows you exactly where your context went — and what to prune to get it back —
refreshing in real time as your session runs.**

[![npm](https://img.shields.io/npm/v/ctxviz.svg)](https://www.npmjs.com/package/ctxviz)
&nbsp;[![data stays local](https://img.shields.io/badge/data-100%25%20local-brightgreen.svg)](#privacy)
&nbsp;[![license](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

<!-- The money shot. Record ~15s: gauge climbing past 50%, treemap re-flowing as a big
     tool_result lands, then a click into the prune panel. This GIF is the entire pitch. -->
![Windowpane live dashboard](./docs/demo.gif)

</div>

```
$ ctxviz report
┌─ Context: 513K / 1M tokens ── 51% ─┐
│ ████████ System & tool definitions   180K  35%
│ ██████   File reads                    98K  19%
│ ███      Command output                61K  12%
│ ███      MCP: ado                      54K  11%
│ ██       Thinking                      39K   8%
│          Everything else               81K  16%
└──────────────────────────────────────────────────┘
top reclaimable:  Bash output (turn 12) 57K · report.md read ×4 32K
cache efficiency: 87% of window served from cache
```

`ctxviz` (no subcommand) tails the active session and opens the live dashboard:

```
$ ctxviz
▸ watching session 3cf477c3 · dashboard live at http://127.0.0.1:4317
```

<div align="center">

**`npx ctxviz`** — zero install, reads your session locally, opens the dashboard.

</div>

---

## Why

Long Claude Code sessions get slow and forgetful, and you hit the context limit with no idea
why. The harness shows a running total — never the **composition**. You can't fix what you
can't see.

Windowpane reads your session transcript (already on disk — no API, no instrumentation) and
attributes **every token in the window to its source**: file reads, command output, each MCP
server, subagent reports, thinking, and the fixed system overhead. Then it ranks what you can
reclaim.

> Vague anxiety — *"my context is full"* — becomes an answer: *"these 5 items are 60% of it."*

## What it looks like

The terminal view above (`ctxviz report`) is the one-shot breakdown. The live dashboard adds an
**interactive treemap** you can drill into (bucket → source → the individual file/command), a
**timeline** showing *when* your context ballooned, and a **prune panel** ranking the biggest
reclaimable items — all refreshing live as the session runs.

## Install

```bash
npx ctxviz                 # zero-install: auto-detects the active session in this dir
# or
npm i -g ctxviz && ctxviz
```

## Usage

```bash
ctxviz                      # live-tail the active session for the current project, open dashboard
ctxviz report              # one-shot terminal breakdown (no browser)
ctxviz --session <id|path>  # analyze a specific / finished session (works with report too)
ctxviz --project <path>     # resolve the active session for another project dir (default: cwd)
ctxviz --port 4317 --no-open
ctxviz --limit <tokens>     # override the window limit (e.g. unknown model)
```

## How it works

Claude Code writes every session to `~/.claude/projects/<project>/<session>.jsonl`, appending
as it runs. Windowpane tails that file, reads the exact window size from each turn's `usage`
block, tokenizes every message content block to attribute it to a source, and treats the
un-itemizable remainder as system + tool-definition overhead — so the breakdown always sums to
the true total. See [`docs/architecture.md`](./docs/architecture.md) for the full model.

## <a name="privacy"></a>Privacy

**Your transcript never leaves your machine.** Windowpane reads local files and serves the
dashboard on `localhost`. There are no outbound network calls in the default path. Transcripts
contain your source code and secrets — that's exactly why this is a local-only tool.

## Non-goals

Not a dollar-cost tracker. Not a multi-session analytics suite. Read-only — it *recommends*
what to prune, it never edits your session. One session, one window, made legible.

## License

MIT
