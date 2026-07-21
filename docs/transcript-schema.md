# Claude Code transcript schema — observed

Empirical ground truth for the parser adapter (`packages/core/src/transcript/`). Everything
below was observed on real transcripts, **Claude Code v2.1.202–v2.1.216** (macOS, 2026-07),
across 5 sample sessions from 3 projects (~30MB total). The format is undocumented and
version-unstable: treat this file as the contract for what the adapter must tolerate, record
each record's `version`, and never crash on anything not listed here.

## File layout

```
~/.claude/projects/<encoded-project-path>/
├── <session-uuid>.jsonl               # main transcript (append-mostly)
└── <session-uuid>/                    # side directory (same uuid, no extension)
    ├── subagents/agent-<id>.jsonl     # one transcript per subagent — SEPARATE context windows
    └── tool-results/<tool>-<ts>.txt   # large tool outputs offloaded to disk
```

- `<encoded-project-path>` = absolute path with `/` → `-` (e.g. `-Users-nsos-Documents-Workspace-mjolner-ios`).
  Note the encoding is lossy (`-` vs `/` collisions possible); resolve by matching `cwd` inside records when ambiguous.
- **Active session** = most-recently-modified `.jsonl` directly in the project dir (never recurse into
  session side-directories when locating).
- The first line of a transcript is NOT a conversation record — observed `last-prompt` at line 1.
  Metadata records are interleaved throughout; do not assume conversational ordering.

## Record types observed (frequency across 5 sessions, ~6.5K records)

| `type` | Count | Has `message`? | Occupies window? | Notes |
|---|---|---|---|---|
| `assistant` | 2687 | ✅ | ✅ | The core record. Carries `usage`. |
| `user` | 1620 | ✅ | ✅ | User turns AND tool_results AND injected meta (`isMeta: true`). |
| `attachment` | 498 | ❌ (`attachment` obj) | ❓ indirect | Harness deltas: `hook_success`, `task_reminder`, `deferred_tools_delta`, `command_permissions`, `skill_listing`, `mcp_instructions_delta`, `diagnostics`, `agent_listing_delta`… |
| `mode` | 398 | ❌ | ❌ | `{mode, sessionId, type}` |
| `last-prompt` | 398 | ❌ | ❌ | `{leafUuid, sessionId, type}` — appears repeatedly, incl. line 1 |
| `bridge-session` | 360 | ❌ | ❌ | `{bridgeSessionId, lastSequenceNum, …}` |
| `permission-mode` | 357 | ❌ | ❌ | |
| `pr-link` | 243 | ❌ | ❌ | |
| `system` | 134 | ❌ | ❌ | Hook results, `subtype: "compact_boundary"` markers |
| `queue-operation` | 132 | ❌ | ❌ | |
| `file-history-snapshot` | 100 | ❌ | ❌ | |
| `file-history-delta` | 92 | ❌ | ❌ | |
| `custom-title` | 46 | ❌ | ❌ | |
| `agent-name` / `agent-color` / `frame-link` | 13 | ❌ | ❌ | |

**Adapter rule:** classify by `type`; anything unrecognized → keep with raw byte size in an
"unknown" bucket. Only `assistant` and `user` records carry window-occupying `message.content`.

## Common envelope (message-bearing records)

`assistant`/`user`/`attachment`/`system` records carry: `uuid`, `parentUuid` (thread graph),
`sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`, `isSidechain`, `userType`, `entrypoint`.
`assistant` adds `requestId`; `user` adds `promptId`, sometimes `isMeta`, `isCompactSummary`.

## The `usage` block (on every `assistant` record — 100% coverage observed)

Much richer than the original spec assumed. Observed shape (v2.1.216, only one shape seen):

```json
{
  "input_tokens": 2,
  "cache_creation_input_tokens": 819,
  "cache_read_input_tokens": 406279,
  "output_tokens": 930,
  "cache_creation": {"ephemeral_1h_input_tokens": 819, "ephemeral_5m_input_tokens": 0},
  "server_tool_use": {"web_search_requests": 0, "web_fetch_requests": 0},
  "service_tier": "standard",
  "inference_geo": "not_available",
  "speed": "standard",
  "iterations": [{ "...same fields...", "type": "message" }]
}
```

- **Window occupancy at that turn = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.**
  Confirmed live: 400,387 on a session whose real window was ~40% of 1M. `output_tokens` is that
  turn's generation, not occupancy.
- Parse defensively: treat all fields except the three input counters + `output_tokens` as optional.
- `iterations[]` exists (fallback/multi-attempt bookkeeping) — ignore for MVP.

## ⚠️ One API turn = many `assistant` records (dedup by `requestId`)

A single API response is split across **multiple consecutive `assistant` records** (roughly one
per content block), all sharing one `requestId` and each carrying a **copy of the same `usage`**.
Observed: up to 9 records per `requestId`.

- **Window total:** take `usage` from the *last* assistant record in file order — never sum per-record.
- **Per-turn stats (timeline):** group by `requestId`; one usage per group.
- `model` may be `"<synthetic>"` (harness-injected messages, e.g. error notices) — exclude synthetic
  records from model detection; use the latest real `message.model` for the window-limit lookup.

## Content blocks (`message.content`)

`user.content` is a **string** (plain prompts, 5%) or an **array** (95%). `assistant.content` is
always an array. Observed block types and counts: `tool_use` 1512, `tool_result` 1512,
`thinking` 776, `text` 418, `image` 1.

- `tool_use`: `{name, id, input}`. Observed names: `Bash`, `Edit`, `Read`, `Write`, `Agent`,
  `Skill`, `ToolSearch`, `TaskCreate/Update`, `AskUserQuestion`, `SendUserFile`, `SendMessage`,
  `WebFetch`, `mcp__<server>__<tool>` (group MCP by the middle segment).
- `tool_result`: `{tool_use_id, content, is_error?}` where `content` is a **string (94%)** or an
  **array** of blocks — observed inner types: `text`, `image`, `tool_reference`
  (`{"type":"tool_reference","tool_name":"TaskCreate"}` — tiny, near-zero cost).
- `thinking`: `{thinking: "...", signature: "..."}` — count the `thinking` text; signature is small.
- Attribution key: `tool_result.tool_use_id` → the `tool_use.id` it answers → that tool's `name`.
  Build the id→name index over the **whole file** (the pair spans records).

## Injected context markers

- `user` records with **`isMeta: true`**: harness-injected content (`<system-reminder>`,
  `<local-command-caveat>`, hook output) → **Injected context** bucket, not "User messages".
- `<system-reminder>` blocks also appear inline inside ordinary user-turn content arrays →
  classify block-by-block (regex on text prefix), not record-by-record.
- `attachment` records do not carry `message.content`; the text they describe may be materialized
  at API-call time without being stored → lands in the **overhead remainder**. Don't token-count
  attachment records themselves. Open question for M1: validate against the sum-to-total invariant.

## Compaction markers

- `system` record with `subtype: "compact_boundary"`, `content: "Conversation compacted"` marks the boundary.
- The replacement summary is a `user` record with **`isCompactSummary: true`** ("This session is
  being continued from a previous conversation…").
- **Attribution impact:** after a boundary, pre-boundary content no longer occupies the window.
  MVP rule: attribute blocks only from the latest compact boundary onward (plus the summary record);
  the exact total from `usage` self-corrects any error via the overhead remainder.

## Subagents (spec correction)

The original spec assumed inline `isSidechain: true` records. **Not true in v2.1.x:** the main
transcript contains zero sidechain records; subagents live in
`<session-uuid>/subagents/agent-<id>.jsonl`, where every record has `isSidechain: true` and an
`agentId` field. They have their own `usage` (own windows). Keep them out of the main-window
breakdown; surface as a separate per-agent view. (Keep the `isSidechain` filter in the adapter
anyway — cheap insurance for older/newer versions.)

## Offloaded tool results

Very large tool outputs are written to `<session-uuid>/tool-results/<tool>-<timestamp>.txt`
(observed: 332K ADO work-item JSON). Whatever text appears in the transcript's `tool_result` is
what occupies the window — attribution from transcript content stays correct without reading
these files. Ignore the directory entirely.

## Live-tailing behavior

- Main transcript is append-mostly while running; a line may be partially written at read time →
  buffer incomplete trailing bytes, parse on next change (see docs/algorithms.md).
- Metadata records (`mode`, `last-prompt`, …) are appended between turns — a file change does not
  imply new conversation content.
- All 2687 assistant records had `usage` — no streaming partials observed at the record level.

## Known unknowns (design the adapter to absorb these)

1. Whether `attachment`-described text is stored anywhere token-countable (currently: remainder).
2. Pre-2.1.x transcripts (older field sets); the `version` field enables per-version quirks later.
3. `<synthetic>` model records' exact semantics.
4. Whether compaction rewrites the file or only appends the summary (observed: append-only).
