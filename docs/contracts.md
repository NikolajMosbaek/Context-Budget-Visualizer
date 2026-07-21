# Type contracts

The frozen seams. Opus implements against these exactly — copy the blocks into the named files
and fill in bodies. Changing a signature here requires updating this doc first (it is the
source of truth, tests are written against it). All code is ESM, strict TS.

## `packages/core/src/types.ts` — public domain model

```ts
/** Top-level source buckets. Order here = display order. */
export type BucketKey =
  | 'system-overhead'      // computed remainder: system prompt + tool defs + unattributable
  | 'injected-context'     // isMeta records, <system-reminder> blocks, compact summary
  | 'file-reads'           // tool_result for Read
  | 'command-output'       // tool_result for Bash
  | `mcp:${string}`        // tool_result for mcp__<server>__*, one bucket per server
  | 'subagent-results'     // tool_result for Agent/Task
  | 'web'                  // tool_result for WebFetch/WebSearch
  | 'skills'               // tool_result for Skill
  | 'other-tool-results'   // tool_result for any remaining tool
  | 'thinking'             // thinking blocks
  | 'assistant-text'       // text blocks in assistant messages
  | 'user-messages'        // non-meta user text
  | 'tool-calls'           // tool_use input blocks
  | 'images'               // image blocks (flat per-image estimate)
  | 'unknown';             // unrecognized record types, raw byte size / 4

/** One attributable content block (or unknown record). */
export interface Item {
  /** Stable identity: `${recordUuid}:${blockIndex}` — the animation & memo key. */
  id: string;
  bucket: BucketKey;
  /** Estimated tokens (js-tiktoken cl100k). Never displayed as authoritative. */
  tokens: number;
  /** Human label: file path for Read, command prefix for Bash, tool name, "thinking", … */
  label: string;
  /** requestId-group ordinal this block belongs to (index into turns). */
  turnIndex: number;
  /** Extra handles for prune heuristics. */
  meta?: { toolName?: string; filePath?: string; isError?: boolean };
}

export interface Bucket {
  key: BucketKey;
  label: string;               // display name, e.g. "MCP: ado"
  tokens: number;              // sum of item estimates; for 'system-overhead': the remainder
  /** tokens / snapshot.totalTokens (0..1). */
  share: number;
  items: Item[];               // sorted descending by tokens; empty for 'system-overhead'
}

/** One API turn (assistant records grouped by requestId). */
export interface Turn {
  index: number;
  requestId: string | null;    // null for the synthetic "before first turn" point
  timestamp: string;           // ISO, from the last record of the group
  /** Exact window occupancy at this turn: input + cache_creation + cache_read. */
  windowTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface PruneSuggestion {
  kind: 'large-payload' | 'redundant-read';
  /** Items involved; for redundant-read: all reads of the file, oldest first. */
  itemIds: string[];
  label: string;               // "Bash output (turn 12)" / "report.md read ×4"
  /** Estimated reclaimable tokens (redundant-read: all but the newest read). */
  reclaimableTokens: number;
}

export interface SessionSnapshot {
  sessionId: string;
  transcriptPath: string;
  claudeCodeVersion: string | null;   // latest observed record .version
  model: string | null;               // latest non-synthetic message.model
  /** Ground truth from the last assistant usage. 0 if no usage yet. */
  totalTokens: number;
  /** null when model unknown → UI shows absolute tokens, no gauge %. */
  windowLimit: number | null;
  buckets: Bucket[];                  // always sums (incl. overhead) to totalTokens
  turns: Turn[];
  prune: PruneSuggestion[];
  /** Secondary stat: cacheRead / (input+cacheRead+cacheCreation) of the last turn. */
  cacheEfficiency: number | null;
  /** True when totalTokens === 0 (session exists, no assistant turn yet). */
  isEmpty: boolean;
}
```

## `packages/core/src/transcript/schema.ts` — adapter-internal record types

The ONLY file (with parse.ts/locate.ts) that names raw JSONL fields. Everything is optional and
tolerant; see docs/transcript-schema.md for observed reality.

```ts
export interface RawContentBlock {
  type: string;                              // 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image' | future
  text?: string;
  thinking?: string;
  id?: string;                               // tool_use id
  name?: string;                             // tool_use name
  input?: unknown;                           // tool_use input
  tool_use_id?: string;                      // tool_result backref
  content?: string | RawContentBlock[];      // tool_result payload
  is_error?: boolean;
}

export interface RawUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  // richer fields (cache_creation, iterations, …) intentionally ignored
}

/** A parsed line. `kind` discriminates what the engine can do with it. */
export type ParsedRecord =
  | { kind: 'message'; type: 'assistant' | 'user'; uuid: string; requestId?: string;
      timestamp?: string; version?: string; model?: string; isMeta: boolean;
      isCompactSummary: boolean; isSidechain: boolean;
      content: string | RawContentBlock[]; usage?: RawUsage }
  | { kind: 'compact-boundary'; timestamp?: string }
  | { kind: 'meta'; type: string; byteLength: number }     // known non-window types
  | { kind: 'unknown'; type: string; byteLength: number }  // unrecognized → 'unknown' bucket
  | { kind: 'invalid'; byteLength: number };               // unparseable line (never throw)
```

## Adapter API — `packages/core/src/transcript/`

```ts
// locate.ts
export function encodeProjectPath(cwd: string): string;
export interface LocatedSession { sessionId: string; transcriptPath: string; sideDir: string }
/** Newest .jsonl directly in the encoded dir. Throws CtxvizError('no-session') if none. */
export function locateActiveSession(cwd: string, claudeHome?: string): LocatedSession;
/** Accepts a session uuid (searched across projects) or a direct file path. */
export function locateSession(idOrPath: string, claudeHome?: string): LocatedSession;

// parse.ts
export function parseLine(line: string): ParsedRecord;
/** Tolerant full-file parse; skips a trailing partial line (returns its byte offset). */
export function parseFile(path: string): { records: ParsedRecord[]; parsedUpTo: number };
```

## Engine API — `packages/core/src/`

```ts
// attribute.ts
export function snapshotFromRecords(
  records: ParsedRecord[],
  ctx: { sessionId: string; transcriptPath: string },
  opts?: { limitOverride?: number },
): SessionSnapshot;

// tokens.ts
/** Relative estimate; memoized by caller-provided key. */
export function estimateTokens(text: string): number;
export function estimateBlock(block: RawContentBlock): number;  // image → flat 1500

// prune.ts
export function computePrune(items: Item[], turns: Turn[]): PruneSuggestion[];

// models.ts
export function windowLimitFor(model: string | null): number | null;

// errors
export class CtxvizError extends Error { code: 'no-session' | 'not-found' | 'unreadable' }
```

Semantics pinned by tests (see fixtures README):
- `snapshotFromRecords` never throws on weird content; `invalid`/`unknown` land in the
  `unknown` bucket by `byteLength / 4`.
- Bucket invariant: `sum(buckets[].tokens) === totalTokens` exactly; `system-overhead.tokens =
  max(0, totalTokens − sum(attributed))`. If attributed > total (estimator overshoot), scale
  attributed buckets proportionally so the invariant still holds, and set overhead to 0.
- Only records after the latest `compact-boundary` are attributed (plus the compact summary).
- `isMeta` / compact-summary / `<system-reminder>`-prefixed text blocks → `injected-context`.
- MCP bucket key: `mcp:${server}` where server = segment between `mcp__` and the next `__`.

## Server wire format — `packages/cli`

```
GET /api/snapshot        → SessionSnapshot (JSON)
GET /api/stream          → SSE; events: `snapshot` (data: SessionSnapshot JSON),
                           `session-changed` (data: {sessionId}); heartbeat comment every 15s
GET /*                   → static web bundle
```

The web app consumes `SessionSnapshot` verbatim — it does not recompute, only renders and diffs
by `Item.id` / `Bucket.key`.

## CLI surface (frozen for M2)

```
ctxviz                       live-tail active session, serve dashboard, open browser
ctxviz report                one-shot terminal breakdown (works on finished sessions)
  --session <id|path>        explicit session (both modes)
  --project <path>           project dir to resolve the active session for (default: cwd)
  --port <n>                 default 4317        --no-open
  --limit <tokens>           override window limit
```
