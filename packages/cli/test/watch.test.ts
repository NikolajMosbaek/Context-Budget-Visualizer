import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { consumeChange, createTailState } from '../src/watch.js';

const dir = mkdtempSync(join(tmpdir(), 'wp-watch-'));
const file = join(dir, 'sess.jsonl');
const user = (uuid: string, text: string) =>
  JSON.stringify({
    type: 'user',
    uuid,
    isSidechain: false,
    message: { role: 'user', content: text },
  });
const asst = (uuid: string, rid: string, cr: number) =>
  JSON.stringify({
    type: 'assistant',
    uuid,
    requestId: rid,
    isSidechain: false,
    message: {
      role: 'assistant',
      model: 'claude-opus-4-8',
      content: [{ type: 'text', text: 'ok' }],
      usage: {
        input_tokens: 1,
        cache_creation_input_tokens: 1,
        cache_read_input_tokens: cr,
        output_tokens: 1,
      },
    },
  });

test('appends accumulate; partial line is carried, then completed', () => {
  writeFileSync(file, user('u1', 'hi') + '\n');
  const st = createTailState(file);
  expect(consumeChange(st).records).toHaveLength(1);

  const line = asst('a1', 'r1', 100) + '\n';
  appendFileSync(file, line.slice(0, 25)); // partial write, no newline
  expect(consumeChange(st).records).toHaveLength(1); // nothing new parsed
  appendFileSync(file, line.slice(25)); // completion
  const { records } = consumeChange(st);
  expect(records).toHaveLength(2);
  expect(records[1]!.kind).toBe('message');
});

test('truncation triggers full reset', () => {
  writeFileSync(file, user('u1', 'hi') + '\n' + asst('a1', 'r1', 500) + '\n');
  const st = createTailState(file);
  consumeChange(st);
  writeFileSync(file, user('u9', 'fresh') + '\n'); // smaller file = truncation
  const { records, reset } = consumeChange(st);
  expect(reset).toBe(true);
  expect(records).toHaveLength(1);
});

test('multi-byte utf8 split across reads survives', () => {
  const emoji = user('u1', '🪟🪟🪟');
  writeFileSync(file, '');
  const st = createTailState(file);
  const buf = Buffer.from(emoji + '\n', 'utf8');
  const cut = buf.length - 5; // cuts inside the last emoji
  appendFileSync(file, buf.subarray(0, cut));
  consumeChange(st);
  appendFileSync(file, buf.subarray(cut));
  const { records } = consumeChange(st);
  expect(records).toHaveLength(1);
  const r = records[0]!;
  expect(
    r.kind === 'message' && typeof r.content === 'string' && r.content.includes('🪟🪟🪟'),
  ).toBe(true);
});
