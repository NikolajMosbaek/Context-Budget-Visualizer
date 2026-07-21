import { parseArgs } from 'node:util';

export interface CliOptions {
  command: 'live' | 'report';
  session?: string;
  project?: string;
  port: number;
  open: boolean;
  limit?: number;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      session: { type: 'string' },
      project: { type: 'string' },
      port: { type: 'string' },
      limit: { type: 'string' },
      'no-open': { type: 'boolean' },
    },
  });
  const command = positionals[0] === 'report' ? 'report' : 'live';
  if (positionals[0] && positionals[0] !== 'report') {
    throw new Error(`unknown command "${positionals[0]}" (expected: report)`);
  }
  const num = (v: string | undefined, name: string): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`--${name} must be a positive integer`);
    return n;
  };
  const opts: CliOptions = {
    command,
    port: num(values.port, 'port') ?? 4317,
    open: values['no-open'] !== true,
  };
  if (values.session) opts.session = values.session;
  if (values.project) opts.project = values.project;
  const limit = num(values.limit, 'limit');
  if (limit !== undefined) opts.limit = limit;
  return opts;
}
