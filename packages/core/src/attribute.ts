import { windowLimitFor } from './models.js';
import { computePrune } from './prune.js';
import { estimateBlock, estimateTokens, IMAGE_TOKENS } from './tokens.js';
import type { ParsedRecord, RawContentBlock, RawUsage } from './transcript/schema.js';
import type { Bucket, BucketKey, Item, SessionSnapshot, Turn } from './types.js';

const INJECTED_PREFIXES = ['<system-reminder', '<local-command-caveat'];

function toolBucket(name: string): BucketKey {
  if (name === 'Read') return 'file-reads';
  if (name === 'Bash') return 'command-output';
  if (name.startsWith('mcp__')) {
    const rest = name.slice('mcp__'.length);
    const cut = rest.indexOf('__');
    return `mcp:${cut === -1 ? rest : rest.slice(0, cut)}`;
  }
  if (name === 'Agent' || name === 'Task') return 'subagent-results';
  if (name === 'WebFetch' || name === 'WebSearch') return 'web';
  if (name === 'Skill') return 'skills';
  return 'other-tool-results';
}

function usageTotal(u: RawUsage): number {
  return (
    (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  );
}

function resultTokens(content: string | RawContentBlock[] | undefined): number {
  if (content === undefined) return 0;
  if (typeof content === 'string') return estimateTokens(content);
  return content.reduce((sum, b) => sum + estimateBlock(b), 0);
}

export function snapshotFromRecords(
  records: ParsedRecord[],
  ctx: { sessionId: string; transcriptPath: string },
  opts?: { limitOverride?: number },
): SessionSnapshot {
  // ---- pass 1: boundary, tool index, turns, latest usage/model/version
  let boundaryIdx = -1;
  records.forEach((r, i) => {
    if (r.kind === 'compact-boundary') boundaryIdx = i;
  });

  const toolUseInfo = new Map<string, { name: string; input: unknown; turnIndex: number }>();
  const turnOrder: string[] = [];
  const turnByRid = new Map<string, Turn>();
  let lastUsage: RawUsage | undefined;
  let model: string | null = null;
  let version: string | null = null;

  for (const r of records) {
    if (r.kind !== 'message' || r.isSidechain) continue;
    if (r.version) version = r.version;
    if (r.type !== 'assistant') continue;
    if (r.model && r.model !== '<synthetic>') model = r.model;
    const rid = r.requestId ?? `anon-${turnOrder.length}`;
    if (!turnByRid.has(rid)) {
      turnOrder.push(rid);
      turnByRid.set(rid, {
        index: turnOrder.length - 1,
        requestId: r.requestId ?? null,
        timestamp: r.timestamp ?? '',
        windowTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      });
    }
    const t = turnByRid.get(rid)!;
    if (r.timestamp) t.timestamp = r.timestamp;
    if (r.usage) {
      lastUsage = r.usage;
      t.windowTokens = usageTotal(r.usage);
      t.outputTokens = r.usage.output_tokens ?? 0;
      t.cacheReadTokens = r.usage.cache_read_input_tokens ?? 0;
      t.cacheCreationTokens = r.usage.cache_creation_input_tokens ?? 0;
    }
    if (Array.isArray(r.content)) {
      for (const b of r.content) {
        if (b.type === 'tool_use' && b.id && b.name) {
          toolUseInfo.set(b.id, {
            name: b.name,
            input: b.input,
            turnIndex: turnByRid.get(rid)!.index,
          });
        }
      }
    }
  }
  const turns = turnOrder.map((rid) => turnByRid.get(rid)!);
  const totalTokens = lastUsage ? usageTotal(lastUsage) : 0;
  const isEmpty = totalTokens === 0;

  // ---- pass 2: items (post-boundary only)
  const items: Item[] = [];
  let currentTurn = 0;
  records.forEach((r, idx) => {
    if (r.kind === 'message' && !r.isSidechain && r.type === 'assistant' && r.requestId) {
      currentTurn = turnByRid.get(r.requestId)?.index ?? currentTurn;
    }
    if (idx <= boundaryIdx || isEmpty) return;
    if (r.kind === 'unknown' || r.kind === 'invalid') {
      items.push({
        id: `raw-${idx}`,
        bucket: 'unknown',
        tokens: Math.ceil(r.byteLength / 4),
        label: r.kind === 'unknown' ? `unknown record: ${r.type}` : 'unparseable line',
        turnIndex: currentTurn,
      });
      return;
    }
    if (r.kind !== 'message' || r.isSidechain) return;

    const injectedWhole = r.isMeta || r.isCompactSummary;
    const blocks: RawContentBlock[] =
      typeof r.content === 'string' ? [{ type: 'text', text: r.content }] : r.content;

    blocks.forEach((b, bi) => {
      const id = `${r.uuid}:${bi}`;
      const push = (bucket: BucketKey, tokens: number, label: string, meta?: Item['meta']) =>
        items.push({ id, bucket, tokens, label, turnIndex: currentTurn, meta });

      if (b.type === 'tool_result') {
        const info = b.tool_use_id ? toolUseInfo.get(b.tool_use_id) : undefined;
        const name = info?.name ?? 'unknown-tool';
        const input = (info?.input ?? {}) as Record<string, unknown>;
        const filePath =
          name === 'Read' && typeof input.file_path === 'string' ? input.file_path : undefined;
        const label =
          filePath ??
          (name === 'Bash' && typeof input.command === 'string'
            ? `$ ${input.command.slice(0, 40)}`
            : `${name} result`);
        push(toolBucket(name), resultTokens(b.content), label, {
          toolName: name,
          filePath,
          isError: b.is_error === true,
        });
        return;
      }
      const injected =
        injectedWhole ||
        (b.type === 'text' && INJECTED_PREFIXES.some((p) => (b.text ?? '').startsWith(p)));
      if (injected) {
        push('injected-context', estimateBlock(b), 'injected context');
        return;
      }

      switch (b.type) {
        case 'thinking':
          push('thinking', estimateBlock(b), `thinking (turn ${currentTurn + 1})`);
          break;
        case 'text':
          push(
            r.type === 'assistant' ? 'assistant-text' : 'user-messages',
            estimateBlock(b),
            (b.text ?? '').slice(0, 48) || '(empty)',
          );
          break;
        case 'tool_use':
          push('tool-calls', estimateBlock(b), `${b.name ?? '?'} call`);
          break;
        case 'image':
          push('images', IMAGE_TOKENS, 'image');
          break;
        default:
          push('unknown', estimateBlock(b), `unknown block: ${b.type}`);
      }
    });
  });

  // ---- pass 3: scale to invariant, assemble buckets
  const attributed = items.reduce((s, i) => s + i.tokens, 0);
  if (attributed > totalTokens && attributed > 0) {
    const f = totalTokens / attributed;
    for (const it of items) it.tokens = Math.floor(it.tokens * f);
  }
  const byBucket = new Map<BucketKey, Item[]>();
  for (const it of items) {
    const list = byBucket.get(it.bucket) ?? [];
    list.push(it);
    byBucket.set(it.bucket, list);
  }
  const DISPLAY: BucketKey[] = [
    'file-reads',
    'command-output',
    'subagent-results',
    'web',
    'skills',
    'other-tool-results',
    'thinking',
    'assistant-text',
    'user-messages',
    'tool-calls',
    'images',
    'injected-context',
    'unknown',
  ];
  const mcpKeys = [...byBucket.keys()]
    .filter((k) => k.startsWith('mcp:'))
    .sort((a, b) => sum(byBucket.get(b)!) - sum(byBucket.get(a)!));
  const orderedKeys: BucketKey[] = [...DISPLAY.slice(0, 2), ...mcpKeys, ...DISPLAY.slice(2)];

  const buckets: Bucket[] = [];
  for (const key of orderedKeys) {
    const its = (byBucket.get(key) ?? []).sort((a, b) => b.tokens - a.tokens);
    const tokens = sum(its);
    if (its.length === 0) continue; // empty buckets are omitted (overhead is added below regardless)
    buckets.push({
      key,
      label: labelFor(key),
      tokens,
      share: totalTokens ? tokens / totalTokens : 0,
      items: its,
    });
  }
  const attributedFinal = buckets.reduce((s, b) => s + b.tokens, 0);
  buckets.unshift({
    key: 'system-overhead',
    label: 'System & tool definitions',
    tokens: Math.max(0, totalTokens - attributedFinal),
    share: totalTokens ? Math.max(0, totalTokens - attributedFinal) / totalTokens : 0,
    items: [],
  });

  const cacheEfficiency =
    lastUsage && usageTotal(lastUsage) > 0
      ? (lastUsage.cache_read_input_tokens ?? 0) / usageTotal(lastUsage)
      : null;

  return {
    sessionId: ctx.sessionId,
    transcriptPath: ctx.transcriptPath,
    claudeCodeVersion: version,
    model,
    totalTokens,
    windowLimit: opts?.limitOverride ?? windowLimitFor(model),
    buckets,
    turns,
    prune: computePrune(items, turns),
    cacheEfficiency,
    isEmpty,
  };
}

function sum(items: Item[]): number {
  return items.reduce((s, i) => s + i.tokens, 0);
}

function labelFor(key: BucketKey): string {
  if (key.startsWith('mcp:')) return `MCP: ${key.slice(4)}`;
  const names: Record<string, string> = {
    'system-overhead': 'System & tool definitions',
    'injected-context': 'Injected context',
    'file-reads': 'File reads',
    'command-output': 'Command output',
    'subagent-results': 'Subagents',
    web: 'Web',
    skills: 'Skills',
    'other-tool-results': 'Other tool results',
    thinking: 'Thinking',
    'assistant-text': 'Assistant text',
    'user-messages': 'User messages',
    'tool-calls': 'Tool calls',
    images: 'Images',
    unknown: 'Unknown',
  };
  return names[key] ?? key;
}
