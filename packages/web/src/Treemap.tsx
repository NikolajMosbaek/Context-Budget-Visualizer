import { useEffect, useRef, useState } from 'react';
import type { SessionSnapshot } from './snapshot-types.js';
import { layoutSnapshot } from './treemapLayout.js';

const PALETTE: Record<string, string> = {
  'system-overhead': '#30363d',
  'injected-context': '#8957e5',
  'file-reads': '#1f6feb',
  'command-output': '#238636',
  thinking: '#a371f7',
  'assistant-text': '#3fb950',
  'user-messages': '#58a6ff',
  'tool-calls': '#6e7681',
  images: '#db61a2',
  unknown: '#484f58',
};
const colorFor = (bucketKey: string) =>
  PALETTE[bucketKey] ?? (bucketKey.startsWith('mcp:') ? '#d29922' : '#f0883e');
const fmtK = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : `${n}`);

export function Treemap({
  snapshot,
  focusKey,
  onFocus,
}: {
  snapshot: SessionSnapshot;
  focusKey: string | null;
  onFocus: (k: string | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodes = layoutSnapshot(snapshot, size.w, size.h, focusKey);
  return (
    <div className="treemap" ref={ref} onClick={() => focusKey && onFocus(null)}>
      {nodes.map((n) => (
        <div
          key={n.key}
          className="node"
          title={`${n.label} — ${fmtK(n.tokens)} tokens (${((n.tokens / snapshot.totalTokens) * 100).toFixed(1)}%)`}
          onClick={(e) => {
            e.stopPropagation();
            onFocus(n.depth === 1 ? (focusKey ? null : n.bucketKey) : n.bucketKey);
          }}
          style={{
            transform: `translate(${n.x}px, ${n.y}px)`,
            width: n.w,
            height: n.h,
            background: n.depth === 1 ? 'transparent' : colorFor(n.bucketKey),
            outline: n.depth === 1 ? `1px solid ${colorFor(n.bucketKey)}` : 'none',
          }}
        >
          {(n.depth === 1 || (n.w > 60 && n.h > 24)) && (
            <div className="label">
              {n.label} {n.depth === 2 && fmtK(n.tokens)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
