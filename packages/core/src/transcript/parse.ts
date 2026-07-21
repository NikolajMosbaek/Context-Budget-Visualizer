import { readFileSync } from 'node:fs';
import type { ParsedRecord, RawContentBlock, RawUsage } from './schema.js';

/** Record types that are known harness metadata — never window content. */
const KNOWN_META_TYPES = new Set([
  'attachment',
  'mode',
  'last-prompt',
  'bridge-session',
  'permission-mode',
  'pr-link',
  'queue-operation',
  'file-history-snapshot',
  'file-history-delta',
  'custom-title',
  'agent-name',
  'agent-color',
  'frame-link',
  'system',
]);

export function parseLine(line: string): ParsedRecord {
  const byteLength = Buffer.byteLength(line, 'utf8');
  let obj: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== 'object' || parsed === null) return { kind: 'invalid', byteLength };
    obj = parsed as Record<string, unknown>;
  } catch {
    return { kind: 'invalid', byteLength };
  }
  const type = obj.type;
  if (typeof type !== 'string') return { kind: 'invalid', byteLength };

  if (type === 'system' && obj.subtype === 'compact_boundary') {
    return { kind: 'compact-boundary', timestamp: asString(obj.timestamp) };
  }
  if (type === 'assistant' || type === 'user') {
    const msg = obj.message as Record<string, unknown> | undefined;
    const rawContent = msg?.content;
    if (!msg || (typeof rawContent !== 'string' && !Array.isArray(rawContent))) {
      return { kind: 'unknown', type, byteLength };
    }
    const content: string | RawContentBlock[] =
      typeof rawContent === 'string' ? rawContent : (rawContent as RawContentBlock[]);
    return {
      kind: 'message',
      type,
      uuid: String(obj.uuid ?? ''),
      requestId: asString(obj.requestId),
      timestamp: asString(obj.timestamp),
      version: asString(obj.version),
      model: asString(msg.model),
      isMeta: obj.isMeta === true,
      isCompactSummary: obj.isCompactSummary === true,
      isSidechain: obj.isSidechain === true,
      content,
      usage: msg.usage as RawUsage | undefined,
    };
  }
  if (KNOWN_META_TYPES.has(type)) return { kind: 'meta', type, byteLength };
  return { kind: 'unknown', type, byteLength };
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function parseFile(path: string): { records: ParsedRecord[]; parsedUpTo: number } {
  const buf = readFileSync(path);
  const records: ParsedRecord[] = [];
  let start = 0;
  let parsedUpTo = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a) {
      const line = buf.subarray(start, i).toString('utf8');
      if (line.trim() !== '') records.push(parseLine(line));
      start = i + 1;
      parsedUpTo = start;
    }
  }
  return { records, parsedUpTo };
}
