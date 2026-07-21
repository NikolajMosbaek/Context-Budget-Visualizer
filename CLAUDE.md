# Windowpane (`ctxviz`)

Live "what's eating my Claude Code context window" visualizer. Reads the session JSONL
transcript from `~/.claude/projects/`, attributes every token in the window to its source,
and renders a live treemap + timeline + prune panel in the browser. CLI command: `ctxviz`.
(The GitHub repo is named `Context-Budget-Visualizer`; the project/product name is Windowpane.)

**The attribution model — how the engine works and why buckets always sum to the exact
`usage` total — is specified in [`docs/architecture.md`](docs/architecture.md). Read it
before touching engine code. Keep it in sync when the model changes.**

## Doc map (read in this order before implementing)

| Doc | Authority over |
|---|---|
| [`docs/contracts.md`](docs/contracts.md) | **All type/function signatures — wins over every other doc on conflict** |
| [`docs/transcript-schema.md`](docs/transcript-schema.md) | Observed JSONL reality (v2.1.x): record types, usage shape, requestId turn grouping, compaction markers, subagent file layout |
| [`docs/decisions.md`](docs/decisions.md) | Every technical choice (D1–D26) — don't re-litigate; change the doc first |
| [`docs/algorithms.md`](docs/algorithms.md) | Tail-parse state machine, treemap animation, prune ranking |
| [`docs/plans/`](docs/plans/README.md) | Executable milestone plans M0–M5 with full code and tests |
| [`packages/core/test/fixtures/README.md`](packages/core/test/fixtures/README.md) | The assertions M1 tests must encode |

## Status

**Preparation complete — ready to execute.** All heavy design decisions are frozen in the docs
above; fixtures exist. Next action: execute `docs/plans/milestone-0-tooling.md`, then M1–M5 in
order (each plan ends demoable; don't start a milestone until the previous acceptance passes).

## Planned architecture

pnpm workspace, three packages — the engine is its own package so it's testable without the
CLI or UI:

```
packages/
├── core/           # pure engine: transcript adapter → attribute → prune → SessionSnapshot
│   └── src/transcript/   # ADAPTER: ALL raw JSONL field access lives here, nowhere else
├── cli/            # ctxviz binary: report (terminal), serve, watch (live tail)
└── web/            # Vite + React dashboard (d3 treemap, timeline, prune panel),
                    # built into a static bundle the CLI serves
```

Stack: strict TypeScript, Vitest, ESLint + Prettier, tsup (or Vite lib mode) for `core`/`cli`.
Live updates: chokidar/fs.watch tail → WebSocket/SSE push → animated treemap re-flow.

### Milestones (work top-to-bottom; each ends demoable, don't start one until the previous one's acceptance passes)

| # | Deliverable | Acceptance |
|---|-------------|------------|
| 0 | Workspace + tooling | `pnpm build && pnpm test` green on skeleton |
| 1 | Parser engine (`core`) with fixture tests | buckets sum to reported total; redundant reads detected; unknown record types don't crash |
| 2 | `ctxviz report` (terminal ASCII) | correct breakdown on a real local session |
| 3 | Static web dashboard for a finished session | treemap drill-down + timeline scrub + prune panel work |
| 4 | Live mode (headline feature) | gauge/treemap update within ~1s of each turn, no refresh |
| 5 | Polish & ship to npm | cold `npx ctxviz` works on a clean machine |

## Build & Test

Root scripts (run from the repo root; requires Node ≥20 + pnpm via corepack):

- `pnpm install` — install the workspace (esbuild's build script is allow-listed in
  `pnpm-workspace.yaml`; run `pnpm rebuild esbuild` if tsup/vite ever error on a missing binary)
- `pnpm build` — tsup-builds `core` then `cli`, then Vite-builds `web` into `packages/cli/web-dist/`
- `pnpm test` — builds `core`+`cli` (so the CLI integration test runs against a fresh bundle),
  then `vitest run` across all packages
- `pnpm lint` — `eslint .` + `prettier --check .` (Prettier owns code/config; markdown docs,
  the lockfile, and fixtures are in `.prettierignore`). `pnpm format` rewrites in place.
- Focused runs: `pnpm exec vitest run packages/core/test/<file>.test.ts`
- Try the CLI: `node packages/cli/dist/index.js report --session packages/core/test/fixtures/basic.jsonl`

## Don't

- **Don't** access raw transcript field names outside `packages/core/src/transcript/` — the
  JSONL schema is undocumented and version-unstable; the adapter is the single point that
  absorbs Claude Code version drift
- **Don't** make outbound network calls in the default path — transcripts contain source code
  and secrets; "100% local" is the trust story and the README promises it
- **Don't** present estimated token counts as authoritative — the exact `usage` total is ground
  truth; estimates only apportion it, and the overhead remainder reconciles the difference
- **Don't** write to or mutate session files — Windowpane is read-only; it recommends prunes,
  acting on them is the harness's job
- **Don't** commit fixture transcripts that haven't been sanitized — real transcripts contain
  real source and secrets
- **Don't** guess a context-window limit for an unknown model id — show absolute tokens without
  a percentage instead
- **Don't** crash on unknown record `type`s — count their raw size into an "unknown" bucket
- **Don't** fold subagent sidechains (`isSidechain: true`) into the main-window breakdown —
  they occupy their own context; show them separately
- **Don't** read a real session transcript into context with Read/cat — transcripts are
  megabytes and will flood the window. Sample with `jq -R 'fromjson? | …' | head` /
  `uniq -c` aggregations only; develop against the fixtures
- **Don't** change a signature from `docs/contracts.md` in code without updating the doc in
  the same commit — the contracts doc is the source of truth tests are written against
- **Don't** force-push to origin — a normal `git push` is fine; never `--force`/`-f`

## Workflow

- **Commit and push when a task is done** — don't leave finished work sitting locally, and
  don't wait to be asked
- **Verify before declaring done** — run the tests/build and cite the output; never claim
  completion without proof
- **Minimal impact** — find root causes, no temporary fixes; inside the files you touch, shape
  them as if from scratch; outside them, keep the diff minimal
- **Stop and re-plan when stuck** — don't push through a sideways approach
