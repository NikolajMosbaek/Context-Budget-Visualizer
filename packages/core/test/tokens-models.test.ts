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
  expect(
    estimateBlock({ type: 'tool_use', name: 'Read', input: { file_path: '/a' } }),
  ).toBeGreaterThan(0);
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
