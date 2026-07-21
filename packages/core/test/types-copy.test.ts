import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

test('web snapshot-types.ts is a byte-identical copy of core types.ts (after header)', () => {
  const core = readFileSync(join(import.meta.dirname, '../src/types.ts'), 'utf8');
  const webRaw = readFileSync(
    join(import.meta.dirname, '../../web/src/snapshot-types.ts'),
    'utf8',
  );
  const web = webRaw.split('\n').slice(1).join('\n'); // drop the header comment line
  expect(web).toBe(core);
});
