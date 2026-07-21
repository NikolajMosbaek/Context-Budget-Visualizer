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
  if (snap.isEmpty)
    return <div className="empty">Session {snap.sessionId}: no assistant turns yet.</div>;
  const danger = snap.windowLimit ? snap.totalTokens / snap.windowLimit > 0.85 : false;
  return (
    <div className="app">
      <header className={danger ? 'danger' : undefined}>
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
