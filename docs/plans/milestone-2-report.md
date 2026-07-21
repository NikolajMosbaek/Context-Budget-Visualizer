# Milestone 2: `ctxviz report` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ctxviz report` prints a correct ASCII breakdown of a session in the terminal — the engine proven end-to-end with zero UI.

**Architecture:** Thin CLI: parse args (`util.parseArgs`, D15) → locate session (core) → parse + snapshot (core) → pure `renderReport(snapshot): string`. Rendering is a pure function so it's unit-testable without a terminal.

**Tech Stack:** Node built-ins only in the CLI layer; `@windowpane/core` for everything else.

## Global Constraints

- CLI flags frozen in `docs/contracts.md` § CLI surface — implement exactly those
- No new dependencies (`chokidar` sits unused until M4)
- Exit codes: 0 success, 1 `CtxvizError` (message to stderr, no stack), 2 usage error

---

### Task 1: Argument parsing

**Files:**
- Create: `packages/cli/src/args.ts`
- Test: `packages/cli/test/args.test.ts`

**Interfaces:**
- Produces: `parseCliArgs(argv: string[]): CliOptions` where
  `CliOptions = { command: 'live' | 'report'; session?: string; project?: string; port: number; open: boolean; limit?: number }`.

- [ ] **Step 1: Failing tests**

```ts
import { expect, test } from 'vitest';
import { parseCliArgs } from '../src/args.js';

test('defaults: live mode, port 4317, open', () => {
  expect(parseCliArgs([])).toEqual({ command: 'live', port: 4317, open: true });
});

test('report subcommand with session and limit', () => {
  expect(parseCliArgs(['report', '--session', 'abc', '--limit', '200000'])).toMatchObject({
    command: 'report', session: 'abc', limit: 200000,
  });
});

test('--no-open and --port', () => {
  expect(parseCliArgs(['--port', '5000', '--no-open'])).toMatchObject({ port: 5000, open: false });
});

test('unknown flag throws a usage error', () => {
  expect(() => parseCliArgs(['--bogus'])).toThrow(/bogus/);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement with `util.parseArgs`**

```ts
import { parseArgs } from 'node:util';

export interface CliOptions {
  command: 'live' | 'report';
  session?: string;
  project?: string;
  port: number;
  open: boolean;
  limit?: number;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      session: { type: 'string' },
      project: { type: 'string' },
      port: { type: 'string' },
      limit: { type: 'string' },
      'no-open': { type: 'boolean' },
    },
  });
  const command = positionals[0] === 'report' ? 'report' : 'live';
  if (positionals[0] && positionals[0] !== 'report') {
    throw new Error(`unknown command "${positionals[0]}" (expected: report)`);
  }
  const num = (v: string | undefined, name: string): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
    return n;
  };
  const opts: CliOptions = {
    command,
    port: num(values.port, 'port') ?? 4317,
    open: values['no-open'] !== true,
  };
  if (values.session) opts.session = values.session;
  if (values.project) opts.project = values.project;
  const limit = num(values.limit, 'limit');
  if (limit !== undefined) opts.limit = limit;
  return opts;
}
```

Note: the "defaults" test uses `toEqual` — properties must be absent, not `undefined`; hence the conditional assignment.

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `git add -A && git commit -m "feat(cli): argument parsing" && git push`

### Task 2: Report renderer

**Files:**
- Create: `packages/cli/src/report.ts`
- Test: `packages/cli/test/report.test.ts`

**Interfaces:**
- Consumes: `SessionSnapshot` from `@windowpane/core`.
- Produces: `renderReport(snapshot: SessionSnapshot): string` — matches the README's terminal block style.

- [ ] **Step 1: Failing tests** (build the snapshot from the basic fixture via core):

```ts
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseFile, snapshotFromRecords } from '@windowpane/core';
import { renderReport } from '../src/report.js';

const FIX = join(import.meta.dirname, '../../core/test/fixtures');
const s = snapshotFromRecords(parseFile(join(FIX, 'basic.jsonl')).records, {
  sessionId: 'fixture-basic', transcriptPath: 'x',
});
const out = renderReport(s);

test('gauge line: total, limit, percent', () => {
  expect(out).toContain('9.1K / 1M tokens');
  expect(out).toMatch(/\b1%\b/); // 9120 / 1M rounds to 1%
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
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import type { SessionSnapshot } from '@windowpane/core';

const fmtK = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  : n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
  : String(n);

const BAR_MAX = 8;

export function renderReport(s: SessionSnapshot): string {
  if (s.isEmpty) return `session ${s.sessionId}: no assistant turns yet — nothing to attribute.\n`;

  const lines: string[] = [];
  const pct = s.windowLimit ? Math.round((s.totalTokens / s.windowLimit) * 100) : null;
  const header = s.windowLimit
    ? `Context: ${fmtK(s.totalTokens)} / ${fmtK(s.windowLimit)} tokens ── ${pct}%`
    : `Context: ${fmtK(s.totalTokens)} tokens (window limit unknown)`;
  lines.push(`┌─ ${header} ─┐`);

  const top = s.buckets.filter((b) => b.tokens > 0).slice(0, 6);
  const rest = s.buckets.filter((b) => b.tokens > 0).slice(6);
  const maxTok = Math.max(...top.map((b) => b.tokens), 1);
  for (const b of top) {
    const bar = '█'.repeat(Math.max(1, Math.round((b.tokens / maxTok) * BAR_MAX)));
    lines.push(
      `│ ${bar.padEnd(BAR_MAX)} ${b.label.padEnd(22)} ${fmtK(b.tokens).padStart(6)}  ${Math.round(b.share * 100)}%`,
    );
  }
  if (rest.length) {
    const t = rest.reduce((a, b) => a + b.tokens, 0);
    lines.push(`│ ${' '.repeat(BAR_MAX)} ${'Everything else'.padEnd(22)} ${fmtK(t).padStart(6)}  ${Math.round((t / s.totalTokens) * 100)}%`);
  }
  lines.push(`└${'─'.repeat(Math.max(...lines.map((l) => l.length)) - 1)}┘`);

  if (s.prune.length) {
    const tops = s.prune.slice(0, 3).map((p) => `${p.label} ${fmtK(p.reclaimableTokens)}`);
    lines.push(`top reclaimable:  ${tops.join(' · ')}`);
  }
  if (s.cacheEfficiency !== null) {
    lines.push(`cache efficiency: ${Math.round(s.cacheEfficiency * 100)}% of window served from cache`);
  }
  return lines.join('\n') + '\n';
}
```

(Exact box-drawing alignment is cosmetic — tests assert content, not column positions; polish freely in M5.)

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `git add -A && git commit -m "feat(cli): ASCII report renderer" && git push`

### Task 3: Wire up main()

**Files:**
- Modify: `packages/cli/src/index.ts` (replace skeleton)
- Test: `packages/cli/test/integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 + core. `command === 'live'` prints "live mode lands in milestone 4" and exits 0 for now (M3/M4 replace it).

- [ ] **Step 1: Failing integration test**

```ts
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
    execFileSync('node', [CLI, 'report', '--session', 'does-not-exist'], { encoding: 'utf8', stdio: 'pipe' }),
  ).toThrowError(/not found/);
});
```

Run `pnpm --filter ctxviz build` before this test file (execFileSync runs the built artifact); add a `pretest` note in the plan-executor's head: the root `test` script must build cli first — change root package.json `"test": "pnpm --filter ctxviz build && vitest run"`.

- [ ] **Step 2: Run → FAIL. Step 3: Implement index.ts**

```ts
import { CtxvizError, locateActiveSession, locateSession, parseFile, snapshotFromRecords } from '@windowpane/core';
import { parseCliArgs } from './args.js';
import { renderReport } from './report.js';

async function main(): Promise<number> {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  try {
    const located = opts.session
      ? locateSession(opts.session)
      : locateActiveSession(opts.project ?? process.cwd());
    const { records } = parseFile(located.transcriptPath);
    const snapshot = snapshotFromRecords(
      records,
      { sessionId: located.sessionId, transcriptPath: located.transcriptPath },
      opts.limit !== undefined ? { limitOverride: opts.limit } : undefined,
    );
    if (opts.command === 'report') {
      process.stdout.write(renderReport(snapshot));
      return 0;
    }
    console.log('live mode lands in milestone 4 — use `ctxviz report` for now');
    return 0;
  } catch (e) {
    if (e instanceof CtxvizError) { console.error(e.message); return 1; }
    throw e;
  }
}

process.exitCode = await main();
```

`locateSession` must accept a direct path that exists even without searching — already handled in core.

- [ ] **Step 4: Build + run tests → PASS.** Also smoke-test on a REAL session: `node packages/cli/dist/index.js report --project <some real project dir>` and eyeball that numbers look sane.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(cli): ctxviz report end-to-end (M2 acceptance)" && git push`

## Acceptance (gate for M3)

`ctxviz report` on a real local session prints a breakdown whose gauge equals the session's
actual latest usage total; all tests green.
