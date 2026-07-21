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
  for (const f of [
    'basic',
    'no-usage',
    'multi-mcp',
    'compaction',
    'unknown-types',
    'redundant-reads',
  ]) {
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
