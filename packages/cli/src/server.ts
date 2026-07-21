import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { SessionSnapshot } from '@windowpane/core';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
};

export interface ServerHandle {
  url: string;
  close: () => Promise<void>;
  broadcast: (event: string, data: unknown) => void;
}

/** A `..` segment is only ever a traversal attempt for static assets — never SPA-fallback it. */
function hasTraversal(decoded: string): boolean {
  return decoded.split(/[/\\]/).includes('..');
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
      req.on('close', () => {
        clearInterval(heartbeat);
        clients.delete(res);
      });
      return;
    }
    // static, traversal-safe, SPA fallback
    const decoded = decodeURIComponent(url.pathname);
    if (hasTraversal(decoded)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    const filePath = resolve(join(root, normalize(decoded)));
    const inRoot = filePath === root || filePath.startsWith(root + sep);
    const target =
      inRoot && existsSync(filePath) && statSync(filePath).isFile()
        ? filePath
        : join(root, 'index.html');
    if (!existsSync(target)) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
    createReadStream(target).pipe(res);
  });

  await new Promise<void>((ok) => server.listen(opts.port, '127.0.0.1', ok));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((ok) => {
        for (const c of clients) c.end();
        server.close(() => ok());
      }),
    broadcast: (event, data) => {
      for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
  };
}
