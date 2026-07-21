import { useEffect, useState } from 'react';
import type { SessionSnapshot } from './snapshot-types.js';

export function useSnapshot(): SessionSnapshot | null {
  const [snap, setSnap] = useState<SessionSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/snapshot')
      .then((r) => r.json())
      .then((s: SessionSnapshot) => {
        if (alive) setSnap(s);
      })
      .catch(() => {
        /* server gone; leave null */
      });
    return () => {
      alive = false;
    };
  }, []);
  return snap;
}
