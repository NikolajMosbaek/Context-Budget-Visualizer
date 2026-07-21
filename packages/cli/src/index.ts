import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CtxvizError,
  locateActiveSession,
  locateSession,
  parseFile,
  snapshotFromRecords,
} from '@windowpane/core';
import { parseCliArgs } from './args.js';
import { renderReport } from './report.js';
import { startServer } from './server.js';
import { watchSession } from './watch.js';

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

    const webDistDir = join(dirname(fileURLToPath(import.meta.url)), '../web-dist');
    let latest = snapshot;
    const srv = await startServer({ port: opts.port, getSnapshot: () => latest, webDistDir });
    const watcher = watchSession({
      located,
      project: opts.session ? undefined : (opts.project ?? process.cwd()), // no switch-poll for explicit sessions
      ...(opts.limit !== undefined ? { limitOverride: opts.limit } : {}),
      onSnapshot: (s) => {
        latest = s;
        srv.broadcast('snapshot', s);
      },
      onSessionChanged: (s) => {
        console.log(`▸ switched to session ${s.sessionId}`);
        srv.broadcast('session-changed', { sessionId: s.sessionId });
      },
    });
    console.log(`▸ watching session ${located.sessionId} · dashboard live at ${srv.url}`);
    if (opts.open) {
      const opener =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      spawn(opener, [srv.url], { detached: true, stdio: 'ignore' }).unref();
    }
    const shutdown = async () => {
      await watcher.close();
      await srv.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    await new Promise(() => {}); // hold open until Ctrl-C
    return 0;
  } catch (e) {
    if (e instanceof CtxvizError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
}

process.exitCode = await main();
