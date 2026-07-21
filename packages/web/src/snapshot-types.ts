// COPY of packages/core/src/types.ts — keep in sync (checked by test)
/** Top-level source buckets. Order here = display order. */
export type BucketKey =
  | 'system-overhead' // computed remainder: system prompt + tool defs + unattributable
  | 'injected-context' // isMeta records, <system-reminder> blocks, compact summary
  | 'file-reads' // tool_result for Read
  | 'command-output' // tool_result for Bash
  | `mcp:${string}` // tool_result for mcp__<server>__*, one bucket per server
  | 'subagent-results' // tool_result for Agent/Task
  | 'web' // tool_result for WebFetch/WebSearch
  | 'skills' // tool_result for Skill
  | 'other-tool-results' // tool_result for any remaining tool
  | 'thinking' // thinking blocks
  | 'assistant-text' // text blocks in assistant messages
  | 'user-messages' // non-meta user text
  | 'tool-calls' // tool_use input blocks
  | 'images' // image blocks (flat per-image estimate)
  | 'unknown'; // unrecognized record types, raw byte size / 4

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
  label: string; // display name, e.g. "MCP: ado"
  tokens: number; // sum of item estimates; for 'system-overhead': the remainder
  /** tokens / snapshot.totalTokens (0..1). */
  share: number;
  items: Item[]; // sorted descending by tokens; empty for 'system-overhead'
}

/** One API turn (assistant records grouped by requestId). */
export interface Turn {
  index: number;
  requestId: string | null; // null for the synthetic "before first turn" point
  timestamp: string; // ISO, from the last record of the group
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
  label: string; // "Bash output (turn 12)" / "report.md read ×4"
  /** Estimated reclaimable tokens (redundant-read: all but the newest read). */
  reclaimableTokens: number;
}

export interface SessionSnapshot {
  sessionId: string;
  transcriptPath: string;
  claudeCodeVersion: string | null; // latest observed record .version
  model: string | null; // latest non-synthetic message.model
  /** Ground truth from the last assistant usage. 0 if no usage yet. */
  totalTokens: number;
  /** null when model unknown → UI shows absolute tokens, no gauge %. */
  windowLimit: number | null;
  buckets: Bucket[]; // always sums (incl. overhead) to totalTokens
  turns: Turn[];
  prune: PruneSuggestion[];
  /** Secondary stat: cacheRead / (input+cacheRead+cacheCreation) of the last turn. */
  cacheEfficiency: number | null;
  /** True when totalTokens === 0 (session exists, no assistant turn yet). */
  isEmpty: boolean;
}
