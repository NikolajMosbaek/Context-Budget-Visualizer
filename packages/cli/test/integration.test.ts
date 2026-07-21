import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const CLI = join(import.meta.dirname, '../dist/index.js');
const FIXTURE = join(import.meta.dirname, '../../core/test/fixtures/basic.jsonl');

test('ctxviz report --session <path> prints the breakdown', () => {
  const out = execFileSync('node', [CLI, 'report', '--session', FIXTURE], { encoding: 'utf8' });
  expect(out).toContain('9.1K / 1M tokens');
  expect(out).toContain('File reads');
});

test('missing session exits 1 with message on stderr', () => {
  expect(() =>
    execFileSync('node', [CLI, 'report', '--session', 'does-not-exist'], {
      encoding: 'utf8',
      stdio: 'pipe',
    }),
  ).toThrowError(/not found/);
});
