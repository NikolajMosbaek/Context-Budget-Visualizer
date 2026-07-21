# Algorithm sketches — the three genuinely hard parts

Everything else in the codebase is straightforward mapping; these three deserve pseudocode.
Signatures referenced here are frozen in docs/contracts.md.

## 1. Incremental tail-parse state machine (`cli/src/watch.ts` + `core` parse)

The naive approach (full re-read + full re-tokenize on every append) is O(n²) over a session's
life and makes a 20MB transcript unusable live. Incremental state:

```
state = {
  path,                 // watched transcript
  offset: 0,            // byte offset parsed up to (start of first unconsumed line)
  carry: "",            // partially-written trailing line from last read (no trailing \n yet)
  records: [],          // ParsedRecord[] accumulated
  estimateCache,        // Map<`${uuid}:${blockIdx}`, tokens>  (Item.id keyed — D9)
}

onChange(path):
  size = stat(path).size
  if size < state.offset:            // truncation or session rewrite
    return fullReset(path)           // re-parse from 0; treat as new session content
  chunk = read(path, from = state.offset, to = size)      // bytes, utf8-decode
  text  = state.carry + chunk
  lines = text.split("\n")
  state.carry = lines.pop()          // last element is "" (clean) or a partial line (keep)
  for line in lines where line.trim() != "":
      state.records.push(parseLine(line))                 // never throws (contract)
  state.offset = size - byteLength(state.carry)
  snapshot = snapshotFromRecords(state.records, ctx)      // estimates hit estimateCache
  emit(snapshot)
```

Rules:
- **Decode after slicing bytes, carry bytes not chars** — a UTF-8 code point can split across
  reads. Simplest correct: keep `carry` as a `Buffer`, concat, and only `toString('utf8')` on
  complete lines (split on 0x0A at the buffer level).
- **Debounce** `onChange` at ~100ms trailing — Claude Code appends in bursts.
- **Session switch**: a `locateActiveSession()` re-check on a 2s timer; if the newest transcript
  changed, `fullReset(newPath)` and emit `session-changed` on the SSE stream.
- **compact_boundary arriving live**: attribution cutoff moves forward; `snapshotFromRecords`
  already handles it statelessly (it scans records fresh each time — only *tokenizing* is cached,
  never classification).
- `fullReset` clears `records` but may keep `estimateCache` (keys are uuid-scoped; stale entries
  are harmless and bounded — cap the Map at ~50K entries, evict oldest).

## 2. Treemap re-flow animation (stable keys + FLIP via CSS)

d3-hierarchy computes layout; React owns the DOM (D22/D23). The illusion of "re-flowing live"
is entirely about **identity stability**:

```
// layout (pure, in web/src/treemapLayout.ts)
nodes = d3.treemap()
    .size([w, h]).paddingInner(2).paddingTop(18)   // top pad = bucket label strip
    (d3.hierarchy(toTree(snapshot))                // root → buckets → items
       .sum(n => n.tokens)
       .sort((a, b) => b.value - a.value))

// toTree: node.key = Bucket.key for buckets, Item.id for items  ← THE stable key
```

Render each node as an absolutely-positioned `<div key={node.key}>` with inline
`style={{ transform: translate(x0,y0), width: x1-x0, height: y1-y0 }}` and CSS
`transition: transform .4s, width .4s, height .4s, opacity .3s`.

- **Same key, new rect** → browser transitions it. That's the whole re-flow animation; no FLIP
  bookkeeping needed because we position with `transform` + explicit width/height (not layout).
- **Enter**: new keys mount with `opacity: 0` → rAF → `opacity: 1` (fade in at final rect —
  don't animate position on enter, it reads as chaos when many items land at once).
- **Exit**: skip exit animation for MVP (items rarely vanish; compaction is the only mass-exit,
  and an instant re-layout communicates it honestly).
- **Depth switch (zoom)**: clicking a bucket sets `focusKey`; layout runs on that subtree only.
  Keep item keys unchanged so zoom-in/out transitions positions smoothly.
- **Perf**: render item nodes only above a minimum area (e.g. 12px²); tiny remainder per bucket
  aggregates into a synthetic `…` node keyed `${bucket.key}:rest`. Bounds DOM nodes to ~200.
- **Text**: label + tokens shown only when rect > ~60×24; CSS `overflow: hidden` otherwise.

Gauge and timeline share the snapshot; timeline is a plain d3-shape stacked area over
`turns[]` — no animation needed beyond CSS on the "current turn" marker.

## 3. Prune ranking (`core/src/prune.ts`)

Two detectors over `items` (post-attribution, so compaction cutoff already applied):

```
largePayloads:
  items where bucket is a tool_result bucket (file-reads, command-output, mcp:*, subagent-results,
  web, skills, other-tool-results) and tokens >= LARGE_PAYLOAD_TOKENS (10_000)
  → one suggestion each: { kind: 'large-payload', itemIds: [it.id],
      reclaimableTokens: it.tokens, label: `${it.meta.toolName} output (turn ${it.turnIndex + 1})` }

redundantReads:
  group file-reads items by normalize(meta.filePath)     // resolve, strip trailing slash
  for each group with length >= 2, sorted by turnIndex ascending:
    reclaimable = sum(tokens of all but the LAST read)   // newest read is the live one
    → { kind: 'redundant-read', itemIds: group.map(id),
        reclaimableTokens: reclaimable, label: `${basename} read ×${group.length}` }

merge, sort by reclaimableTokens desc, cap at 10 suggestions.
Dedup rule: an item already covered by a redundant-read suggestion is excluded from
largePayloads (the read-group subsumes it).
```

Notes:
- Partial-range reads (`Read` with offset/limit) still group by path — re-reading a different
  range is *often* still redundant with a full earlier read; keep the heuristic simple and let
  the label carry the nuance later if users complain.
- `is_error` tool_results are never suggested (they're small and the retry context matters).
- No suggestion for `thinking`/`assistant-text` — the harness can't prune those selectively;
  suggestions must map to actions a user can actually take (`/compact`, avoiding re-reads).
