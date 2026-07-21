import {
  CtxvizError,
  locateActiveSession,
  locateSession,
  parseFile,
  snapshotFromRecords,
} from '@windowpane/core';
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
    if (e instanceof CtxvizError) {
      console.error(e.message);
      return 1;
    }
    throw e;
  }
}

process.exitCode = await main();
