export interface RawContentBlock {
  type: string; // 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image' | future
  text?: string;
  thinking?: string;
  id?: string; // tool_use id
  name?: string; // tool_use name
  input?: unknown; // tool_use input
  tool_use_id?: string; // tool_result backref
  content?: string | RawContentBlock[]; // tool_result payload
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
  | {
      kind: 'message';
      type: 'assistant' | 'user';
      uuid: string;
      requestId?: string;
      timestamp?: string;
      version?: string;
      model?: string;
      isMeta: boolean;
      isCompactSummary: boolean;
      isSidechain: boolean;
      content: string | RawContentBlock[];
      usage?: RawUsage;
    }
  | { kind: 'compact-boundary'; timestamp?: string }
  | { kind: 'meta'; type: string; byteLength: number } // known non-window types
  | { kind: 'unknown'; type: string; byteLength: number } // unrecognized → 'unknown' bucket
  | { kind: 'invalid'; byteLength: number }; // unparseable line (never throw)
