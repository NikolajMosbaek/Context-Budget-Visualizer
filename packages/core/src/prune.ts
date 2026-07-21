import { basename } from 'node:path';
import type { Item, PruneSuggestion, Turn } from './types.js';

const LARGE_PAYLOAD_TOKENS = 10_000;
const RESULT_BUCKETS = new Set([
  'file-reads',
  'command-output',
  'subagent-results',
  'web',
  'skills',
  'other-tool-results',
]);
const isResultBucket = (k: string) => RESULT_BUCKETS.has(k) || k.startsWith('mcp:');

export function computePrune(items: Item[], _turns: Turn[]): PruneSuggestion[] {
  const out: PruneSuggestion[] = [];
  const covered = new Set<string>();

  const reads = new Map<string, Item[]>();
  for (const it of items) {
    if (it.bucket === 'file-reads' && it.meta?.filePath && !it.meta.isError) {
      const key = it.meta.filePath.replace(/\/+$/, '');
      const group = reads.get(key) ?? [];
      group.push(it);
      reads.set(key, group);
    }
  }
  for (const [path, group] of reads) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.turnIndex - b.turnIndex);
    out.push({
      kind: 'redundant-read',
      itemIds: group.map((g) => g.id),
      label: `${basename(path)} read ×${group.length}`,
      reclaimableTokens: group.slice(0, -1).reduce((s, g) => s + g.tokens, 0),
    });
    for (const g of group) covered.add(g.id);
  }
  for (const it of items) {
    if (!isResultBucket(it.bucket) || covered.has(it.id) || it.meta?.isError) continue;
    if (it.tokens < LARGE_PAYLOAD_TOKENS) continue;
    out.push({
      kind: 'large-payload',
      itemIds: [it.id],
      label: `${it.meta?.toolName ?? 'tool'} output (turn ${it.turnIndex + 1})`,
      reclaimableTokens: it.tokens,
    });
  }
  return out.sort((a, b) => b.reclaimableTokens - a.reclaimableTokens).slice(0, 10);
}
