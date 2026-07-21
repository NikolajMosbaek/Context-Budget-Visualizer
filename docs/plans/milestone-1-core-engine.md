# Milestone 1: Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@windowpane/core` turns a transcript into a `SessionSnapshot` whose buckets sum exactly to the reported total, tested against every fixture.

**Architecture:** Tolerant parser adapter (`transcript/`) → pure attribution (`attribute.ts`) anchored to the exact `usage` total → prune heuristics. No file except `transcript/*` names a raw JSONL field. Types come verbatim from `docs/contracts.md`.

**Tech Stack:** TypeScript strict ESM, js-tiktoken (cl100k), Vitest, fixtures in `test/fixtures/`.

## Global Constraints

- Signatures MUST match `docs/contracts.md` exactly (it wins over this plan on conflict)
- Never throw on malformed input — `invalid`/`unknown` kinds instead (schema doc, CLAUDE.md)
- `sum(buckets[].tokens) === totalTokens` exactly, on every path (scaling rule below)
- Skip any record with `isSidechain: true` everywhere (belt-and-suspenders; see transcript-schema.md)
- No new dependencies beyond `js-tiktoken` (already declared in M0)

---

### Task 1: Domain types, errors, and raw-record schema

**Files:**
- Create: `packages/core/src/types.ts`, `packages/core/src/errors.ts`, `packages/core/src/transcript/schema.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces: everything in `docs/contracts.md` §types.ts and §schema.ts — copy those code blocks **verbatim** into the two files.

- [ ] **Step 1: Copy the two contract blocks**

Copy `docs/contracts.md` § "packages/core/src/types.ts" block → `packages/core/src/types.ts`, and § "packages/core/src/transcript/schema.ts" block → `packages/core/src/transcript/schema.ts`, unchanged.

- [ ] **Step 2: Write errors.ts**

```ts
export type CtxvizErrorCode = 'no-session' | 'not-found' | 'unreadable';

export class CtxvizError extends Error {
  constructor(
    public readonly code: CtxvizErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CtxvizError';
  }
}
```

- [ ] **Step 3: Re-export from index.ts** (replace skeleton content)

```ts
export * from './types.js';
export * from './errors.js';
export type { ParsedRecord, RawContentBlock, RawUsage } from './transcript/schema.js';
```

- [ ] **Step 4: Verify it compiles, commit**

Run: `pnpm --filter @windowpane/core build` → succeeds.
```bash
git add packages/core && git commit -m "feat(core): domain types, errors, raw record schema" && git push
```

### Task 2: Tolerant line/file parser

**Files:**
- Create: `packages/core/src/transcript/parse.ts`
- Test: `packages/core/test/parse.test.ts`

**Interfaces:**
- Consumes: `ParsedRecord` union from Task 1.
- Produces: `parseLine(line: string): ParsedRecord`; `parseFile(path: string): { records: ParsedRecord[]; parsedUpTo: number }` (byte offset after the last complete line — M4's watcher resumes from it).

- [ ] **Step 1: Write the failing tests**

```ts
// packages/core/test/parse.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseFile, parseLine } from '../src/transcript/parse.js';

const FIX = join(import.meta.dirname, 'fixtures');

describe('parseLine', () => {
  test('assistant record → message with usage and requestId', () => {
    const line = readFileSync(join(FIX, 'basic.jsonl'), 'utf8').split('\n')[2]!;
    const r = parseLine(line);
    expect(r.kind).toBe('message');
    if (r.kind !== 'message') return;
    expect(r.type).toBe('assistant');
    expect(r.requestId).toBe('req_001');
    expect(r.usage?.cache_read_input_tokens).toBe(4000);
    expect(r.model).toBe('claude-opus-4-8');
  });

  test('invalid JSON → invalid with byteLength, never throws', () => {
    const r = parseLine('this line is not valid json at all {{{');
    expect(r).toEqual({ kind: 'invalid', byteLength: 39 });
  });

  test('unknown type → unknown; known meta → meta; compact boundary detected', () => {
    expect(parseLine('{"type":"flux-capacitor","x":1}').kind).toBe('unknown');
    expect(parseLine('{"type":"bridge-session","bridgeSessionId":"b"}').kind).toBe('meta');
    expect(parseLine('{"type":"mode","mode":"default"}').kind).toBe('meta');
    expect(
      parseLine('{"type":"system","subtype":"compact_boundary","content":"Conversation compacted"}').kind,
    ).toBe('compact-boundary');
    expect(parseLine('{"type":"system","subtype":"other"}').kind).toBe('meta');
  });

  test('isMeta / isCompactSummary / isSidechain flags surface', () => {
    const meta = parseLine(
      '{"type":"user","uuid":"u","isMeta":true,"message":{"role":"user","content":"x"}}',
    );
    expect(meta.kind === 'message' && meta.isMeta).toBe(true);
    const side = parseLine(
      '{"type":"assistant","uuid":"a","isSidechain":true,"message":{"role":"assistant","content":[]}}',
    );
    expect(side.kind === 'message' && side.isSidechain).toBe(true);
  });
});

describe('parseFile', () => {
  test('parses all fixture lines, tolerates the invalid line', () => {
    const { records } = parseFile(join(FIX, 'unknown-types.jsonl'));
    expect(records.map((r) => r.kind)).toEqual([
      'meta', 'unknown', 'invalid', 'message', 'message', 'message',
    ]);
  });

  test('trailing partial line is not parsed; parsedUpTo points after last newline', () => {
    const full = readFileSync(join(FIX, 'no-usage.jsonl'));
    const partial = Buffer.concat([full, Buffer.from('{"type":"user","incomple')]);
    const tmp = join(import.meta.dirname, 'tmp-partial.jsonl');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('node:fs').writeFileSync(tmp, partial);
    const { records, parsedUpTo } = parseFile(tmp);
    expect(records).toHaveLength(2);
    expect(parsedUpTo).toBe(full.length);
    require('node:fs').unlinkSync(tmp);
  });
});
```

(Use `import { writeFileSync, unlinkSync } from 'node:fs'` instead of require — shown here compressed; the implementer writes proper imports.)

- [ ] **Step 2: Run tests, verify they fail** — `pnpm vitest run packages/core/test/parse.test.ts` → module-not-found failures.

- [ ] **Step 3: Implement parse.ts**

```ts
import { readFileSync } from 'node:fs';
import type { ParsedRecord } from './schema.js';

/** Record types that are known harness metadata — never window content. */
const KNOWN_META_TYPES = new Set([
  'attachment', 'mode', 'last-prompt', 'bridge-session', 'permission-mode', 'pr-link',
  'queue-operation', 'file-history-snapshot', 'file-history-delta', 'custom-title',
  'agent-name', 'agent-color', 'frame-link', 'system',
]);

export function parseLine(line: string): ParsedRecord {
  const byteLength = Buffer.byteLength(line, 'utf8');
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return { kind: 'invalid', byteLength };
    obj = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'invalid', byteLength };
  }
  const type = obj.type;
  if (typeof type !== 'string') return { kind: 'invalid', byteLength };

  if (type === 'system' && obj.subtype === 'compact_boundary') {
    return { kind: 'compact-boundary', timestamp: obj.timestamp as string | undefined };
  }
  if (type === 'assistant' || type === 'user') {
    const msg = obj.message as Record<string, unknown> | undefined;
    const content = msg?.content;
    if (!msg || (typeof content !== 'string' && !Array.isArray(content))) {
      return { kind: 'unknown', type, byteLength };
    }
    return {
      kind: 'message',
      type,
      uuid: String(obj.uuid ?? ''),
      requestId: obj.requestId as string | undefined,
      timestamp: obj.timestamp as string | undefined,
      version: obj.version as string | undefined,
      model: msg.model as string | undefined,
      isMeta: obj.isMeta === true,
      isCompactSummary: obj.isCompactSummary === true,
      isSidechain: obj.isSidechain === true,
      content: content as ParsedRecord extends never ? never : never, // ← implementer: type as `string | RawContentBlock[]`
      usage: msg.usage as never, // ← implementer: type as `RawUsage | undefined`
    } as ParsedRecord;
  }
  if (KNOWN_META_TYPES.has(type)) return { kind: 'meta', type, byteLength };
  return { kind: 'unknown', type, byteLength };
}

export function parseFile(path: string): { records: ParsedRecord[]; parsedUpTo: number } {
  const buf = readFileSync(path);
  const records: ParsedRecord[] = [];
  let start = 0;
  let parsedUpTo = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const line = buf.subarray(start, i).toString('utf8');
      if (line.trim() !== '') records.push(parseLine(line));
      start = i + 1;
      parsedUpTo = start;
    }
  }
  return { records, parsedUpTo };
}
```

(The two `as never` casts are placeholders for the implementer to replace with clean typed extraction — the final file must have zero `as never`/`any`; shape the return with a properly-typed intermediate variable instead.)

- [ ] **Step 4: Run tests → PASS.** `pnpm vitest run packages/core/test/parse.test.ts`

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): tolerant JSONL parser (line + file, partial-line safe)" && git push`

### Task 3: Session locating

**Files:**
- Create: `packages/core/src/transcript/locate.ts`
- Test: `packages/core/test/locate.test.ts`

**Interfaces:**
- Produces: `encodeProjectPath(cwd)`, `locateActiveSession(cwd, claudeHome?)`, `locateSession(idOrPath, claudeHome?)` per contracts.md; `LocatedSession { sessionId, transcriptPath, sideDir }`.

- [ ] **Step 1: Failing tests** — build a fake `claudeHome` in a temp dir:

```ts
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { encodeProjectPath, locateActiveSession, locateSession } from '../src/transcript/locate.js';
import { CtxvizError } from '../src/errors.js';

const home = mkdtempSync(join(tmpdir(), 'ctxviz-'));
const proj = join(home, 'projects', encodeProjectPath('/tmp/my.proj'));
mkdirSync(proj, { recursive: true });
writeFileSync(join(proj, 'aaa.jsonl'), '{}\n');
writeFileSync(join(proj, 'bbb.jsonl'), '{}\n');
utimesSync(join(proj, 'aaa.jsonl'), new Date(), new Date(Date.now() + 60_000)); // aaa newest
mkdirSync(join(proj, 'bbb'), { recursive: true }); // side dir must not confuse locating
afterAll(() => rmSync(home, { recursive: true, force: true }));

test('encodeProjectPath replaces every non-alphanumeric with dash', () => {
  expect(encodeProjectPath('/Users/x/my.proj_dir')).toBe('-Users-x-my-proj-dir');
});

test('locateActiveSession picks newest .jsonl and derives sideDir', () => {
  const s = locateActiveSession('/tmp/my.proj', home);
  expect(s.sessionId).toBe('aaa');
  expect(s.transcriptPath).toBe(join(proj, 'aaa.jsonl'));
  expect(s.sideDir).toBe(join(proj, 'aaa'));
});

test('locateActiveSession throws no-session for unknown project', () => {
  expect(() => locateActiveSession('/nowhere', home)).toThrowError(CtxvizError);
});

test('locateSession resolves by id across projects and by direct path', () => {
  expect(locateSession('bbb', home).transcriptPath).toBe(join(proj, 'bbb.jsonl'));
  expect(locateSession(join(proj, 'bbb.jsonl'), home).sessionId).toBe('bbb');
  expect(() => locateSession('zzz', home)).toThrowError(CtxvizError);
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CtxvizError } from '../errors.js';

export interface LocatedSession { sessionId: string; transcriptPath: string; sideDir: string }

const defaultHome = () => join(homedir(), '.claude');

export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function fromPath(transcriptPath: string): LocatedSession {
  const sessionId = basename(transcriptPath).replace(/\.jsonl$/, '');
  return { sessionId, transcriptPath, sideDir: join(dirname(transcriptPath), sessionId) };
}

export function locateActiveSession(cwd: string, claudeHome = defaultHome()): LocatedSession {
  const dir = join(claudeHome, 'projects', encodeProjectPath(cwd));
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    throw new CtxvizError('no-session', `no Claude Code transcripts found for ${cwd}`);
  }
  const newest = names
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) throw new CtxvizError('no-session', `no .jsonl sessions in ${dir}`);
  return fromPath(join(dir, newest.f));
}

export function locateSession(idOrPath: string, claudeHome = defaultHome()): LocatedSession {
  if (idOrPath.endsWith('.jsonl') && existsSync(idOrPath)) return fromPath(idOrPath);
  const projectsDir = join(claudeHome, 'projects');
  let projects: string[] = [];
  try { projects = readdirSync(projectsDir); } catch { /* fall through to not-found */ }
  for (const p of projects) {
    const candidate = join(projectsDir, p, `${idOrPath}.jsonl`);
    if (existsSync(candidate)) return fromPath(candidate);
  }
  throw new CtxvizError('not-found', `session "${idOrPath}" not found`);
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `git add -A && git commit -m "feat(core): session locating (active + by id/path)" && git push`

### Task 4: Token estimation + model table

**Files:**
- Create: `packages/core/src/tokens.ts`, `packages/core/src/models.ts`
- Test: `packages/core/test/tokens-models.test.ts`

**Interfaces:**
- Produces: `estimateTokens(text): number` (memoized internally, cap 50K entries), `estimateBlock(block): number`, `IMAGE_TOKENS = 1500`, `windowLimitFor(model): number | null`.

- [ ] **Step 1: Failing tests**

```ts
import { expect, test } from 'vitest';
import { estimateBlock, estimateTokens, IMAGE_TOKENS } from '../src/tokens.js';
import { windowLimitFor } from '../src/models.js';

test('estimateTokens is roughly chars/4 for prose and deterministic', () => {
  const t = estimateTokens('The quick brown fox jumps over the lazy dog.');
  expect(t).toBeGreaterThan(5);
  expect(t).toBeLessThan(20);
  expect(estimateTokens('The quick brown fox jumps over the lazy dog.')).toBe(t);
});

test('estimateBlock per block type', () => {
  expect(estimateBlock({ type: 'image' })).toBe(IMAGE_TOKENS);
  expect(estimateBlock({ type: 'text', text: 'hello world' })).toBe(estimateTokens('hello world'));
  expect(estimateBlock({ type: 'thinking', thinking: 'hmm' })).toBe(estimateTokens('hmm'));
  expect(estimateBlock({ type: 'tool_use', name: 'Read', input: { file_path: '/a' } })).toBeGreaterThan(0);
  expect(estimateBlock({ type: 'wat' })).toBeGreaterThan(0); // stringify/4 fallback
});

test('windowLimitFor: known prefixes, unknown null', () => {
  expect(windowLimitFor('claude-opus-4-8')).toBe(1_000_000);
  expect(windowLimitFor('claude-fable-5')).toBe(1_000_000);
  expect(windowLimitFor('claude-haiku-4-5-20251001')).toBe(200_000);
  expect(windowLimitFor('claude-sonnet-4-5')).toBe(200_000);
  expect(windowLimitFor('experimental-model-x')).toBeNull();
  expect(windowLimitFor(null)).toBeNull();
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

`tokens.ts`:
```ts
import { Tiktoken } from 'js-tiktoken/lite';
import cl100k from 'js-tiktoken/ranks/cl100k_base';
import type { RawContentBlock } from './transcript/schema.js';

const enc = new Tiktoken(cl100k);
export const IMAGE_TOKENS = 1500;

const cache = new Map<string, number>();
const CACHE_CAP = 50_000;

export function estimateTokens(text: string): number {
  const key = text.length < 256 ? text : `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const n = enc.encode(text).length;
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
  cache.set(key, n);
  return n;
}

export function estimateBlock(block: RawContentBlock): number {
  switch (block.type) {
    case 'text': return estimateTokens(block.text ?? '');
    case 'thinking': return estimateTokens(block.thinking ?? '');
    case 'tool_use': return estimateTokens(`${block.name ?? ''} ${JSON.stringify(block.input ?? '')}`);
    case 'image': return IMAGE_TOKENS;
    default: return Math.ceil(JSON.stringify(block).length / 4);
  }
}
```

⚠️ Cache-key note: the long-text key includes length + head + tail — collisions are possible in
theory but require identical length AND identical 128 boundary chars; acceptable for estimates.

`models.ts`:
```ts
const TABLE: ReadonlyArray<readonly [prefix: string, limit: number]> = [
  ['claude-fable-5', 1_000_000],
  ['claude-mythos-5', 1_000_000],
  ['claude-opus-4-8', 1_000_000],
  ['claude-opus-4-7', 1_000_000],
  ['claude-opus-4-6', 1_000_000],
  ['claude-sonnet-5', 1_000_000],
  ['claude-sonnet-4-6', 1_000_000],
  ['claude-sonnet-4-5', 200_000],
  ['claude-opus-4-5', 200_000],
  ['claude-haiku-4-5', 200_000],
];

export function windowLimitFor(model: string | null): number | null {
  if (!model) return null;
  let best: number | null = null;
  let bestLen = -1;
  for (const [prefix, limit] of TABLE) {
    if (model.startsWith(prefix) && prefix.length > bestLen) { best = limit; bestLen = prefix.length; }
  }
  return best;
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `git add -A && git commit -m "feat(core): token estimation (memoized) + model window-limit table" && git push`

### Task 5: Attribution engine

**Files:**
- Create: `packages/core/src/attribute.ts`
- Test: `packages/core/test/attribute.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `snapshotFromRecords(records, ctx, opts?) : SessionSnapshot` — the contract's edge-case semantics (sum-to-total via floor-scaling, compaction cutoff, isEmpty) are pinned by these tests.

- [ ] **Step 1: Failing tests — encode the fixtures README assertions**

```ts
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { snapshotFromRecords } from '../src/attribute.js';
import { parseFile } from '../src/transcript/parse.js';
import type { SessionSnapshot } from '../src/types.js';

const FIX = join(import.meta.dirname, 'fixtures');
const snap = (name: string): SessionSnapshot =>
  snapshotFromRecords(parseFile(join(FIX, `${name}.jsonl`)).records, {
    sessionId: `fixture-${name}`,
    transcriptPath: join(FIX, `${name}.jsonl`),
  });
const sumBuckets = (s: SessionSnapshot) => s.buckets.reduce((a, b) => a + b.tokens, 0);
const bucket = (s: SessionSnapshot, key: string) => s.buckets.find((b) => b.key === key);

describe('universal invariant', () => {
  for (const f of ['basic', 'no-usage', 'multi-mcp', 'compaction', 'unknown-types', 'redundant-reads']) {
    test(`${f}: buckets sum exactly to totalTokens, none negative`, () => {
      const s = snap(f);
      expect(sumBuckets(s)).toBe(s.totalTokens);
      expect(s.buckets.every((b) => b.tokens >= 0)).toBe(true);
    });
  }
});

describe('basic.jsonl', () => {
  const s = snap('basic');
  test('exact total from last requestId group, not a sum over records', () => {
    expect(s.totalTokens).toBe(9120);
  });
  test('two turns with correct window occupancy', () => {
    expect(s.turns.map((t) => t.windowTokens)).toEqual([5000, 9120]);
  });
  test('model + limit + cache efficiency', () => {
    expect(s.model).toBe('claude-opus-4-8');
    expect(s.windowLimit).toBe(1_000_000);
    expect(s.cacheEfficiency).toBeCloseTo(8000 / 9120, 5);
  });
  test('expected buckets present; overhead positive; file read labeled', () => {
    expect(bucket(s, 'file-reads')!.items[0]!.label).toContain('config.json');
    for (const k of ['thinking', 'assistant-text', 'user-messages', 'tool-calls']) {
      expect(bucket(s, k)!.tokens).toBeGreaterThan(0);
    }
    expect(bucket(s, 'system-overhead')!.tokens).toBeGreaterThan(0);
  });
});

describe('no-usage.jsonl', () => {
  const s = snap('no-usage');
  test('isEmpty semantics', () => {
    expect(s.isEmpty).toBe(true);
    expect(s.totalTokens).toBe(0);
    expect(s.turns).toHaveLength(0);
    expect(s.prune).toHaveLength(0);
    expect(sumBuckets(s)).toBe(0);
  });
});

describe('multi-mcp.jsonl', () => {
  const s = snap('multi-mcp');
  test('per-server buckets, image folded into the tool item', () => {
    expect(bucket(s, 'mcp:ado')!.items).toHaveLength(1);
    expect(bucket(s, 'mcp:figma')!.items).toHaveLength(1);
    expect(bucket(s, 'mcp:figma')!.items[0]!.tokens).toBeGreaterThan(1500); // image + text
  });
  test('fable model resolves 1M limit', () => {
    expect(s.windowLimit).toBe(1_000_000);
  });
});

describe('compaction.jsonl', () => {
  const s = snap('compaction');
  test('nothing pre-boundary is attributed', () => {
    const allLabels = s.buckets.flatMap((b) => b.items.map((i) => i.label)).join(' ');
    expect(allLabels).not.toContain('PRE-BOUNDARY');
    expect(allLabels).toContain('POST-BOUNDARY');
  });
  test('summary → injected-context; total from post-boundary usage; turns keep history', () => {
    expect(bucket(s, 'injected-context')!.tokens).toBeGreaterThan(0);
    expect(s.totalTokens).toBe(31_650);
    expect(s.turns).toHaveLength(2);
  });
});

describe('unknown-types.jsonl', () => {
  const s = snap('unknown-types');
  test('unknown record + invalid line + unknown block → unknown bucket; meta types absent', () => {
    expect(bucket(s, 'unknown')!.items.length).toBe(3);
  });
  test('isMeta system-reminder → injected-context, not user-messages', () => {
    expect(bucket(s, 'injected-context')!.tokens).toBeGreaterThan(0);
    expect(bucket(s, 'user-messages')!.items).toHaveLength(1);
  });
  test('unknown model → null limit', () => {
    expect(s.windowLimit).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement attribute.ts**

Follow this structure exactly (complete logic; keep helper functions file-local):

```ts
import { basename } from 'node:path';
import { windowLimitFor } from './models.js';
import { computePrune } from './prune.js';
import { estimateBlock, estimateTokens, IMAGE_TOKENS } from './tokens.js';
import type { ParsedRecord, RawContentBlock, RawUsage } from './transcript/schema.js';
import type { Bucket, BucketKey, Item, SessionSnapshot, Turn } from './types.js';

const INJECTED_PREFIXES = ['<system-reminder', '<local-command-caveat'];

function toolBucket(name: string): BucketKey {
  if (name === 'Read') return 'file-reads';
  if (name === 'Bash') return 'command-output';
  if (name.startsWith('mcp__')) {
    const rest = name.slice('mcp__'.length);
    const cut = rest.indexOf('__');
    return `mcp:${cut === -1 ? rest : rest.slice(0, cut)}`;
  }
  if (name === 'Agent' || name === 'Task') return 'subagent-results';
  if (name === 'WebFetch' || name === 'WebSearch') return 'web';
  if (name === 'Skill') return 'skills';
  return 'other-tool-results';
}

function usageTotal(u: RawUsage): number {
  return (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
}

function resultTokens(content: string | RawContentBlock[] | undefined): number {
  if (content === undefined) return 0;
  if (typeof content === 'string') return estimateTokens(content);
  return content.reduce((sum, b) => sum + estimateBlock(b), 0);
}

export function snapshotFromRecords(
  records: ParsedRecord[],
  ctx: { sessionId: string; transcriptPath: string },
  opts?: { limitOverride?: number },
): SessionSnapshot {
  // ---- pass 1: boundary, tool index, turns, latest usage/model/version
  let boundaryIdx = -1;
  records.forEach((r, i) => { if (r.kind === 'compact-boundary') boundaryIdx = i; });

  const toolUseInfo = new Map<string, { name: string; input: unknown; turnIndex: number }>();
  const turnOrder: string[] = [];
  const turnByRid = new Map<string, Turn>();
  let lastUsage: RawUsage | undefined;
  let model: string | null = null;
  let version: string | null = null;

  for (const r of records) {
    if (r.kind !== 'message' || r.isSidechain) continue;
    if (r.version) version = r.version;
    if (r.type !== 'assistant') continue;
    if (r.model && r.model !== '<synthetic>') model = r.model;
    const rid = r.requestId ?? `anon-${turnOrder.length}`;
    if (!turnByRid.has(rid)) {
      turnOrder.push(rid);
      turnByRid.set(rid, {
        index: turnOrder.length - 1, requestId: r.requestId ?? null,
        timestamp: r.timestamp ?? '', windowTokens: 0, outputTokens: 0,
        cacheReadTokens: 0, cacheCreationTokens: 0,
      });
    }
    const t = turnByRid.get(rid)!;
    if (r.timestamp) t.timestamp = r.timestamp;
    if (r.usage) {
      lastUsage = r.usage;
      t.windowTokens = usageTotal(r.usage);
      t.outputTokens = r.usage.output_tokens ?? 0;
      t.cacheReadTokens = r.usage.cache_read_input_tokens ?? 0;
      t.cacheCreationTokens = r.usage.cache_creation_input_tokens ?? 0;
    }
    if (Array.isArray(r.content)) {
      for (const b of r.content) {
        if (b.type === 'tool_use' && b.id && b.name) {
          toolUseInfo.set(b.id, { name: b.name, input: b.input, turnIndex: turnByRid.get(rid)!.index });
        }
      }
    }
  }
  const turns = turnOrder.map((rid) => turnByRid.get(rid)!);
  const totalTokens = lastUsage ? usageTotal(lastUsage) : 0;
  const isEmpty = totalTokens === 0;

  // ---- pass 2: items (post-boundary only)
  const items: Item[] = [];
  let currentTurn = 0;
  records.forEach((r, idx) => {
    if (r.kind === 'message' && !r.isSidechain && r.type === 'assistant' && r.requestId) {
      currentTurn = turnByRid.get(r.requestId)?.index ?? currentTurn;
    }
    if (idx <= boundaryIdx || isEmpty) return;
    if (r.kind === 'unknown' || r.kind === 'invalid') {
      items.push({
        id: `raw-${idx}`, bucket: 'unknown', tokens: Math.ceil(r.byteLength / 4),
        label: r.kind === 'unknown' ? `unknown record: ${r.type}` : 'unparseable line',
        turnIndex: currentTurn,
      });
      return;
    }
    if (r.kind !== 'message' || r.isSidechain) return;

    const injectedWhole = r.isMeta || r.isCompactSummary;
    const blocks: RawContentBlock[] =
      typeof r.content === 'string' ? [{ type: 'text', text: r.content }] : r.content;

    blocks.forEach((b, bi) => {
      const id = `${r.uuid}:${bi}`;
      const push = (bucket: BucketKey, tokens: number, label: string, meta?: Item['meta']) =>
        items.push({ id, bucket, tokens, label, turnIndex: currentTurn, meta });

      if (b.type === 'tool_result') {
        const info = b.tool_use_id ? toolUseInfo.get(b.tool_use_id) : undefined;
        const name = info?.name ?? 'unknown-tool';
        const input = (info?.input ?? {}) as Record<string, unknown>;
        const filePath = name === 'Read' && typeof input.file_path === 'string' ? input.file_path : undefined;
        const label =
          filePath ??
          (name === 'Bash' && typeof input.command === 'string'
            ? `$ ${input.command.slice(0, 40)}`
            : `${name} result`);
        push(toolBucket(name), resultTokens(b.content), label, {
          toolName: name, filePath, isError: b.is_error === true,
        });
        return;
      }
      const injected =
        injectedWhole ||
        (b.type === 'text' && INJECTED_PREFIXES.some((p) => (b.text ?? '').startsWith(p)));
      if (injected) { push('injected-context', estimateBlock(b), 'injected context'); return; }

      switch (b.type) {
        case 'thinking': push('thinking', estimateBlock(b), `thinking (turn ${currentTurn + 1})`); break;
        case 'text':
          push(r.type === 'assistant' ? 'assistant-text' : 'user-messages', estimateBlock(b),
            (b.text ?? '').slice(0, 48) || '(empty)');
          break;
        case 'tool_use': push('tool-calls', estimateBlock(b), `${b.name ?? '?'} call`); break;
        case 'image': push('images', IMAGE_TOKENS, 'image'); break;
        default: push('unknown', estimateBlock(b), `unknown block: ${b.type}`);
      }
    });
  });

  // ---- pass 3: scale to invariant, assemble buckets
  const attributed = items.reduce((s, i) => s + i.tokens, 0);
  if (attributed > totalTokens && attributed > 0) {
    const f = totalTokens / attributed;
    for (const it of items) it.tokens = Math.floor(it.tokens * f);
  }
  const byBucket = new Map<BucketKey, Item[]>();
  for (const it of items) {
    const list = byBucket.get(it.bucket) ?? [];
    list.push(it);
    byBucket.set(it.bucket, list);
  }
  const DISPLAY: BucketKey[] = ['file-reads', 'command-output', 'subagent-results', 'web',
    'skills', 'other-tool-results', 'thinking', 'assistant-text', 'user-messages',
    'tool-calls', 'images', 'injected-context', 'unknown'];
  const mcpKeys = [...byBucket.keys()].filter((k) => k.startsWith('mcp:'))
    .sort((a, b) => sum(byBucket.get(b)!) - sum(byBucket.get(a)!));
  const orderedKeys: BucketKey[] = [...DISPLAY.slice(0, 2), ...mcpKeys, ...DISPLAY.slice(2)];

  const buckets: Bucket[] = [];
  for (const key of orderedKeys) {
    const its = (byBucket.get(key) ?? []).sort((a, b) => b.tokens - a.tokens);
    const tokens = sum(its);
    if (its.length === 0) continue; // empty buckets are omitted (overhead is added below regardless)
    buckets.push({ key, label: labelFor(key), tokens, share: totalTokens ? tokens / totalTokens : 0, items: its });
  }
  const attributedFinal = buckets.reduce((s, b) => s + b.tokens, 0);
  buckets.unshift({
    key: 'system-overhead', label: 'System & tool definitions',
    tokens: Math.max(0, totalTokens - attributedFinal),
    share: totalTokens ? Math.max(0, totalTokens - attributedFinal) / totalTokens : 0, items: [],
  });

  const cacheEfficiency =
    lastUsage && usageTotal(lastUsage) > 0
      ? (lastUsage.cache_read_input_tokens ?? 0) / usageTotal(lastUsage)
      : null;

  return {
    sessionId: ctx.sessionId, transcriptPath: ctx.transcriptPath,
    claudeCodeVersion: version, model, totalTokens,
    windowLimit: opts?.limitOverride ?? windowLimitFor(model),
    buckets, turns, prune: computePrune(items, turns), cacheEfficiency, isEmpty,
  };
}

function sum(items: Item[]): number { return items.reduce((s, i) => s + i.tokens, 0); }

function labelFor(key: BucketKey): string {
  if (key.startsWith('mcp:')) return `MCP: ${key.slice(4)}`;
  const names: Record<string, string> = {
    'system-overhead': 'System & tool definitions', 'injected-context': 'Injected context',
    'file-reads': 'File reads', 'command-output': 'Command output',
    'subagent-results': 'Subagents', web: 'Web', skills: 'Skills',
    'other-tool-results': 'Other tool results', thinking: 'Thinking',
    'assistant-text': 'Assistant text', 'user-messages': 'User messages',
    'tool-calls': 'Tool calls', images: 'Images', unknown: 'Unknown',
  };
  return names[key] ?? key;
}
```

Implementer notes (bugs the tests will catch if missed): `basename` import is used by prune, not here — drop it; empty-bucket filtering must still let the `unknown-types` test find `user-messages` with 1 item; `no-usage` short-circuits item collection via `isEmpty` so buckets is just the zero-overhead bucket → sum 0 ✓.

- [ ] **Step 4: Run → PASS** (prune.ts must exist as a stub first — write `export function computePrune(): PruneSuggestion[] { return []; }` temporarily; Task 6 replaces it).

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): attribution engine — buckets sum exactly to usage total" && git push`

### Task 6: Prune heuristics

**Files:**
- Create: `packages/core/src/prune.ts` (replace stub)
- Test: `packages/core/test/prune.test.ts`

**Interfaces:**
- Produces: `computePrune(items: Item[], turns: Turn[]): PruneSuggestion[]` per docs/algorithms.md §3 — `LARGE_PAYLOAD_TOKENS = 10_000`, redundant-read groups by normalized path, dedup, sort desc, cap 10.

- [ ] **Step 1: Failing test**

```ts
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { snapshotFromRecords } from '../src/attribute.js';
import { parseFile } from '../src/transcript/parse.js';

const s = snapshotFromRecords(
  parseFile(join(import.meta.dirname, 'fixtures/redundant-reads.jsonl')).records,
  { sessionId: 'fixture-prune', transcriptPath: 'fixtures/redundant-reads.jsonl' },
);

test('redundant read: 3 reads grouped, reclaimable = all but newest', () => {
  const rr = s.prune.find((p) => p.kind === 'redundant-read')!;
  expect(rr.itemIds).toHaveLength(3);
  expect(rr.label).toBe('notes.md read ×3');
  const readItems = s.buckets.find((b) => b.key === 'file-reads')!.items
    .filter((i) => i.meta?.filePath === '/tmp/proj/notes.md')
    .sort((a, b) => a.turnIndex - b.turnIndex);
  expect(rr.reclaimableTokens).toBe(readItems[0]!.tokens + readItems[1]!.tokens);
});

test('large payload: the 48K-char bash output is flagged', () => {
  const lp = s.prune.find((p) => p.kind === 'large-payload')!;
  expect(lp.label).toMatch(/^Bash output \(turn \d+\)$/);
  expect(lp.reclaimableTokens).toBeGreaterThanOrEqual(10_000);
});

test('sorted by reclaimable desc', () => {
  const vals = s.prune.map((p) => p.reclaimableTokens);
  expect([...vals].sort((a, b) => b - a)).toEqual(vals);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — exactly the pseudocode in docs/algorithms.md §3:

```ts
import { basename } from 'node:path';
import type { Item, PruneSuggestion, Turn } from './types.js';

const LARGE_PAYLOAD_TOKENS = 10_000;
const RESULT_BUCKETS = new Set(['file-reads', 'command-output', 'subagent-results', 'web', 'skills', 'other-tool-results']);
const isResultBucket = (k: string) => RESULT_BUCKETS.has(k) || k.startsWith('mcp:');

export function computePrune(items: Item[], _turns: Turn[]): PruneSuggestion[] {
  const out: PruneSuggestion[] = [];
  const covered = new Set<string>();

  const reads = new Map<string, Item[]>();
  for (const it of items) {
    if (it.bucket === 'file-reads' && it.meta?.filePath && !it.meta.isError) {
      const key = it.meta.filePath.replace(/\/+$/, '');
      (reads.get(key) ?? reads.set(key, []).get(key)!).push(it);
    }
  }
  for (const [path, group] of reads) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.turnIndex - b.turnIndex);
    out.push({
      kind: 'redundant-read',
      itemIds: group.map((g) => g.id),
      label: `${basename(path)} read ×${group.length}`,
      reclaimableTokens: group.slice(0, -1).reduce((s, g) => s + g.tokens, 0),
    });
    for (const g of group) covered.add(g.id);
  }
  for (const it of items) {
    if (!isResultBucket(it.bucket) || covered.has(it.id) || it.meta?.isError) continue;
    if (it.tokens < LARGE_PAYLOAD_TOKENS) continue;
    out.push({
      kind: 'large-payload',
      itemIds: [it.id],
      label: `${it.meta?.toolName ?? 'tool'} output (turn ${it.turnIndex + 1})`,
      reclaimableTokens: it.tokens,
    });
  }
  return out.sort((a, b) => b.reclaimableTokens - a.reclaimableTokens).slice(0, 10);
}
```

- [ ] **Step 4: Run the FULL core suite → PASS** — `pnpm vitest run packages/core` (all fixture invariants green).

- [ ] **Step 5: Export the public API and commit**

`packages/core/src/index.ts` final form:
```ts
export * from './types.js';
export * from './errors.js';
export { snapshotFromRecords } from './attribute.js';
export { computePrune } from './prune.js';
export { estimateBlock, estimateTokens, IMAGE_TOKENS } from './tokens.js';
export { windowLimitFor } from './models.js';
export { parseFile, parseLine } from './transcript/parse.js';
export { encodeProjectPath, locateActiveSession, locateSession } from './transcript/locate.js';
export type { LocatedSession } from './transcript/locate.js';
export type { ParsedRecord, RawContentBlock, RawUsage } from './transcript/schema.js';
```

```bash
git add -A && git commit -m "feat(core): prune heuristics + public API (M1 acceptance green)" && git push
```

## Acceptance (gate for M2)

`pnpm build && pnpm test` green; every fixture assertion from `test/fixtures/README.md` is
encoded in a test; `grep -r "message\.\|\.jsonl\|isSidechain\|requestId" packages/core/src --include="*.ts" -l`
outside `src/transcript/` returns nothing raw-field-shaped (types.ts/attribute.ts operate only
on `ParsedRecord`).
