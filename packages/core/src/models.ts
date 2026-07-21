const TABLE: ReadonlyArray<readonly [prefix: string, limit: number]> = [
  ['claude-fable-5', 1_000_000],
  ['claude-mythos-5', 1_000_000],
  ['claude-opus-4-8', 1_000_000],
  ['claude-opus-4-7', 1_000_000],
  ['claude-opus-4-6', 1_000_000],
  ['claude-sonnet-5', 1_000_000],
  ['claude-sonnet-4-6', 1_000_000],
  ['claude-sonnet-4-5', 200_000],
  ['claude-opus-4-5', 200_000],
  ['claude-haiku-4-5', 200_000],
];

export function windowLimitFor(model: string | null): number | null {
  if (!model) return null;
  let best: number | null = null;
  let bestLen = -1;
  for (const [prefix, limit] of TABLE) {
    if (model.startsWith(prefix) && prefix.length > bestLen) {
      best = limit;
      bestLen = prefix.length;
    }
  }
  return best;
}
