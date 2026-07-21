# Decision log

Every open choice from the spec, decided. Implementation follows these without re-litigating;
if one proves wrong during a milestone, change it here first, then in code.

## Runtime & tooling

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Node floor | **≥ 20** | Current LTS; gives `util.parseArgs`, stable `fs.watch` fallbacks. |
| D2 | Module format | **ESM only, strict TS** | Greenfield; no CJS consumers. `"type": "module"` everywhere. |
| D3 | Workspace | **pnpm**, packages `core` / `cli` / `web` | Per scaffold plan. |
| D4 | Build | **tsup** for `core`+`cli`, **Vite** for `web` | tsup = zero-config ESM bundles; Vite owns the dashboard. |
| D5 | Tests | **Vitest** (workspace mode, one config at root) | One runner everywhere, fast, TS-native. |
| D6 | Publishing | **Only `ctxviz` is published**; core/web bundled into it | One-package `npx ctxviz` cold-start story. `@windowpane/core` stays workspace-internal until someone needs it. |
| D7 | Lint/format | ESLint flat config + Prettier defaults | Boring on purpose. |

## Engine

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D8 | Tokenizer | **`js-tiktoken`, `cl100k_base`** | Pure JS (no WASM load path issues in a bundled CLI), sync API. Exact Claude tokenization isn't public; relative estimates suffice because the overhead remainder reconciles to the exact `usage` total. |
| D9 | Token-estimate caching | **Memoize per (record uuid, block index)** | Blocks are immutable once written; re-tokenizing the whole history on every append would make live mode O(n²). |
| D10 | Turn identity | **Group assistant records by `requestId`** | One API turn spans N records with duplicated `usage` (see transcript-schema.md). Timeline = one point per requestId; window total = last record's usage. |
| D11 | Compaction handling | Attribute blocks from the **latest `compact_boundary` onward** + the `isCompactSummary` record | Pre-boundary content left the window; remainder absorbs residual error. |
| D12 | Subagents | Parse `subagents/*.jsonl` **lazily, only for the separate subagent view** | Separate windows; never folded into the main breakdown. MVP ships main window first; subagent view is additive. |
| D13 | Model→window-limit table | Explicit longest-prefix map, overridable via `--limit <tokens>` | `claude-fable-5`, `claude-mythos-5`, `claude-opus-4-8/-7/-6`, `claude-sonnet-5`, `claude-sonnet-4-6` → 1,000,000; `claude-sonnet-4-5`, `claude-haiku-4-5`, `claude-opus-4-5` → 200,000. Unknown/`<synthetic>` → show absolute tokens, no percentage. |
| D14 | Prune thresholds | Single payload > **10K est. tokens** flagged; redundant `Read` = same normalized path ≥ 2× (reclaimable = all but the last read) | Simple, explainable defaults; constants in `prune.ts`, not config, until users ask. |

## CLI & server

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D15 | Arg parsing | **`util.parseArgs`** (Node built-in) | 5 flags don't justify a dependency. Subcommand = first positional. |
| D16 | HTTP server | **`node:http`**, hand-rolled routes | Serves a static bundle + 2 endpoints; express/fastify is dead weight for npx cold start. |
| D17 | Live transport | **SSE** (`/api/stream`), not WebSocket | One-way push is all we need; EventSource auto-reconnects for free; no `ws` dependency; same HTTP server. |
| D18 | Push payload | **Full recomputed snapshot** per change (JSON, ~KBs), client diffs | Trivially correct protocol; animation diffing belongs client-side where the stable keys live. |
| D19 | File watching | **chokidar v4** | `fs.watch` is unreliable on macOS for appends; chokidar is the one watcher dependency worth having. |
| D20 | Port / open | Default **4317**, `--no-open` opt-out, open via `open`/`xdg-open` spawn | Per spec; no `open`-package dependency. |
| D21 | Session locating | Newest `.jsonl` **directly in** the encoded project dir (exclude side-dirs); `--session <id\|path>` accepts uuid or path | Matches observed layout; `cwd`-field check on first record to disambiguate encoding collisions. |

## Web

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D22 | Treemap | **`d3-hierarchy` layout + React-rendered absolutely-positioned divs** | d3-hierarchy is pure math (tiny, no DOM claims); React stays the single DOM owner; no visx dependency. |
| D23 | Animation | **CSS transitions on top/left/width/height** keyed by stable node keys | FLIP-style re-flow for free; Framer Motion not needed at this scale (≤ a few hundred nodes). |
| D24 | Timeline | Hand-rolled SVG stacked-area via **`d3-shape`** | One tiny dep for the area generator; charting libs are overkill for one chart. |
| D25 | State | Plain `useState` + one `useSyncExternalStore` for the SSE feed | No state library. The app has one data source. |
| D26 | Styling | Vanilla CSS (single stylesheet, CSS variables for theme) | No Tailwind build-step coupling in a bundled artifact. |

## Non-negotiables (restated from CLAUDE.md, apply to every decision above)

No outbound network in the default path · all raw JSONL field access inside
`packages/core/src/transcript/` · buckets always sum to the exact `usage` total · read-only ·
sanitized fixtures only.
