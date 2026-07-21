# Milestone 4: Live Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** With `ctxviz` running and a live Claude Code session in the same project, the gauge climbs and the treemap re-flows within ~1s of each turn — no refresh.

**Architecture:** `watch.ts` implements the byte-offset tail state machine from docs/algorithms.md §1 (chokidar on the transcript + 2s poll for session switches) and emits snapshots; `index.ts` wires watcher → `server.broadcast('snapshot', …)`; web `store.ts` swaps fetch-once for an EventSource subscription (only file touched client-side).

**Tech Stack:** chokidar v4 (already a dependency), EventSource (browser built-in).

## Global Constraints

- The watcher NEVER writes to or locks the transcript (read-only, CLAUDE.md)
- Carry buffer is a `Buffer`, split on `0x0a` before utf8 decode (UTF-8 code points can split across reads — docs/algorithms.md)
- Debounce file events 100ms trailing; session-switch poll every 2s

---

### Task 1: Tail state machine

**Files:**
- Create: `packages/cli/src/watch.ts`
- Test: `packages/cli/test/watch.test.ts`

**Interfaces:**
- Consumes: `parseLine`, `snapshotFromRecords`, `locateActiveSession` from core.
- Produces:
  ```ts
  export interface Watcher { close: () => Promise<void> }
  export function watchSession(opts: {
    located: LocatedSession;
    project?: string;                      // when set, poll for newer sessions in this project
    limitOverride?: number;
    onSnapshot: (s: SessionSnapshot) => void;
    onSessionChanged?: (s: LocatedSession) => void;
  }): Watcher;
  ```

- [ ] **Step 1: Failing tests** — drive with a temp file, no chokidar (export the internal pure step function too):

```ts
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { createTailState, consumeChange } from '../src/watch.js';

const dir = mkdtempSync(join(tmpdir(), 'wp-watch-'));
const file = join(dir, 'sess.jsonl');
const user = (uuid: string, text: string) =>
  JSON.stringify({ type: 'user', uuid, isSidechain: false, message: { role: 'user', content: text } });
const asst = (uuid: string, rid: string, cr: number) =>
  JSON.stringify({ type: 'assistant', uuid, requestId: rid, isSidechain: false,
    message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'ok' }],
    usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: cr, output_tokens: 1 } } });

test('appends accumulate; partial line is carried, then completed', () => {
  writeFileSync(file, user('u1', 'hi') + '\n');
  const st = createTailState(file);
  expect(consumeChange(st).records).toHaveLength(1);

  const line = asst('a1', 'r1', 100) + '\n';
  appendFileSync(file, line.slice(0, 25));            // partial write, no newline
  expect(consumeChange(st).records).toHaveLength(1);  // nothing new parsed
  appendFileSync(file, line.slice(25));               // completion
  const { records } = consumeChange(st);
  expect(records).toHaveLength(2);
  expect(records[1]!.kind).toBe('message');
});

test('truncation triggers full reset', () => {
  writeFileSync(file, user('u1', 'hi') + '\n' + asst('a1', 'r1', 500) + '\n');
  const st = createTailState(file);
  consumeChange(st);
  writeFileSync(file, user('u9', 'fresh') + '\n');   // smaller file = truncation
  const { records, reset } = consumeChange(st);
  expect(reset).toBe(true);
  expect(records).toHaveLength(1);
});

test('multi-byte utf8 split across reads survives', () => {
  const emoji = user('u1', '🪟🪟🪟');
  writeFileSync(file, '');
  const st = createTailState(file);
  const buf = Buffer.from(emoji + '\n', 'utf8');
  const cut = buf.length - 5;                        // cuts inside the last emoji
  appendFileSync(file, buf.subarray(0, cut));
  consumeChange(st);
  appendFileSync(file, buf.subarray(cut));
  const { records } = consumeChange(st);
  expect(records).toHaveLength(1);
  const r = records[0]!;
  expect(r.kind === 'message' && typeof r.content === 'string' && r.content.includes('🪟🪟🪟')).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — split into a pure, test-driven core + a chokidar shell:

```ts
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import watcherLib from 'chokidar';
import {
  locateActiveSession, parseLine, snapshotFromRecords,
  type LocatedSession, type ParsedRecord, type SessionSnapshot,
} from '@windowpane/core';

export interface TailState {
  path: string;
  offset: number;
  carry: Buffer;
  records: ParsedRecord[];
}

export function createTailState(path: string): TailState {
  return { path, offset: 0, carry: Buffer.alloc(0), records: [] };
}

/** Reads new bytes since offset; returns the full accumulated record list. Pure-ish (fs read only). */
export function consumeChange(st: TailState): { records: ParsedRecord[]; reset: boolean } {
  const size = statSync(st.path).size;
  let reset = false;
  if (size < st.offset) {                         // truncation / rewrite
    st.offset = 0; st.carry = Buffer.alloc(0); st.records = []; reset = true;
  }
  if (size === st.offset) return { records: st.records, reset };

  const fd = openSync(st.path, 'r');
  try {
    const chunk = Buffer.alloc(size - st.offset);
    readSync(fd, chunk, 0, chunk.length, st.offset);
    st.offset = size;
    let buf = Buffer.concat([st.carry, chunk]);
    let nl: number;
    while ((nl = buf.indexOf(0x0a)) !== -1) {
      const line = buf.subarray(0, nl).toString('utf8');
      if (line.trim() !== '') st.records.push(parseLine(line));
      buf = buf.subarray(nl + 1);
    }
    st.carry = buf;
  } finally {
    closeSync(fd);
  }
  return { records: st.records, reset };
}

export interface Watcher { close: () => Promise<void> }

export function watchSession(opts: {
  located: LocatedSession;
  project?: string;
  limitOverride?: number;
  onSnapshot: (s: SessionSnapshot) => void;
  onSessionChanged?: (s: LocatedSession) => void;
}): Watcher {
  let located = opts.located;
  let st = createTailState(located.transcriptPath);
  let debounce: NodeJS.Timeout | undefined;

  const emit = () => {
    const { records } = consumeChange(st);
    opts.onSnapshot(snapshotFromRecords(
      records,
      { sessionId: located.sessionId, transcriptPath: located.transcriptPath },
      opts.limitOverride !== undefined ? { limitOverride: opts.limitOverride } : undefined,
    ));
  };
  const onChange = () => {
    clearTimeout(debounce);
    debounce = setTimeout(emit, 100);
  };

  let fsWatcher = watcherLib.watch(located.transcriptPath, { ignoreInitial: true }).on('change', onChange);
  emit(); // initial snapshot

  const switchPoll = opts.project
    ? setInterval(() => {
        try {
          const fresh = locateActiveSession(opts.project!);
          if (fresh.transcriptPath !== located.transcriptPath) {
            located = fresh;
            st = createTailState(located.transcriptPath);
            void fsWatcher.close();
            fsWatcher = watcherLib.watch(located.transcriptPath, { ignoreInitial: true }).on('change', onChange);
            opts.onSessionChanged?.(located);
            emit();
          }
        } catch { /* project dir vanished; keep current session */ }
      }, 2000)
    : undefined;

  return {
    close: async () => {
      clearTimeout(debounce);
      if (switchPoll) clearInterval(switchPoll);
      await fsWatcher.close();
    },
  };
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `git add -A && git commit -m "feat(cli): tail state machine + session watcher (utf8-safe, truncation reset)" && git push`

### Task 2: Wire watcher → SSE broadcast

**Files:**
- Modify: `packages/cli/src/index.ts` (live branch)
- Test: `packages/cli/test/live-integration.test.ts`

- [ ] **Step 1: Failing integration test** (server + watcher + real SSE over fetch):

```ts
import { appendFileSync, copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { parseFile, snapshotFromRecords } from '@windowpane/core';
import { startServer } from '../src/server.js';
import { watchSession } from '../src/watch.js';

test('appending a turn pushes a fresh snapshot over SSE', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wp-live-'));
  const file = join(dir, 'live.jsonl');
  copyFileSync(join(import.meta.dirname, '../../core/test/fixtures/basic.jsonl'), file);

  let latest = snapshotFromRecords(parseFile(file).records, { sessionId: 'live', transcriptPath: file });
  const srv = await startServer({ port: 0, getSnapshot: () => latest, webDistDir: dir });
  const watcher = watchSession({
    located: { sessionId: 'live', transcriptPath: file, sideDir: join(dir, 'live') },
    onSnapshot: (s) => { latest = s; srv.broadcast('snapshot', s); },
  });

  const res = await fetch(`${srv.url}/api/stream`);
  const reader = res.body!.getReader();
  await reader.read(); // initial snapshot event

  appendFileSync(file, JSON.stringify({
    type: 'assistant', uuid: 'aX', requestId: 'req_999', isSidechain: false,
    message: { role: 'assistant', model: 'claude-opus-4-8',
      content: [{ type: 'text', text: 'more' }],
      usage: { input_tokens: 1, cache_creation_input_tokens: 1, cache_read_input_tokens: 20000, output_tokens: 5 } },
  }) + '\n');

  const deadline = Date.now() + 3000;
  let text = '';
  while (Date.now() < deadline && !text.includes('20002')) {
    const { value } = await Promise.race([
      reader.read(),
      new Promise<{ value?: Uint8Array }>((ok) => setTimeout(() => ok({}), 300)),
    ]);
    if (value) text += new TextDecoder().decode(value);
  }
  expect(text).toContain('"totalTokens":20002'); // 1+1+20000

  await watcher.close();
  await srv.close();
}, 10_000);
```

- [ ] **Step 2: Run → FAIL (broadcast path unwired in test = passes already? No — this test IS the wiring proof; it fails only if broadcast/watch interplay is broken. If green immediately, move on.)**

- [ ] **Step 3: Update index.ts live branch** — replace the static `getSnapshot: () => snapshot` wiring:

```ts
let latest = snapshot;
const srv = await startServer({ port: opts.port, getSnapshot: () => latest, webDistDir });
const watcher = watchSession({
  located,
  project: opts.session ? undefined : (opts.project ?? process.cwd()),  // no switch-poll for explicit sessions
  ...(opts.limit !== undefined ? { limitOverride: opts.limit } : {}),
  onSnapshot: (s) => { latest = s; srv.broadcast('snapshot', s); },
  onSessionChanged: (s) => {
    console.log(`▸ switched to session ${s.sessionId}`);
    srv.broadcast('session-changed', { sessionId: s.sessionId });
  },
});
console.log(`▸ watching session ${located.sessionId} · dashboard live at ${srv.url}`);
const shutdown = async () => { await watcher.close(); await srv.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
```

(The `await new Promise(() => {})` hold stays.)

- [ ] **Step 4: Run all tests → PASS. Step 5: Commit** — `git add -A && git commit -m "feat(cli): live watcher wired to SSE broadcast" && git push`

### Task 3: Client goes live

**Files:**
- Modify: `packages/web/src/store.ts` (only file touched)

- [ ] **Step 1: Replace fetch-once with EventSource**

```ts
import { useEffect, useState } from 'react';
import type { SessionSnapshot } from './snapshot-types.js';

export function useSnapshot(): SessionSnapshot | null {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.addEventListener('snapshot', (e) => {
      setSnap(JSON.parse((e as MessageEvent<string>).data) as SessionSnapshot);
    });
    es.addEventListener('session-changed', () => setSnap(null)); // brief "connecting…" then new session's snapshot arrives
    // EventSource auto-reconnects; on reconnect the server replays the current snapshot (server.ts sends it on connect)
    return () => es.close();
  }, []);
  return snap;
}
```

- [ ] **Step 2: THE demo check (manual, required)** — `pnpm build`, run `node packages/cli/dist/index.js --project <a project with an active Claude Code session> `, work in that session, watch: gauge ticks up and treemap re-flows within ~1s per turn, node rectangles glide (CSS transitions on stable keys). Kill/restart the CLI mid-session — dashboard reconnects.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(web): live SSE snapshots (M4 acceptance — the headline works)" && git push`

## Acceptance (gate for M5)

Live session updates within ~1s per turn, no refresh; session switch mid-run is followed;
all tests green.
