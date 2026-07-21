import { area, curveMonotoneX } from 'd3-shape';
import type { SessionSnapshot } from './snapshot-types.js';

export function Timeline({ snapshot: s }: { snapshot: SessionSnapshot }) {
  const W = 900,
    H = 120,
    PAD = 4;
  const t = s.turns;
  if (t.length < 2) return <div style={{ color: 'var(--dim)' }}>timeline needs ≥ 2 turns</div>;
  const maxY = Math.max(...t.map((d) => d.windowTokens), s.windowLimit ?? 0, 1);
  const x = (i: number) => PAD + (i / (t.length - 1)) * (W - 2 * PAD);
  const y = (v: number) => H - PAD - (v / maxY) * (H - 2 * PAD);

  const total = area<{ i: number; v: number }>()
    .x((d) => x(d.i))
    .y0(H - PAD)
    .y1((d) => y(d.v))
    .curve(curveMonotoneX);
  const cached = t.map((d, i) => ({ i, v: d.cacheReadTokens }));
  const window_ = t.map((d, i) => ({ i, v: d.windowTokens }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <path d={total(window_) ?? ''} fill="#1f6feb55" />
      <path d={total(cached) ?? ''} fill="#23863655" />
      {s.windowLimit && s.windowLimit <= maxY && (
        <line
          x1={0}
          x2={W}
          y1={y(s.windowLimit)}
          y2={y(s.windowLimit)}
          stroke="var(--red)"
          strokeDasharray="4 4"
        />
      )}
      {t.map((d, i) => (
        <circle key={d.requestId ?? i} cx={x(i)} cy={y(d.windowTokens)} r={2.5} fill="#58a6ff">
          <title>
            turn {i + 1}: {Math.round(d.windowTokens / 1000)}K
          </title>
        </circle>
      ))}
    </svg>
  );
}
