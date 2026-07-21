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
