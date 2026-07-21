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
    const srv = await startServer({ port: opts.port, getSnapshot: () => snapshot, webDistDir });
    console.log(`▸ session ${located.sessionId} · dashboard live at ${srv.url}`);
    if (opts.open) {
      const opener =
        process.platform === 'darwin'
          ? 'open'
          : process.platform === 'win32'
            ? 'start'
            : 'xdg-open';
      spawn(opener, [srv.url], { detached: true, stdio: 'ignore' }).unref();
    }
    await new Promise(() => {}); // hold open until Ctrl-C (M4 replaces with watcher lifecycle)
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
