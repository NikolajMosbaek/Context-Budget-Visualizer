import { expect, test } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

test('workspace wiring: core is importable', () => {
  expect(CORE_VERSION).toBe('0.1.0');
});
