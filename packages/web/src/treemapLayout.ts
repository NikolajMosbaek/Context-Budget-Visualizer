import { hierarchy, treemap } from 'd3-hierarchy';
import type { SessionSnapshot } from './snapshot-types.js';

export interface LayoutNode {
  key: string;
  depth: 1 | 2;
  label: string;
  tokens: number;
  x: number;
  y: number;
  w: number;
  h: number;
  bucketKey: string;
}

const MIN_AREA_PX = 144; // 12px² per docs/algorithms.md

interface TreeDatum {
  key: string;
  label: string;
  tokens: number;
  bucketKey: string;
  children?: TreeDatum[];
}

export function layoutSnapshot(
  s: SessionSnapshot,
  width: number,
  height: number,
  focusKey: string | null,
): LayoutNode[] {
  const pxPerToken = (width * height) / Math.max(1, s.totalTokens);
  const minTokens = MIN_AREA_PX / pxPerToken;

  const bucketData = s.buckets
    .filter((b) => b.tokens > 0 && (focusKey === null || b.key === focusKey))
    .map((b): TreeDatum => {
      const big = b.items.filter((i) => i.tokens >= minTokens);
      const restTokens = b.items
        .filter((i) => i.tokens < minTokens)
        .reduce((a, i) => a + i.tokens, 0);
      const children: TreeDatum[] = big.map((i) => ({
        key: i.id,
        label: i.label,
        tokens: i.tokens,
        bucketKey: b.key,
      }));
      if (restTokens > 0)
        children.push({ key: `${b.key}:rest`, label: '…', tokens: restTokens, bucketKey: b.key });
      return {
        key: b.key,
        label: b.label,
        tokens: b.tokens,
        bucketKey: b.key,
        children: children.length ? children : undefined,
      };
    });

  const root = hierarchy<TreeDatum>({
    key: 'root',
    label: '',
    tokens: 0,
    bucketKey: '',
    children: bucketData,
  })
    .sum((d) => (d.children ? 0 : d.tokens))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  treemap<TreeDatum>().size([width, height]).paddingInner(2).paddingTop(18)(root);

  const out: LayoutNode[] = [];
  for (const n of root.descendants()) {
    if (n.depth === 0) continue;
    const r = n as typeof n & { x0: number; y0: number; x1: number; y1: number };
    out.push({
      key: n.data.key,
      depth: n.depth as 1 | 2,
      label: n.data.label,
      tokens: n.data.children ? n.data.tokens : (n.value ?? 0),
      x: r.x0,
      y: r.y0,
      w: r.x1 - r.x0,
      h: r.y1 - r.y0,
      bucketKey: n.data.bucketKey || n.data.key,
    });
  }
  return out;
}
