import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
    expect(r).toEqual({ kind: 'invalid', byteLength: 38 });
  });

  test('unknown type → unknown; known meta → meta; compact boundary detected', () => {
    expect(parseLine('{"type":"flux-capacitor","x":1}').kind).toBe('unknown');
    expect(parseLine('{"type":"bridge-session","bridgeSessionId":"b"}').kind).toBe('meta');
    expect(parseLine('{"type":"mode","mode":"default"}').kind).toBe('meta');
    expect(
      parseLine('{"type":"system","subtype":"compact_boundary","content":"Conversation compacted"}')
        .kind,
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
      'meta',
      'unknown',
      'invalid',
      'message',
      'message',
      'message',
    ]);
  });

  test('trailing partial line is not parsed; parsedUpTo points after last newline', () => {
    const full = readFileSync(join(FIX, 'no-usage.jsonl'));
    const partial = Buffer.concat([full, Buffer.from('{"type":"user","incomple')]);
    const tmp = join(import.meta.dirname, 'tmp-partial.jsonl');
    writeFileSync(tmp, partial);
    const { records, parsedUpTo } = parseFile(tmp);
    expect(records).toHaveLength(2);
    expect(parsedUpTo).toBe(full.length);
    unlinkSync(tmp);
  });
});
