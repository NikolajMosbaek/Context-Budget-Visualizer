import { expect, test } from 'vitest';
import { layoutSnapshot } from '../src/treemapLayout.js';
import type { SessionSnapshot } from '../src/snapshot-types.js';

const s = {
  totalTokens: 1000,
  isEmpty: false,
  buckets: [
    { key: 'system-overhead', label: 'System', tokens: 400, share: 0.4, items: [] },
    {
      key: 'file-reads',
      label: 'File reads',
      tokens: 600,
      share: 0.6,
      items: [
        { id: 'u1:0', bucket: 'file-reads', tokens: 500, label: 'a.ts', turnIndex: 0 },
        { id: 'u2:0', bucket: 'file-reads', tokens: 60, label: 'b.ts', turnIndex: 1 },
        { id: 'u3:0', bucket: 'file-reads', tokens: 40, label: 'c.ts', turnIndex: 1 },
      ],
    },
  ],
} as unknown as SessionSnapshot;

test('stable keys: bucket keys at depth 1, item ids at depth 2', () => {
  const nodes = layoutSnapshot(s, 800, 600, null);
  expect(
    nodes
      .filter((n) => n.depth === 1)
      .map((n) => n.key)
      .sort(),
  ).toEqual(['file-reads', 'system-overhead']);
  expect(nodes.some((n) => n.key === 'u1:0')).toBe(true);
});

test('tiny items aggregate into a :rest node', () => {
  // 50×40 canvas over 1000 tokens → minTokens ≈ 72, so the 60- and 40-token
  // items fall under min area and aggregate; the 500-token item stays.
  const nodes = layoutSnapshot(s, 50, 40, null);
  const rest = nodes.find((n) => n.key === 'file-reads:rest');
  expect(rest).toBeDefined();
  expect(rest!.tokens).toBe(100);
});

test('focus zooms to one bucket subtree', () => {
  const nodes = layoutSnapshot(s, 800, 600, 'file-reads');
  expect(nodes.every((n) => n.bucketKey === 'file-reads')).toBe(true);
});
