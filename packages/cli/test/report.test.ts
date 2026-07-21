import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseFile, snapshotFromRecords } from '@windowpane/core';
import { renderReport } from '../src/report.js';

const FIX = join(import.meta.dirname, '../../core/test/fixtures');
const s = snapshotFromRecords(parseFile(join(FIX, 'basic.jsonl')).records, {
  sessionId: 'fixture-basic',
  transcriptPath: 'x',
});
const out = renderReport(s);

test('gauge line: total, limit, percent', () => {
  expect(out).toContain('9.1K / 1M tokens');
  expect(out).toMatch(/──\s*1%/); // 9120 / 1M rounds to 1%, shown in the gauge
});

test('bucket rows with bars and percents, overhead present', () => {
  expect(out).toMatch(/█+\s+System & tool definitions/);
  expect(out).toContain('File reads');
});

test('unknown model renders without percentage', () => {
  const s2 = { ...s, windowLimit: null };
  expect(renderReport(s2)).toContain('9.1K tokens');
  expect(renderReport(s2)).not.toMatch(/\d+%\s*─/);
});

test('empty session renders a friendly message', () => {
  const empty = { ...s, isEmpty: true, totalTokens: 0, buckets: [], turns: [], prune: [] };
  expect(renderReport(empty)).toContain('no assistant turns yet');
});
