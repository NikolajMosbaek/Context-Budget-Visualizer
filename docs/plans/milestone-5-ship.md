# Milestone 5: Polish & Ship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks 4–5 need the human (recording, npm auth) — prepare everything, then hand off.

**Goal:** A fresh `npx ctxviz` on a clean machine produces the demo experience.

**Architecture:** No new modules — hardening, edge-case UX, packaging, and the two human-in-the-loop steps (demo.gif, npm publish).

## Global Constraints

- No new dependencies
- README promises are the acceptance list: `npx ctxviz` zero-install, 100% local, demo.gif, MIT LICENSE file

---

### Task 1: Edge-case UX + danger styling

**Files:**
- Modify: `packages/web/src/Gauge.tsx`, `packages/web/src/styles.css`, `packages/web/src/App.tsx`

- [ ] **Step 1: Danger zone** — when `totalTokens/windowLimit > 0.85`, add `class="danger"` to the app header; CSS: `header.danger { outline: 2px solid var(--red); animation: pulse 2s infinite; } @keyframes pulse { 50% { outline-color: transparent; } }`.
- [ ] **Step 2: Empty/edge states** — `isEmpty` screen already exists; add a "window limit unknown — showing absolute tokens" hint chip when `windowLimit === null`.
- [ ] **Step 3: Big-session guard** — verify against the largest local session (`ctxviz report --session <22MB transcript>` from the schema investigation corpus): report `time node …` < 5s. If slower, profile: the tokenizer dominates — confirm the memo cache is hit (log cache size in dev).
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(web): danger styling, edge states; perf-checked on 22MB session" && git push`

### Task 2: Package metadata for publishing

**Files:**
- Modify: `packages/cli/package.json`, `README.md`
- Create: `LICENSE`

- [ ] **Step 1: LICENSE** — MIT text, copyright `2026 Nikolaj Simonsen`.
- [ ] **Step 2: package.json fields**

```json
{
  "description": "See what's eating your Claude Code context window — live.",
  "repository": { "type": "git", "url": "git+https://github.com/NikolajMosbaek/Context-Budget-Visualizer.git" },
  "keywords": ["claude", "claude-code", "context-window", "tokens", "visualizer"],
  "license": "MIT"
}
```

- [ ] **Step 3: Verify the tarball is self-contained**

Run: `pnpm --filter ctxviz build && cd packages/cli && npm pack`
Then in a scratch dir: `npm install <tarball> && npx ctxviz report --session <fixture path>` — must work with no pnpm workspace present (proves `noExternal` bundling of core + `files` allowlist are right).

- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore: publish metadata, LICENSE, tarball smoke test" && git push`

### Task 3: README final pass

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Verify every README claim is now true: flags match `docs/contracts.md` CLI table, `docs/architecture.md` link resolves, the terminal block matches actual `ctxviz report` output shape (update whichever is nicer). Remove the demo-GIF HTML comment only after Task 4.
- [ ] **Step 2: Commit** — `git add -A && git commit -m "docs: README matches shipped behavior" && git push`

### Task 4: demo.gif (HUMAN)

- [ ] Prepare: run `ctxviz` against a live session; the 15s script from the README comment: gauge climbing past 50% → a big tool result lands, treemap re-flows → click into prune panel.
- [ ] Human records (macOS: Cmd-Shift-5 → gif via `ffmpeg -i in.mov -vf "fps=12,scale=960:-1" docs/demo.gif`), saves to `docs/demo.gif`.
- [ ] Commit: `git add docs/demo.gif README.md && git commit -m "docs: demo recording" && git push`

### Task 5: Publish (HUMAN pushes the button)

- [ ] `npm publish --dry-run` in `packages/cli` — review the file list (dist, web-dist, README? copy root README into packages/cli at publish: add `"prepublishOnly": "cp ../../README.md ."`).
- [ ] Human: `npm login && npm publish` (public).
- [ ] Cold-machine smoke test: `npx ctxviz@latest` in a project with sessions → dashboard opens.
- [ ] Tag: `git tag v0.1.0 && git push --tags`.

## Acceptance (project done)

`npx ctxviz` cold on a second machine reproduces the README demo; all tests green; README
truthful end-to-end.

## Deferred backlog (explicitly cut from MVP — do not sneak in)

- Timeline turn-scrub (recompute snapshot at turn N server-side)
- Subagent side-view (parse `subagents/*.jsonl`, per-agent windows — schema is documented)
- `--exact` Anthropic token-count API mode
- Codex/other-harness adapters behind the transcript adapter seam
