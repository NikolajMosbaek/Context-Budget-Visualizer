import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  encodeProjectPath,
  locateActiveSession,
  locateSession,
} from '../src/transcript/locate.js';
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
