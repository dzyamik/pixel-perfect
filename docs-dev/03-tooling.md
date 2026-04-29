# 03 — Tooling

Exact commands, exact configurations. Copy and execute in order. No surprises.

## Required system tools

- **Node.js** 20.x or 22.x LTS.
- **npm** 10.x (ships with Node 20+).
- **git** 2.40+.
- **VS Code** recommended (any editor with TS support works).

Verify:
```bash
node --version    # v20.x or v22.x
npm --version     # 10.x or 11.x
git --version     # 2.40+
```

## Package versions (pin these in package.json)

| Package | Version | Why |
|---|---|---|
| `phaser` | `^4.0.0` | Target framework (ensure stable v4 is out at install time; if still RC, use `4.0.0-rc.7` or later) |
| `phaser-box2d` | latest | Physics; check the Phaser site for the current package name and version |
| `typescript` | `^5.4.0` | Strict mode, latest features |
| `vite` | `^5.4.0` | Examples dev server + build |
| `vitest` | `^2.1.0` | Unit tests |
| `@vitest/ui` | `^2.1.0` | Optional, nice for debugging |
| `vitepress` | `^1.4.0` | Docs site |
| `typedoc` | `^0.26.0` | API reference generation |
| `typedoc-plugin-markdown` | `^4.2.0` | Optional, for VitePress integration |
| `prettier` | `^3.3.0` | Formatting |
| `eslint` | `^9.10.0` | Linting (flat config) |
| `typescript-eslint` | `^8.5.0` | TS rules for ESLint |
| `@types/node` | `^22.5.0` | Node typings for tooling |

Confirm Phaser Box2D's exact package name when bootstrapping. As of writing, it is shipped via the Phaser website; check `phaser.io/box2d` for the current install instructions and update this table if the package name has shifted.

## package.json (final shape)

```json
{
  "name": "pixel-perfect",
  "version": "0.0.0",
  "description": "Pixel-perfect spatial reasoning for Phaser v4: destructible terrain, alpha-aware sprite collision, and bitmap-as-truth utilities.",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "vite",
    "build": "tsc -p tsconfig.build.json && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ui": "vitest --ui",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src tests",
    "lint:fix": "eslint src tests --fix",
    "format": "prettier --write \"src/**/*.ts\" \"tests/**/*.ts\" \"examples/**/*.{ts,html}\"",
    "format:check": "prettier --check \"src/**/*.ts\" \"tests/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "docs:api": "typedoc --out docs/api src/index.ts",
    "docs:site": "vitepress build docs-dev/site --outDir ../../docs/site",
    "docs:build": "npm run docs:api && npm run docs:site",
    "docs:dev": "vitepress dev docs-dev/site",
    "prepare": "echo 'no-op'"
  },
  "devDependencies": {
    "@types/node": "^22.5.0",
    "@vitest/ui": "^2.1.0",
    "eslint": "^9.10.0",
    "phaser": "^4.0.0",
    "phaser-box2d": "latest",
    "prettier": "^3.3.0",
    "typedoc": "^0.26.0",
    "typescript": "^5.4.0",
    "typescript-eslint": "^8.5.0",
    "vite": "^5.4.0",
    "vitepress": "^1.4.0",
    "vitest": "^2.1.0"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "license": "MIT",
  "author": "dzyamik",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/dzyamik/pixel-perfect.git"
  },
  "bugs": {
    "url": "https://github.com/dzyamik/pixel-perfect/issues"
  },
  "homepage": "https://github.com/dzyamik/pixel-perfect#readme"
}
```

Phaser is a `devDependency` because we're not publishing to npm in v1; for the examples and tests it acts like a regular dependency. If/when you publish to npm, move `phaser` and `phaser-box2d` to `peerDependencies`.

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],

    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,

    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true,

    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./",

    "types": ["vitest/globals", "node"],

    "paths": {
      "@/*": ["src/*"],
      "@core/*": ["src/core/*"],
      "@physics/*": ["src/physics/*"],
      "@phaser/*": ["src/phaser/*"]
    }
  },
  "include": ["src/**/*", "tests/**/*", "examples/**/*"],
  "exclude": ["node_modules", "dist", "docs"]
}
```

## tsconfig.build.json

For producing the type definitions (used when you eventually publish to npm; harmless to have now):

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["src/**/*.test.ts", "tests", "examples", "docs", "docs-dev"]
}
```

## vite.config.ts

```ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, statSync } from 'node:fs';

// Auto-discover example sub-folders
const examplesDir = resolve(__dirname, 'examples');
const exampleEntries = Object.fromEntries(
  readdirSync(examplesDir)
    .filter((name) => {
      const full = resolve(examplesDir, name);
      return statSync(full).isDirectory() && !name.startsWith('_');
    })
    .map((name) => [name, resolve(examplesDir, name, 'index.html')])
);

export default defineConfig({
  root: 'examples',
  publicDir: resolve(__dirname, 'examples/_public'),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@physics': resolve(__dirname, 'src/physics'),
      '@phaser': resolve(__dirname, 'src/phaser'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-examples'),
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'examples/index.html'),
        ...exampleEntries,
      },
    },
  },
  server: {
    open: '/index.html',
  },
});
```

## vitest.config.ts

```ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/index.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@physics': resolve(__dirname, 'src/physics'),
      '@phaser': resolve(__dirname, 'src/phaser'),
    },
  },
});
```

`happy-dom` is needed if any unit test ever touches DOM types; pure-algorithm tests don't need it but the dependency is cheap.

Add `happy-dom` and `@vitest/coverage-v8` to devDependencies during bootstrap if you enable coverage thresholds.

## .prettierrc

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

## eslint.config.js (flat config, ESLint 9+)

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['examples/**/*', 'tests/**/*'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    ignores: ['node_modules', 'dist', 'docs', 'docs-dev/site/.vitepress/cache'],
  }
);
```

## .editorconfig

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

## .gitignore

```
# Dependencies
node_modules/

# Build outputs
dist/
dist-examples/
docs/site/
docs/api/

# Test coverage
coverage/

# Vite
.vite/

# VitePress cache
docs-dev/site/.vitepress/cache/
docs-dev/site/.vitepress/dist/

# IDE
.vscode/
!.vscode/extensions.json
!.vscode/settings.json
.idea/

# OS
.DS_Store
Thumbs.db

# Env
.env
.env.local

# Logs
npm-debug.log*
*.log
```

Note: `docs/` itself is **not** in `.gitignore` because that's where you'll commit built output for GitHub Pages. Only its sub-build directories are ignored *during development* and you'll regenerate them before committing for deploy.

Practical workflow:
1. During development: `docs/` may be empty or stale. That's fine.
2. Before deploy: `npm run docs:build` produces `docs/site/` and `docs/api/`.
3. `git add docs && git commit -m 'docs: deploy v1.0.0'`.
4. `git push`. GitHub Pages serves `docs/`.

Adjust `.gitignore` accordingly if you want to *always* commit built docs (remove the `docs/site/` and `docs/api/` lines once docs are part of your release process).

## VS Code recommendations

`.vscode/extensions.json`:

```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "vitest.explorer",
    "ms-vscode.vscode-typescript-next"
  ]
}
```

`.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  },
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "files.eol": "\n"
}
```

## Bootstrap install commands

Run in order, from the repo root after `git init`:

```bash
# Initialize package.json (interactive — accept defaults, fix later)
npm init -y

# Replace package.json with the version from this doc, then:

npm install --save-dev typescript @types/node \
  vite vitest @vitest/ui @vitest/coverage-v8 happy-dom \
  vitepress typedoc typedoc-plugin-markdown \
  prettier eslint typescript-eslint @eslint/js

npm install --save-dev phaser phaser-box2d
```

Confirm the actual `phaser-box2d` package name and version when running. The Phaser team's package naming has shifted before; `phaser.io/box2d` is the source of truth.

## Smoke test after bootstrap

```bash
npm run typecheck       # should pass with no errors (empty src/)
npm test                # should pass with 0 tests (or 1 if you wrote the smoke test)
npm run lint            # should pass with no errors
npm run format:check    # should pass
npm run dev             # opens Vite at localhost:5173 with examples landing page (empty for now)
```

If all five pass, Phase 0 bootstrap is done.

## Things deliberately not used

- **CI/CD.** No GitHub Actions in v1 per your direction.
- **Husky / lint-staged.** Pre-commit hooks are good practice but slow you down when iterating with Claude Code; add later if you want.
- **tsup / rollup library build.** Not publishing to npm in v1, so no need to produce ESM/CJS/UMD bundles.
- **Changesets / release-please.** No npm releases means no release tooling.
- **Docker.** Not needed for a pure JS project.
- **pnpm / yarn.** npm works fine; no reason to add tooling overhead.

These are good additions later. Right now they're noise.
