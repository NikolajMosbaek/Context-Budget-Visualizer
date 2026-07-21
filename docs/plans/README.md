# Implementation plans — execution order

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Execute plans strictly in order; do not start
> a milestone until the previous one's acceptance check passes.

| Order | Plan | Produces |
|---|---|---|
| 1 | `milestone-0-tooling.md` | pnpm workspace, green `pnpm build && pnpm test` |
| 2 | `milestone-1-core-engine.md` | `@windowpane/core`: parser adapter + attribution + prune, fixture-tested |
| 3 | `milestone-2-report.md` | `ctxviz report` terminal breakdown |
| 4 | `milestone-3-dashboard.md` | Static web dashboard (treemap/timeline/prune) for finished sessions |
| 5 | `milestone-4-live.md` | Live tail → SSE → animated updates (the headline) |
| 6 | `milestone-5-ship.md` | Polish, npm publish, cold `npx ctxviz` |

Required reading before ANY task: `docs/contracts.md` (frozen signatures — plans conform to
it; if a plan and contracts.md ever disagree, contracts.md wins), `docs/transcript-schema.md`
(what the adapter tolerates), `docs/decisions.md` (D-numbers referenced throughout),
`docs/algorithms.md` (pseudocode the implementations follow),
`packages/core/test/fixtures/README.md` (assertions M1 must encode).

Cross-cutting invariants (from CLAUDE.md, apply to every task): no outbound network in the
default path · raw JSONL field names only inside `packages/core/src/transcript/` · buckets sum
exactly to `totalTokens` · read-only on session files · commit + push when a task is done.
