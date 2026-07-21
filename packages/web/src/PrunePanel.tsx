import type { SessionSnapshot } from './snapshot-types.js';

const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

export function PrunePanel({ snapshot: s }: { snapshot: SessionSnapshot }) {
  if (!s.prune.length)
    return (
      <div>
        <h3>Reclaimable</h3>
        <p style={{ color: 'var(--dim)' }}>Nothing significant to prune.</p>
      </div>
    );
  return (
    <div>
      <h3>Reclaimable</h3>
      <ol className="prune">
        {s.prune.map((p) => (
          <li key={p.itemIds.join('|')}>
            <span>{p.label}</span>
            <strong> {fmtK(p.reclaimableTokens)}</strong>
          </li>
        ))}
      </ol>
      <p style={{ color: 'var(--dim)', fontSize: 12 }}>
        Reclaim via /compact or by avoiding re-reads — Windowpane never edits your session.
      </p>
    </div>
  );
}
