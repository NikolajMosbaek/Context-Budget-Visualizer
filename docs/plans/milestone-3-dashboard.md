# Milestone 3: Static Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ctxviz --session <finished-id>` opens a browser with an accurate treemap (drill-down), timeline (turn scrub), and prune panel.

**Architecture:** CLI gains `server.ts` (node:http: `/api/snapshot`, `/api/stream` stub, static `web-dist`). Web app fetches `/api/snapshot` once (SSE lands in M4), renders four components off one `SessionSnapshot`. Treemap = d3-hierarchy layout + absolutely-positioned divs keyed by stable ids (docs/algorithms.md §2).

**Tech Stack:** node:http, React 18, d3-hierarchy, d3-shape, vanilla CSS.

## Global Constraints

- The web app NEVER recomputes attribution — it renders `SessionSnapshot` verbatim (contracts.md)
- Serve only on `127.0.0.1` (privacy story: localhost-only)
- Types shared by copy: create `packages/web/src/snapshot-types.ts` re-exporting the `SessionSnapshot` family **imported from a single copied file** — web cannot depend on core (it would drag node builtins into the bundle). Copy `types.ts` verbatim and add a header comment `// COPY of packages/core/src/types.ts — keep in sync (checked by test)`. A core test asserts both files are byte-identical.

---

### Task 1: HTTP server with snapshot endpoint

**Files:**
- Create: `packages/cli/src/server.ts`
- Test: `packages/cli/test/server.test.ts`

**Interfaces:**
- Produces: `startServer(opts: { port: number; getSnapshot: () => SessionSnapshot; webDistDir: string }): Promise<{ url: string; close: () => Promise<void>; broadcast: (event: string, data: unknown) => void }>` — `broadcast` is a no-op-safe hook M4 will drive.

- [ ] **Step 1: Failing tests**

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { startServer } from '../src/server.js';

const webDist = mkdtempSync(join(tmpdir(), 'webdist-'));
writeFileSync(join(webDist, 'index.html'), '<!doctype html><h1>wp</h1>');
mkdirSync(join(webDist, 'assets'));
writeFileSync(join(webDist, 'assets', 'app.js'), 'console.log(1)');

const fake = { sessionId: 's', totalTokens: 42 } as never; // minimal stand-in
const srv = await startServer({ port: 0, getSnapshot: () => fake, webDistDir: webDist });
afterAll(() => srv.close());

test('GET /api/snapshot returns the snapshot as JSON', async () => {
  const r = await fetch(`${srv.url}/api/snapshot`);
  expect(r.headers.get('content-type')).toContain('application/json');
  expect((await r.json()).totalTokens).toBe(42);
});

test('serves index.html at / and assets with correct mime', async () => {
  expect(await (await fetch(`${srv.url}/`)).text()).toContain('wp');
  const js = await fetch(`${srv.url}/assets/app.js`);
  expect(js.headers.get('content-type')).toContain('javascript');
});

test('path traversal is rejected', async () => {
  const r = await fetch(`${srv.url}/..%2f..%2fetc%2fpasswd`);
  expect(r.status).toBe(404);
});

test('unknown paths fall back to index.html (SPA)', async () => {
  expect(await (await fetch(`${srv.url}/some/route`)).text()).toContain('wp');
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { SessionSnapshot } from '@windowpane/core';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.map': 'application/json', '.ico': 'image/x-icon',
};

export interface ServerHandle {
  url: string;
  close: () => Promise<void>;
  broadcast: (event: string, data: unknown) => void;
}

export async function startServer(opts: {
  port: number;
  getSnapshot: () => SessionSnapshot;
  webDistDir: string;
}): Promise<ServerHandle> {
  const clients = new Set<ServerResponse>();
  const root = resolve(opts.webDistDir);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/api/snapshot') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(opts.getSnapshot()));
      return;
    }
    if (url.pathname === '/api/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      res.write(`event: snapshot\ndata: ${JSON.stringify(opts.getSnapshot())}\n\n`);
      clients.add(res);
      const heartbeat = setInterval(() => res.write(': hb\n\n'), 15_000);
      req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
      return;
    }
    // static, traversal-safe, SPA fallback
    const decoded = decodeURIComponent(url.pathname);
    const filePath = resolve(join(root, normalize(decoded)));
    const target =
      filePath.startsWith(root + sep) && existsSync(filePath) && statSync(filePath).isFile()
        ? filePath
        : join(root, 'index.html');
    if (!existsSync(target)) { res.writeHead(404); res.end('not found'); return; }
    if (!resolve(target).startsWith(root)) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    createReadStream(target).pipe(res);
  });

  await new Promise<void>((ok) => server.listen(opts.port, '127.0.0.1', ok));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((ok) => { for (const c of clients) c.end(); server.close(() => ok()); }),
    broadcast: (event, data) => {
      for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}
```

Traversal test nuance: `/..%2f..` decodes to `/../..` → normalize+resolve lands outside `root` → falls to index.html… but the test expects **404**. Adjust: if the decoded path contains `..` after normalization escaping root, return 404 explicitly (don't SPA-fallback attacks):

```ts
if (!filePath.startsWith(root)) { res.writeHead(404); res.end('not found'); return; }
```
placed before the SPA fallback (the fallback then only applies to in-root misses).

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `git add -A && git commit -m "feat(cli): local http server (snapshot, sse scaffold, static, traversal-safe)" && git push`

### Task 2: Wire `ctxviz` default command to serve

**Files:**
- Modify: `packages/cli/src/index.ts` (replace the M2 "live mode lands in M4" branch)

**Interfaces:**
- Consumes: `startServer`. `webDistDir` resolves relative to the built file: `join(dirname(fileURLToPath(import.meta.url)), '../web-dist')`.

- [ ] **Step 1: Implement the live branch**

```ts
// replaces: console.log('live mode lands in milestone 4 — …')
const { startServer } = await import('./server.js');
const { fileURLToPath } = await import('node:url');
const { dirname, join } = await import('node:path');
const webDistDir = join(dirname(fileURLToPath(import.meta.url)), '../web-dist');
const srv = await startServer({ port: opts.port, getSnapshot: () => snapshot, webDistDir });
console.log(`▸ session ${located.sessionId} · dashboard live at ${srv.url}`);
if (opts.open) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  (await import('node:child_process')).spawn(opener, [srv.url], { detached: true, stdio: 'ignore' }).unref();
}
await new Promise(() => {}); // hold process open until Ctrl-C (M4 replaces with watcher lifecycle)
```

(Static imports at top of file are fine too — dynamic shown to keep the M2 diff obvious.)

- [ ] **Step 2: Manual check** — `pnpm build && node packages/cli/dist/index.js --session packages/core/test/fixtures/basic.jsonl --no-open` then `curl -s localhost:4317/api/snapshot | head -c 200` shows JSON.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(cli): serve dashboard for a located session" && git push`

### Task 3: Web scaffolding — types copy, store, App shell

**Files:**
- Create: `packages/web/src/snapshot-types.ts` (verbatim copy of `packages/core/src/types.ts` + header comment), `packages/web/src/store.ts`, `packages/web/src/App.tsx`, `packages/web/src/styles.css`
- Modify: `packages/web/src/main.tsx`
- Test: `packages/core/test/types-copy.test.ts`

**Interfaces:**
- Produces: `useSnapshot(): SessionSnapshot | null` hook (fetch-once in M3; SSE upgrade in M4 touches ONLY store.ts).

- [ ] **Step 1: The sync-guard test (in core, where both files are reachable)**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

test('web snapshot-types.ts is a byte-identical copy of core types.ts (after header)', () => {
  const core = readFileSync(join(import.meta.dirname, '../src/types.ts'), 'utf8');
  const webRaw = readFileSync(
    join(import.meta.dirname, '../../web/src/snapshot-types.ts'), 'utf8');
  const web = webRaw.split('\n').slice(1).join('\n'); // drop the header comment line
  expect(web).toBe(core);
});
```

- [ ] **Step 2: store.ts (fetch-once version)**

```ts
import { useEffect, useState } from 'react';
import type { SessionSnapshot } from './snapshot-types.js';

export function useSnapshot(): SessionSnapshot | null {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/snapshot')
      .then((r) => r.json())
      .then((s: SessionSnapshot) => { if (alive) setSnap(s); })
      .catch(() => { /* server gone; leave null */ });
    return () => { alive = false; };
  }, []);
  return snap;
}
```

- [ ] **Step 3: App shell + styles**

`App.tsx`:
```tsx
import { useState } from 'react';
import { Gauge } from './Gauge.js';
import { PrunePanel } from './PrunePanel.js';
import { Timeline } from './Timeline.js';
import { Treemap } from './Treemap.js';
import { useSnapshot } from './store.js';

export function App() {
  const snap = useSnapshot();
  const [focusKey, setFocusKey] = useState<string | null>(null);
  if (!snap) return <div className="empty">connecting…</div>;
  if (snap.isEmpty) return <div className="empty">Session {snap.sessionId}: no assistant turns yet.</div>;
  return (
    <div className="app">
      <header>
        <Gauge snapshot={snap} />
      </header>
      <main>
        <Treemap snapshot={snap} focusKey={focusKey} onFocus={setFocusKey} />
        <aside>
          <PrunePanel snapshot={snap} />
        </aside>
      </main>
      <footer>
        <Timeline snapshot={snap} />
      </footer>
    </div>
  );
}
```

`main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);
```

`styles.css` — complete starter (grid layout, dark theme, transition rules the treemap relies on):
```css
:root { --bg:#0f1115; --panel:#171a21; --text:#e6e6e6; --dim:#9aa0aa; --green:#3fb950; --amber:#d29922; --red:#f85149; }
* { box-sizing: border-box; margin: 0; }
body { background: var(--bg); color: var(--text); font: 14px/1.4 ui-sans-serif, system-ui; }
.app { display: grid; grid-template-rows: auto 1fr 160px; height: 100vh; gap: 8px; padding: 12px; }
main { display: grid; grid-template-columns: 1fr 300px; gap: 8px; min-height: 0; }
aside, footer, header { background: var(--panel); border-radius: 8px; padding: 10px; }
.empty { display: grid; place-items: center; height: 100vh; color: var(--dim); }
.treemap { position: relative; overflow: hidden; height: 100%; background: var(--panel); border-radius: 8px; }
.node { position: absolute; overflow: hidden; border-radius: 3px; cursor: pointer;
  transition: transform .4s ease, width .4s ease, height .4s ease, opacity .3s ease; }
.node.enter { opacity: 0; }
.node .label { padding: 2px 6px; font-size: 11px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
```

- [ ] **Step 4: Build green, sync-test green, commit** — `pnpm build && pnpm test`; `git add -A && git commit -m "feat(web): app shell, snapshot store, types copy with sync guard" && git push`

### Task 4: Gauge + PrunePanel (the simple components)

**Files:**
- Create: `packages/web/src/Gauge.tsx`, `packages/web/src/PrunePanel.tsx`

- [ ] **Step 1: Implement both**

`Gauge.tsx`:
```tsx
import type { SessionSnapshot } from './snapshot-types.js';

const fmtK = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M` : n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`;

export function Gauge({ snapshot: s }: { snapshot: SessionSnapshot }) {
  const pct = s.windowLimit ? s.totalTokens / s.windowLimit : null;
  const color = pct === null ? 'var(--dim)' : pct > 0.85 ? 'var(--red)' : pct > 0.6 ? 'var(--amber)' : 'var(--green)';
  return (
    <div className="gauge">
      <strong>{fmtK(s.totalTokens)}</strong>
      {s.windowLimit && <span> / {fmtK(s.windowLimit)} tokens</span>}
      {pct !== null && <span style={{ color }}> {Math.round(pct * 100)}%</span>}
      {pct !== null && (
        <div style={{ background: '#2a2e37', height: 6, borderRadius: 3, marginTop: 6 }}>
          <div style={{ width: `${Math.min(100, pct * 100)}%`, background: color, height: 6,
            borderRadius: 3, transition: 'width .4s ease' }} />
        </div>
      )}
      {s.cacheEfficiency !== null && (
        <span className="dim" style={{ float: 'right', color: 'var(--dim)' }}>
          {Math.round(s.cacheEfficiency * 100)}% from cache · {s.model ?? 'unknown model'}
        </span>
      )}
    </div>
  );
}
```

`PrunePanel.tsx`:
```tsx
import type { SessionSnapshot } from './snapshot-types.js';

const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

export function PrunePanel({ snapshot: s }: { snapshot: SessionSnapshot }) {
  if (!s.prune.length) return <div><h3>Reclaimable</h3><p style={{ color: 'var(--dim)' }}>Nothing significant to prune.</p></div>;
  return (
    <div>
      <h3>Reclaimable</h3>
      <ol className="prune">
        {s.prune.map((p) => (
          <li key={p.itemIds.join('|')}>
            <span>{p.label}</span>
            <strong> {fmtK(p.reclaimableTokens)}</strong>
          </li>
        ))}
      </ol>
      <p style={{ color: 'var(--dim)', fontSize: 12 }}>
        Reclaim via /compact or by avoiding re-reads — Windowpane never edits your session.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit** — `git add -A && git commit -m "feat(web): gauge and prune panel" && git push`

### Task 5: Treemap (layout function + component)

**Files:**
- Create: `packages/web/src/treemapLayout.ts`, `packages/web/src/Treemap.tsx`
- Test: `packages/web/test/treemapLayout.test.ts` (pure function — runs in node, add `packages/web/test` to root vitest include if not matched)

**Interfaces:**
- Produces: `layoutSnapshot(s: SessionSnapshot, w: number, h: number, focusKey: string | null): LayoutNode[]` where `LayoutNode = { key: string; depth: 1 | 2; label: string; tokens: number; x: number; y: number; w: number; h: number; bucketKey: string }`.

- [ ] **Step 1: Failing tests**

```ts
import { expect, test } from 'vitest';
import { layoutSnapshot } from '../src/treemapLayout.js';
import type { SessionSnapshot } from '../src/snapshot-types.js';

const s = {
  totalTokens: 1000, isEmpty: false,
  buckets: [
    { key: 'system-overhead', label: 'System', tokens: 400, share: 0.4, items: [] },
    { key: 'file-reads', label: 'File reads', tokens: 600, share: 0.6, items: [
      { id: 'u1:0', bucket: 'file-reads', tokens: 500, label: 'a.ts', turnIndex: 0 },
      { id: 'u2:0', bucket: 'file-reads', tokens: 60, label: 'b.ts', turnIndex: 1 },
      { id: 'u3:0', bucket: 'file-reads', tokens: 40, label: 'c.ts', turnIndex: 1 },
    ]},
  ],
} as unknown as SessionSnapshot;

test('stable keys: bucket keys at depth 1, item ids at depth 2', () => {
  const nodes = layoutSnapshot(s, 800, 600, null);
  expect(nodes.filter((n) => n.depth === 1).map((n) => n.key).sort())
    .toEqual(['file-reads', 'system-overhead']);
  expect(nodes.some((n) => n.key === 'u1:0')).toBe(true);
});

test('tiny items aggregate into a :rest node', () => {
  const nodes = layoutSnapshot(s, 100, 80, null); // small canvas → b/c fall under min area
  const rest = nodes.find((n) => n.key === 'file-reads:rest');
  expect(rest).toBeDefined();
  expect(rest!.tokens).toBe(100);
});

test('focus zooms to one bucket subtree', () => {
  const nodes = layoutSnapshot(s, 800, 600, 'file-reads');
  expect(nodes.every((n) => n.bucketKey === 'file-reads')).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
import { hierarchy, treemap } from 'd3-hierarchy';
import type { SessionSnapshot } from './snapshot-types.js';

export interface LayoutNode {
  key: string; depth: 1 | 2; label: string; tokens: number;
  x: number; y: number; w: number; h: number; bucketKey: string;
}

const MIN_AREA_PX = 144; // 12px² per docs/algorithms.md

interface TreeDatum { key: string; label: string; tokens: number; bucketKey: string; children?: TreeDatum[] }

export function layoutSnapshot(
  s: SessionSnapshot, width: number, height: number, focusKey: string | null,
): LayoutNode[] {
  const pxPerToken = (width * height) / Math.max(1, s.totalTokens);
  const minTokens = MIN_AREA_PX / pxPerToken;

  const bucketData = s.buckets
    .filter((b) => b.tokens > 0 && (focusKey === null || b.key === focusKey))
    .map((b): TreeDatum => {
      const big = b.items.filter((i) => i.tokens >= minTokens);
      const restTokens = b.items.filter((i) => i.tokens < minTokens).reduce((a, i) => a + i.tokens, 0);
      const children: TreeDatum[] = big.map((i) => ({
        key: i.id, label: i.label, tokens: i.tokens, bucketKey: b.key,
      }));
      if (restTokens > 0) children.push({ key: `${b.key}:rest`, label: '…', tokens: restTokens, bucketKey: b.key });
      return { key: b.key, label: b.label, tokens: b.tokens, bucketKey: b.key,
        children: children.length ? children : undefined };
    });

  const root = hierarchy<TreeDatum>({ key: 'root', label: '', tokens: 0, bucketKey: '', children: bucketData })
    .sum((d) => (d.children ? 0 : d.tokens))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  treemap<TreeDatum>().size([width, height]).paddingInner(2).paddingTop(18)(root);

  const out: LayoutNode[] = [];
  for (const n of root.descendants()) {
    if (n.depth === 0) continue;
    const r = n as typeof n & { x0: number; y0: number; x1: number; y1: number };
    out.push({
      key: n.data.key, depth: n.depth as 1 | 2, label: n.data.label,
      tokens: n.data.children ? n.data.tokens : (n.value ?? 0),
      x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0, bucketKey: n.data.bucketKey || n.data.key,
    });
  }
  return out;
}
```

- [ ] **Step 4: Component**

```tsx
// Treemap.tsx
import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from './snapshot-types.js';
import { layoutSnapshot } from './treemapLayout.js';

const PALETTE: Record<string, string> = {
  'system-overhead': '#30363d', 'injected-context': '#8957e5', 'file-reads': '#1f6feb',
  'command-output': '#238636', thinking: '#a371f7', 'assistant-text': '#3fb950',
  'user-messages': '#58a6ff', 'tool-calls': '#6e7681', images: '#db61a2', unknown: '#484f58',
};
const colorFor = (bucketKey: string) =>
  PALETTE[bucketKey] ?? (bucketKey.startsWith('mcp:') ? '#d29922' : '#f0883e');
const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

export function Treemap({ snapshot, focusKey, onFocus }: {
  snapshot: SessionSnapshot; focusKey: string | null; onFocus: (k: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodes = layoutSnapshot(snapshot, size.w, size.h, focusKey);
  return (
    <div className="treemap" ref={ref} onClick={() => focusKey && onFocus(null)}>
      {nodes.map((n) => (
        <div
          key={n.key}
          className="node"
          title={`${n.label} — ${fmtK(n.tokens)} tokens (${((n.tokens / snapshot.totalTokens) * 100).toFixed(1)}%)`}
          onClick={(e) => { e.stopPropagation(); onFocus(n.depth === 1 ? (focusKey ? null : n.bucketKey) : n.bucketKey); }}
          style={{
            transform: `translate(${n.x}px, ${n.y}px)`, width: n.w, height: n.h,
            background: n.depth === 1 ? 'transparent' : colorFor(n.bucketKey),
            outline: n.depth === 1 ? `1px solid ${colorFor(n.bucketKey)}` : 'none',
          }}
        >
          {(n.depth === 1 || (n.w > 60 && n.h > 24)) && (
            <div className="label">{n.label} {n.depth === 2 && fmtK(n.tokens)}</div>
          )}
        </div>
      ))}
    </div>
  );
}
```

Enter-fade: optional polish for M5 — the `key` stability already gives move/resize transitions.

- [ ] **Step 5: Run tests + build → PASS. Commit** — `git add -A && git commit -m "feat(web): treemap with stable-key layout, drill-down, aggregation" && git push`

### Task 6: Timeline

**Files:**
- Create: `packages/web/src/Timeline.tsx`

- [ ] **Step 1: Implement** (SVG stacked area of `turns[].windowTokens`, cache split shading):

```tsx
import { area, curveMonotoneX } from 'd3-shape';
import type { SessionSnapshot } from './snapshot-types.js';

export function Timeline({ snapshot: s }: { snapshot: SessionSnapshot }) {
  const W = 900, H = 120, PAD = 4;
  const t = s.turns;
  if (t.length < 2) return <div style={{ color: 'var(--dim)' }}>timeline needs ≥ 2 turns</div>;
  const maxY = Math.max(...t.map((d) => d.windowTokens), s.windowLimit ?? 0, 1);
  const x = (i: number) => PAD + (i / (t.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);

  const total = area<{ i: number; v: number }>().x((d) => x(d.i)).y0(H - PAD).y1((d) => y(d.v)).curve(curveMonotoneX);
  const cached = t.map((d, i) => ({ i, v: d.cacheReadTokens }));
  const window_ = t.map((d, i) => ({ i, v: d.windowTokens }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <path d={total(window_) ?? ''} fill="#1f6feb55" />
      <path d={total(cached) ?? ''} fill="#23863655" />
      {s.windowLimit && s.windowLimit <= maxY && (
        <line x1={0} x2={W} y1={y(s.windowLimit)} y2={y(s.windowLimit)} stroke="var(--red)" strokeDasharray="4 4" />
      )}
      {t.map((d, i) => (
        <circle key={d.requestId ?? i} cx={x(i)} cy={y(d.windowTokens)} r={2.5} fill="#58a6ff">
          <title>turn {i + 1}: {Math.round(d.windowTokens / 1000)}K</title>
        </circle>
      ))}
    </svg>
  );
}
```

Turn-scrub (click a turn → treemap at that point) requires historical snapshots — deferred to M5 polish (compute on demand: `snapshotFromRecords(records.slice(0, turnEnd))` server-side; out of M3 scope; the spec's acceptance for M3 is hover/see, scrub can be cut if time-boxed — note it in the M5 backlog).

- [ ] **Step 2: Full build + manual acceptance** — `pnpm build && node packages/cli/dist/index.js --session packages/core/test/fixtures/redundant-reads.jsonl --no-open`, open the URL manually: treemap shows buckets, drill-down zooms, prune panel lists notes.md ×3, timeline draws.

- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat(web): timeline; M3 acceptance — static dashboard complete" && git push`

## Acceptance (gate for M4)

`ctxviz --session <finished session>` opens an accurate treemap + timeline + prune panel;
drill-down works; all tests green.
