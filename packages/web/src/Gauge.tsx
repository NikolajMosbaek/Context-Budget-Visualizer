import type { SessionSnapshot } from './snapshot-types.js';

const fmtK = (n: number) =>
  n >= 1e6
    ? `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}K`
      : `${n}`;

export function Gauge({ snapshot: s }: { snapshot: SessionSnapshot }) {
  const pct = s.windowLimit ? s.totalTokens / s.windowLimit : null;
  const color =
    pct === null
      ? 'var(--dim)'
      : pct > 0.85
        ? 'var(--red)'
        : pct > 0.6
          ? 'var(--amber)'
          : 'var(--green)';
  return (
    <div className="gauge">
      <strong>{fmtK(s.totalTokens)}</strong>
      {s.windowLimit && <span> / {fmtK(s.windowLimit)} tokens</span>}
      {pct !== null && <span style={{ color }}> {Math.round(pct * 100)}%</span>}
      {pct !== null && (
        <div style={{ background: '#2a2e37', height: 6, borderRadius: 3, marginTop: 6 }}>
          <div
            style={{
              width: `${Math.min(100, pct * 100)}%`,
              background: color,
              height: 6,
              borderRadius: 3,
              transition: 'width .4s ease',
            }}
          />
        </div>
      )}
      {s.cacheEfficiency !== null && (
        <span className="dim" style={{ float: 'right', color: 'var(--dim)' }}>
          {Math.round(s.cacheEfficiency * 100)}% from cache · {s.model ?? 'unknown model'}
        </span>
      )}
    </div>
  );
}
