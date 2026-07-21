import { closeSync, openSync, readSync, statSync } from 'node:fs';
import watcherLib from 'chokidar';
import {
  locateActiveSession,
  parseLine,
  snapshotFromRecords,
  type LocatedSession,
  type ParsedRecord,
  type SessionSnapshot,
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
  if (size < st.offset) {
    // truncation / rewrite
    st.offset = 0;
    st.carry = Buffer.alloc(0);
    st.records = [];
    reset = true;
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

export interface Watcher {
  close: () => Promise<void>;
}

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
    opts.onSnapshot(
      snapshotFromRecords(
        records,
        { sessionId: located.sessionId, transcriptPath: located.transcriptPath },
        opts.limitOverride !== undefined ? { limitOverride: opts.limitOverride } : undefined,
      ),
    );
  };
  const onChange = () => {
    clearTimeout(debounce);
    debounce = setTimeout(emit, 100);
  };

  let fsWatcher = watcherLib
    .watch(located.transcriptPath, { ignoreInitial: true })
    .on('change', onChange);
  emit(); // initial snapshot

  const switchPoll = opts.project
    ? setInterval(() => {
        try {
          const fresh = locateActiveSession(opts.project!);
          if (fresh.transcriptPath !== located.transcriptPath) {
            located = fresh;
            st = createTailState(located.transcriptPath);
            void fsWatcher.close();
            fsWatcher = watcherLib
              .watch(located.transcriptPath, { ignoreInitial: true })
              .on('change', onChange);
            opts.onSessionChanged?.(located);
            emit();
          }
        } catch {
          /* project dir vanished; keep current session */
        }
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
