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
  const readItems = s.buckets
    .find((b) => b.key === 'file-reads')!
    .items.filter((i) => i.meta?.filePath === '/tmp/proj/notes.md')
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
