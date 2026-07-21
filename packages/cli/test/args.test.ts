import { expect, test } from 'vitest';
import { parseCliArgs } from '../src/args.js';

test('defaults: live mode, port 4317, open', () => {
  expect(parseCliArgs([])).toEqual({ command: 'live', port: 4317, open: true });
});

test('report subcommand with session and limit', () => {
  expect(parseCliArgs(['report', '--session', 'abc', '--limit', '200000'])).toMatchObject({
    command: 'report',
    session: 'abc',
    limit: 200000,
  });
});

test('--no-open and --port', () => {
  expect(parseCliArgs(['--port', '5000', '--no-open'])).toMatchObject({ port: 5000, open: false });
});

test('unknown flag throws a usage error', () => {
  expect(() => parseCliArgs(['--bogus'])).toThrow(/bogus/);
});
