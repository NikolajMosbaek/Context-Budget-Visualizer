import type { SessionSnapshot } from '@windowpane/core';

const fmtK = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K`
      : String(n);

const BAR_MAX = 8;

export function renderReport(s: SessionSnapshot): string {
  if (s.isEmpty) return `session ${s.sessionId}: no assistant turns yet — nothing to attribute.\n`;

  const lines: string[] = [];
  const pct = s.windowLimit ? Math.round((s.totalTokens / s.windowLimit) * 100) : null;
  const header = s.windowLimit
    ? `Context: ${fmtK(s.totalTokens)} / ${fmtK(s.windowLimit)} tokens ── ${pct}%`
    : `Context: ${fmtK(s.totalTokens)} tokens (window limit unknown)`;
  lines.push(`┌─ ${header} ─┐`);

  const top = s.buckets.filter((b) => b.tokens > 0).slice(0, 6);
  const rest = s.buckets.filter((b) => b.tokens > 0).slice(6);
  const maxTok = Math.max(...top.map((b) => b.tokens), 1);
  for (const b of top) {
    const bar = '█'.repeat(Math.max(1, Math.round((b.tokens / maxTok) * BAR_MAX)));
    lines.push(
      `│ ${bar.padEnd(BAR_MAX)} ${b.label.padEnd(22)} ${fmtK(b.tokens).padStart(6)}  ${Math.round(b.share * 100)}%`,
    );
  }
  if (rest.length) {
    const t = rest.reduce((a, b) => a + b.tokens, 0);
    lines.push(
      `│ ${' '.repeat(BAR_MAX)} ${'Everything else'.padEnd(22)} ${fmtK(t).padStart(6)}  ${Math.round((t / s.totalTokens) * 100)}%`,
    );
  }
  lines.push(`└${'─'.repeat(Math.max(...lines.map((l) => l.length)) - 1)}┘`);

  if (s.prune.length) {
    const tops = s.prune.slice(0, 3).map((p) => `${p.label} ${fmtK(p.reclaimableTokens)}`);
    lines.push(`top reclaimable:  ${tops.join(' · ')}`);
  }
  if (s.cacheEfficiency !== null) {
    lines.push(
      `cache efficiency: ${Math.round(s.cacheEfficiency * 100)}% of window served from cache`,
    );
  }
  return lines.join('\n') + '\n';
}
