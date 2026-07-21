import { Tiktoken } from 'js-tiktoken/lite';
import cl100k from 'js-tiktoken/ranks/cl100k_base';
import type { RawContentBlock } from './transcript/schema.js';

const enc = new Tiktoken(cl100k);
export const IMAGE_TOKENS = 1500;

const cache = new Map<string, number>();
const CACHE_CAP = 50_000;

export function estimateTokens(text: string): number {
  const key = text.length < 256 ? text : `${text.length}:${text.slice(0, 64)}:${text.slice(-64)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const n = enc.encode(text).length;
  if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value as string);
  cache.set(key, n);
  return n;
}

export function estimateBlock(block: RawContentBlock): number {
  switch (block.type) {
    case 'text':
      return estimateTokens(block.text ?? '');
    case 'thinking':
      return estimateTokens(block.thinking ?? '');
    case 'tool_use':
      return estimateTokens(`${block.name ?? ''} ${JSON.stringify(block.input ?? '')}`);
    case 'image':
      return IMAGE_TOKENS;
    default:
      return Math.ceil(JSON.stringify(block).length / 4);
  }
}
