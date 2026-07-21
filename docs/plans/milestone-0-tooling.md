# Milestone 0: Workspace & Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pnpm workspace (`core`/`cli`/`web`) where `pnpm build && pnpm test && pnpm lint` runs green on a skeleton.

**Architecture:** Three packages: `@windowpane/core` (pure engine, tsup-built), `ctxviz` (CLI, tsup-built, bundles core), `@windowpane/web` (Vite React app, private). Vitest at the root covers all packages.

**Tech Stack:** Node ≥20, pnpm, TypeScript (strict, ESM), tsup, Vite + React 18, Vitest, ESLint flat + Prettier.

## Global Constraints

- Node `>=20` engines field on every package (D1); `"type": "module"` everywhere (D2)
- Only `ctxviz` is ever published; core and web are `"private": true` … core gets `"private": true` until D6 is revisited
- Do not add dependencies beyond the ones named in this plan (CLAUDE.md: minimal impact)
- The fixtures directory `packages/core/test/fixtures/` already exists in the repo — do not modify it

---

### Task 1: Workspace skeleton

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.gitignore`, `.prettierrc`, `eslint.config.js`, `vitest.config.ts`

**Interfaces:**
- Produces: root scripts `build`, `test`, `lint`, `dev` used by every later milestone.

- [ ] **Step 1: Write config files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`package.json`:
```json
{
  "name": "windowpane",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "pnpm -r --filter '!@windowpane/web' build && pnpm --filter @windowpane/web build",
    "test": "vitest run",
    "lint": "eslint . && prettier --check .",
    "format": "prettier --write .",
    "dev": "pnpm --filter ctxviz dev"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "prettier": "^3.3.0",
    "tsup": "^8.0.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["node"]
  }
}
```

`.gitignore`:
```
node_modules/
dist/
web-dist/
*.tsbuildinfo
.DS_Store
```

`.prettierrc`:
```json
{ "printWidth": 100, "singleQuote": true }
```

`eslint.config.js`:
```js
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/web-dist/**', '**/fixtures/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts', 'packages/**/src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "chore: workspace root tooling (pnpm, tsconfig, eslint, vitest)" && git push
```

### Task 2: The three packages

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/tsup.config.ts`, `packages/core/src/index.ts`, `packages/core/test/smoke.test.ts`
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`, `packages/cli/tsup.config.ts`, `packages/cli/src/index.ts`
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vite.config.ts`, `packages/web/index.html`, `packages/web/src/main.tsx`

**Interfaces:**
- Produces: `@windowpane/core` importable from `ctxviz`; `ctxviz` binary stub; web bundle building into `packages/cli/web-dist/` (D-decision: Vite `outDir` points there so the CLI can serve it — M3 relies on this path).

- [ ] **Step 1: Write core package**

`packages/core/package.json`:
```json
{
  "name": "@windowpane/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsup" },
  "dependencies": { "js-tiktoken": "^1.0.12" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/core/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: true, clean: true });
```

`packages/core/src/index.ts`:
```ts
export const CORE_VERSION = '0.1.0';
```

`packages/core/test/smoke.test.ts`:
```ts
import { expect, test } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

test('workspace wiring: core is importable', () => {
  expect(CORE_VERSION).toBe('0.1.0');
});
```

- [ ] **Step 2: Write cli package**

`packages/cli/package.json`:
```json
{
  "name": "ctxviz",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "ctxviz": "./dist/index.js" },
  "files": ["dist", "web-dist"],
  "scripts": { "build": "tsup", "dev": "node --enable-source-maps dist/index.js" },
  "dependencies": {
    "chokidar": "^4.0.0",
    "js-tiktoken": "^1.0.12"
  },
  "devDependencies": { "@windowpane/core": "workspace:*" }
}
```

Note: `@windowpane/core` is a devDependency because tsup inlines it (`noExternal`) — the
published tarball must not reference the unpublished workspace package (D6).

`packages/cli/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`packages/cli/tsup.config.ts`:
```ts
import { defineConfig } from 'tsup';
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  noExternal: ['@windowpane/core'],
});
```

`packages/cli/src/index.ts`:
```ts
import { CORE_VERSION } from '@windowpane/core';

console.log(`ctxviz skeleton (core ${CORE_VERSION})`);
```

- [ ] **Step 3: Write web package**

`packages/web/package.json`:
```json
{
  "name": "@windowpane/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": { "build": "vite build", "dev": "vite" },
  "dependencies": {
    "d3-hierarchy": "^3.1.2",
    "d3-shape": "^3.2.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0"
  },
  "devDependencies": {
    "@types/d3-hierarchy": "^3.1.7",
    "@types/d3-shape": "^3.1.6",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.3.0"
  }
}
```

`packages/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": [] },
  "include": ["src"]
}
```

`packages/web/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { outDir: '../cli/web-dist', emptyOutDir: true },
});
```

`packages/web/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Windowpane</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<h1>Windowpane skeleton</h1>);
```

- [ ] **Step 4: Install and verify everything is green**

Run: `pnpm install && pnpm build && pnpm test && pnpm lint`
Expected: install resolves; core+cli tsup builds succeed; web Vite build writes `packages/cli/web-dist/index.html`; vitest reports `1 passed`; lint clean.

Run: `node packages/cli/dist/index.js`
Expected: `ctxviz skeleton (core 0.1.0)`

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold core/cli/web packages (M0 acceptance green)" && git push
```

## Acceptance (gate for M1)

`pnpm install && pnpm build && pnpm test && pnpm lint` all exit 0 on a clean checkout, and the
web build lands in `packages/cli/web-dist/`.
