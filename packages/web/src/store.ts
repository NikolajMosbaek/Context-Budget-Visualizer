import { useEffect, useState } from 'react';
import type { SessionSnapshot } from './snapshot-types.js';

export function useSnapshot(): SessionSnapshot | null {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.addEventListener('snapshot', (e) => {
      setSnap(JSON.parse((e as MessageEvent<string>).data) as SessionSnapshot);
    });
    es.addEventListener('session-changed', () => setSnap(null)); // brief "connecting…" then the new session's snapshot arrives
    // EventSource auto-reconnects; on reconnect the server replays the current snapshot (server.ts sends it on connect)
    return () => es.close();
  }, []);
  return snap;
}
