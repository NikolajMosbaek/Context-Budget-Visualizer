import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { CtxvizError } from '../errors.js';

export interface LocatedSession {
  sessionId: string;
  transcriptPath: string;
  sideDir: string;
}

const defaultHome = () => join(homedir(), '.claude');

export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-');
}

function fromPath(transcriptPath: string): LocatedSession {
  const sessionId = basename(transcriptPath).replace(/\.jsonl$/, '');
  return { sessionId, transcriptPath, sideDir: join(dirname(transcriptPath), sessionId) };
}

export function locateActiveSession(cwd: string, claudeHome = defaultHome()): LocatedSession {
  const dir = join(claudeHome, 'projects', encodeProjectPath(cwd));
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    throw new CtxvizError('no-session', `no Claude Code transcripts found for ${cwd}`);
  }
  const newest = names
    .map((f) => ({ f, mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];
  if (!newest) throw new CtxvizError('no-session', `no .jsonl sessions in ${dir}`);
  return fromPath(join(dir, newest.f));
}

export function locateSession(idOrPath: string, claudeHome = defaultHome()): LocatedSession {
  if (idOrPath.endsWith('.jsonl') && existsSync(idOrPath)) return fromPath(idOrPath);
  const projectsDir = join(claudeHome, 'projects');
  let projects: string[] = [];
  try {
    projects = readdirSync(projectsDir);
  } catch {
    /* fall through to not-found */
  }
  for (const p of projects) {
    const candidate = join(projectsDir, p, `${idOrPath}.jsonl`);
    if (existsSync(candidate)) return fromPath(candidate);
  }
  throw new CtxvizError('not-found', `session "${idOrPath}" not found`);
}
