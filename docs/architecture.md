# Architecture — the attribution model

How Windowpane turns a Claude Code session transcript into a breakdown of the context
window that always sums to the true total. This is the engine's contract; the CLI and
dashboard are renderers on top of it.

## Where the data comes from

Claude Code writes every session to a JSONL transcript on disk. **No API, no scraping, no
instrumentation of Claude Code itself** — Windowpane just reads the file.

> The schema is observed-but-undocumented and can change across Claude Code versions. All
> raw field access is isolated in the parser adapter (`packages/core/src/transcript/`);
> nothing else in the codebase knows the JSONL shape. See [Design invariants](#design-invariants).

### Transcript location

```
~/.claude/projects/<encoded-project-path>/<session-id>.jsonl
```

`<encoded-project-path>` is the project's absolute path with every `/` replaced by `-`
(so `/Users/me/dev/my-app` → `-Users-me-dev-my-app`). The **active session** is the
most-recently-modified `.jsonl` in the encoded dir for the current working directory.
Sessions are appended to line-by-line while running, which is what makes live-tailing work.

### Record shape

One JSON object per line, discriminated by a top-level `type` field. Observed types:
`assistant`, `user`, `system`, `attachment`, `file-history-snapshot`, `mode`, `last-prompt`.
Common fields: `timestamp`, `sessionId`, `cwd`, `gitBranch`, `version`, `uuid`,
`parentUuid` (thread graph), `isSidechain` (true for subagent/Task sidechains), `isMeta`.

Unknown record types are never a crash: they're kept with their raw byte size and counted
into an "unknown" bucket.

## The two fields that matter most

### (a) Exact window size — the `usage` block on `assistant` records

```json
"usage": {
  "input_tokens": 2,
  "cache_creation_input_tokens": 50550,
  "cache_read_input_tokens": 21858,
  "output_tokens": 4874
}
```

**Context window size at that turn ≈ `input_tokens + cache_creation_input_tokens +
cache_read_input_tokens`.** Caching splits the *input* into freshly-written vs. cache-hit,
but all of it occupies the window. The latest `assistant` record's usage is the current
window occupancy — this is ground truth, never estimated. (`output_tokens` is that turn's
generation, not window occupancy.)

### (b) Composition — the `message.content` array of blocks

Block `type`s observed: `text`, `thinking`, `tool_use`, `tool_result`, `image`.

- `tool_use` — has `name` (e.g. `Read`, `Bash`, `mcp__ado__wit_get_work_item`, `Agent`,
  `Skill`, `WebFetch`) and `input`. Usually small.
- `tool_result` — has `tool_use_id` and `content` (a string, or an array of blocks).
  **This is where the big payloads live.** Linking `tool_use_id` back to the originating
  `tool_use` tells you which tool produced the payload — that's the attribution key.

## The attribution algorithm

The engine turns a transcript into a bucketed breakdown of the current window:

1. Take the **exact total** from the latest `assistant` `usage` (the sum in (a) above).
2. Walk all message content blocks and **estimate tokens per block** locally, tagging each
   block with a source bucket from the taxonomy below.
3. Sum estimates per bucket. The blocks account for the *conversation*; the remainder
   between the exact total and the summed blocks is **fixed overhead** (system prompt +
   tool-schema definitions + SessionStart-injected context), shown as its own bucket.

The overhead remainder does double duty: it captures overhead that never appears as content
blocks, *and* it absorbs tokenizer approximation error — so **the buckets always sum to the
true total**.

```ts
function snapshotFromTranscript(lines: Record[]): SessionSnapshot {
  const latest = lastAssistantWithUsage(lines)
  const total = latest.usage.input_tokens
              + latest.usage.cache_creation_input_tokens
              + latest.usage.cache_read_input_tokens

  const toolNameById = indexToolUses(lines)        // tool_use_id -> tool name
  const items: Item[] = []
  for (const rec of lines) {
    for (const block of rec.message?.content ?? []) {
      const bucket = classify(block, rec, toolNameById)
      items.push({ bucket, tokens: estimateTokens(block), label: labelFor(block) })
    }
  }
  const attributed = sum(items.map(i => i.tokens))
  const overhead = Math.max(0, total - attributed)  // system + tool defs
  return buildBuckets(items, overhead, total, latest.model)
}
```

### Source taxonomy (buckets)

| Bucket | Source |
|--------|--------|
| **System & tool definitions** | Computed remainder (total − attributed blocks). The base overhead of every session. |
| **Injected context** | `CLAUDE.md`, memory, SessionStart hook output — `isMeta`/`system`/`attachment` records. |
| **Tool results → File reads** | `tool_result` for `Read` |
| **Tool results → Command output** | `tool_result` for `Bash` |
| **Tool results → MCP: `<server>`** | `tool_result` for `mcp__<server>__*`, grouped by server |
| **Tool results → Subagents** | `tool_result` for `Agent`/`Task` |
| **Tool results → Web** | `WebFetch`/`WebSearch` |
| **Tool results → Skills** | `Skill` loads |
| **Tool results → Other** | any remaining tools |
| **Thinking** | `thinking` blocks (reasoning) |
| **Assistant text** | `text` blocks in assistant messages |
| **User messages** | user `text` |
| **Tool calls** | `tool_use` inputs |
| **Images** | `image` blocks |

Drill-down: each bucket expands to its individual items (e.g. File reads → the specific
files with per-file token cost). That per-item view is what powers the prune panel —
largest single payloads, redundant reads of the same file, stale giant outputs.

### Sidechains

Subagent sidechains (`isSidechain: true`) run in their own context window, not the main
one the user is watching. They're shown separately, never folded into the main breakdown.

## Token counting

The core path requires no network and no API key. A **local BPE tokenizer** (`tiktoken`
cl100k as a proxy — exact Claude tokenization isn't public) produces *relative* per-block
estimates. Because the buckets are anchored to the exact `usage` total and approximation
error folds into the overhead remainder, relative estimates are all that's needed.

## Cache efficiency (secondary signal)

`cache_read_input_tokens` was served from cache (cheap, fast); `cache_creation_input_tokens`
was re-processed this turn. The split is surfaced as a secondary stat ("92% of your window
was served from cache") — the only nod to cost in an otherwise not-a-cost-tracker tool.

## <a name="design-invariants"></a>Design invariants

1. **No outbound network** in the default path. Transcripts contain source code and
   secrets; the trust story is "it never leaves your machine".
2. **All transcript field access stays inside the parser adapter**
   (`packages/core/src/transcript/`). Claude Code version drift is contained to one folder;
   each record's `version` field is recorded.
3. **Buckets always sum to the exact `usage` total.** Estimated numbers are never displayed
   as authoritative; the overhead remainder reconciles them.
4. **Read-only.** The tool never writes to or mutates a session file — it *recommends*
   prunes, acting on them is the harness's job (`/compact` etc.).
5. **Unknown model id → absolute tokens, no percentage.** The model → window-limit table
   needs upkeep as models change; it's config-overridable, and the tool never guesses a
   limit it doesn't know.
