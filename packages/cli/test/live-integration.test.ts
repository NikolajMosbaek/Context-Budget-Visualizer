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

  let latest = snapshotFromRecords(parseFile(file).records, {
    sessionId: 'live',
    transcriptPath: file,
  });
  const srv = await startServer({ port: 0, getSnapshot: () => latest, webDistDir: dir });
  const watcher = watchSession({
    located: { sessionId: 'live', transcriptPath: file, sideDir: join(dir, 'live') },
    onSnapshot: (s) => {
      latest = s;
      srv.broadcast('snapshot', s);
    },
  });

  const res = await fetch(`${srv.url}/api/stream`);
  const reader = res.body!.getReader();
  await reader.read(); // initial snapshot event

  appendFileSync(
    file,
    JSON.stringify({
      type: 'assistant',
      uuid: 'aX',
      requestId: 'req_999',
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-opus-4-8',
        content: [{ type: 'text', text: 'more' }],
        usage: {
          input_tokens: 1,
          cache_creation_input_tokens: 1,
          cache_read_input_tokens: 20000,
          output_tokens: 5,
        },
      },
    }) + '\n',
  );

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
