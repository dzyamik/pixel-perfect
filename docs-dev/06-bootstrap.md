# 06 — Bootstrap

Step-by-step instructions for creating the repo and getting to a clean Phase 0 finish. Execute in order. ETA: 60–90 minutes.

## Prerequisites check

```bash
node --version    # must be v20.x or v22.x
npm --version     # must be 10.x or 11.x
git --version     # must be 2.40+
git config user.name      # must be set
git config user.email     # must be set
gh --version              # GitHub CLI, optional but easier
```

If `gh` (GitHub CLI) is not installed: install from https://cli.github.com/ or skip the CLI steps and create the repo manually on github.com.

## Step 1 — Create the GitHub repo

### Option A: GitHub CLI (recommended)

```bash
cd ~/projects        # or wherever you keep code
gh auth login        # if not already
gh repo create dzyamik/pixel-perfect --public \
  --description "Pixel-perfect spatial reasoning for Phaser v4: destructible terrain, alpha-aware sprite collision, and bitmap-as-truth utilities." \
  --clone
cd pixel-perfect
```

### Option B: web UI

1. Go to https://github.com/new
2. Owner: `dzyamik`
3. Repository name: `pixel-perfect`
4. Description: `Pixel-perfect spatial reasoning for Phaser v4: destructible terrain, alpha-aware sprite collision, and bitmap-as-truth utilities.`
5. Public.
6. Add README: **No** (we'll create our own).
7. Add .gitignore: **No** (we'll create our own).
8. License: **MIT**.
9. Create.
10. Clone locally:
    ```bash
    cd ~/projects
    git clone https://github.com/dzyamik/pixel-perfect.git
    cd pixel-perfect
    ```

## Step 2 — Initial folder structure

From the repo root:

```bash
mkdir -p src/core/algorithms src/core/ops src/core/queries
mkdir -p src/physics
mkdir -p src/phaser
mkdir -p tests/integration
mkdir -p examples/_shared examples/_public
mkdir -p docs-dev/site
mkdir -p docs/site docs/api    # placeholders; will be regenerated
mkdir -p .claude/skills
mkdir -p .vscode
```

## Step 3 — Move planning docs into place

Place the seven `docs-dev/*.md` files (the documents I'm preparing for you) in the `docs-dev/` folder. After this step, your `docs-dev/` should contain:

```
docs-dev/
├── 01-architecture.md
├── 02-roadmap.md
├── 03-tooling.md
├── 04-claude-code-setup.md
├── 05-skill-template.md
├── 06-bootstrap.md
├── 07-initial-prompt.md
└── site/                   # empty for now; VitePress will live here
```

## Step 4 — Create root config files

Create the following files at the repo root with contents from `03-tooling.md`:

- `package.json`
- `tsconfig.json`
- `tsconfig.build.json`
- `vite.config.ts`
- `vitest.config.ts`
- `.prettierrc`
- `eslint.config.js`
- `.editorconfig`
- `.gitignore`
- `.vscode/extensions.json`
- `.vscode/settings.json`

Tip: keep `03-tooling.md` open in another window and copy each block. Or use Claude Code (after Step 8) to generate them from `03-tooling.md`.

## Step 5 — Create LICENSE and README

### LICENSE

```bash
# Standard MIT license. From the repo root:
cat > LICENSE << 'EOF'
MIT License

Copyright (c) 2026 dzyamik

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
EOF
```

### README.md (initial placeholder, will be expanded in Phase 5)

```bash
cat > README.md << 'EOF'
# pixel-perfect

> Pixel-perfect spatial reasoning for Phaser v4: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities.

**Status:** alpha — under active development. Expect API churn before v1.0.0.

## What this is

A library for Phaser v4 games that need pixel-accurate world manipulation:

- Destructible terrain with proper Box2D colliders that follow the bitmap.
- Alpha-aware sprite-vs-sprite and sprite-vs-terrain collision.
- Procedural terrain generation from PNG masks.
- Spatial queries (raycast, surface-find, material sampling) directly on the bitmap.

## Why

Phaser v4 + Phaser Box2D are now both production-ready, but no maintained library exists for pixel-perfect spatial reasoning on this stack. This fills the gap.

## Quickstart

(Coming after Phase 3 of the roadmap.)

## Roadmap

See [`docs-dev/02-roadmap.md`](docs-dev/02-roadmap.md).

## Architecture

See [`docs-dev/01-architecture.md`](docs-dev/01-architecture.md).

## Documentation

Live docs (after Phase 5): https://dzyamik.github.io/pixel-perfect

## License

MIT
EOF
```

## Step 6 — Create CLAUDE.md

Use the content from `04-claude-code-setup.md` (the `CLAUDE.md` block). Save it at the repo root as `CLAUDE.md`.

```bash
# (Copy the CLAUDE.md content from 04-claude-code-setup.md into the file)
```

## Step 7 — Create the initial SKILL.md

Use the skeleton from `05-skill-template.md`. Save it at the repo root as `SKILL.md`. It will be mostly placeholders until APIs stabilize; that's expected.

## Step 8 — Install dependencies

```bash
# Replace the auto-generated package.json with the one from 03-tooling.md first.

# Then install:
npm install --save-dev typescript @types/node \
  vite vitest @vitest/ui @vitest/coverage-v8 happy-dom \
  vitepress typedoc typedoc-plugin-markdown \
  prettier eslint typescript-eslint @eslint/js

npm install --save-dev phaser phaser-box2d
```

If `phaser-box2d` install fails, check https://phaser.io/box2d for the current package name and version. The install command above assumes the package is published under that name; verify before running.

Expected duration: 1–3 minutes depending on connection.

## Step 9 — Create source skeleton files

Create empty entry points so the build doesn't error:

```bash
# Core
cat > src/core/index.ts << 'EOF'
// Core: framework-agnostic algorithms and data structures.
// Public API will be filled in during Phase 1.
export {};
EOF

# Physics
cat > src/physics/index.ts << 'EOF'
// Physics: Box2D adapter.
// Public API will be filled in during Phase 2.
export {};
EOF

# Phaser
cat > src/phaser/index.ts << 'EOF'
// Phaser: plugin and GameObjects.
// Public API will be filled in during Phase 3.
export {};
EOF

# Top-level
cat > src/index.ts << 'EOF'
// pixel-perfect — top-level public API.
export * from './core/index.js';
export * from './physics/index.js';
export * from './phaser/index.js';
EOF

# Smoke test
cat > tests/smoke.test.ts << 'EOF'
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('environment is healthy', () => {
    expect(true).toBe(true);
  });
});
EOF
```

## Step 10 — Examples landing page

```bash
# Examples landing page
cat > examples/index.html << 'EOF'
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pixel-perfect — examples</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 4rem auto; padding: 0 1rem; line-height: 1.6; }
      h1 { margin-bottom: 0.25rem; }
      .subtitle { color: #666; margin-top: 0; }
      ul { padding-left: 1.25rem; }
      li { margin: 0.5rem 0; }
      a { color: #0366d6; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .status { color: #999; font-style: italic; }
    </style>
  </head>
  <body>
    <h1>pixel-perfect</h1>
    <p class="subtitle">Examples — early development. Most of these are not implemented yet.</p>
    <ul>
      <li><a href="/01-basic-destruction/">01 — Basic destruction</a> <span class="status">(coming soon)</span></li>
      <li><a href="/02-worms-style/">02 — Worms-style demo</a> <span class="status">(coming soon)</span></li>
      <li><a href="/03-pixel-perfect-sprite/">03 — Pixel-perfect sprite collision</a> <span class="status">(coming soon)</span></li>
      <li><a href="/04-falling-debris/">04 — Falling debris stress test</a> <span class="status">(coming soon)</span></li>
      <li><a href="/05-generate-from-image/">05 — Generate terrain from image</a> <span class="status">(coming soon)</span></li>
    </ul>
  </body>
</html>
EOF
```

## Step 11 — Smoke test the toolchain

```bash
npm run typecheck
# Expected: no errors, may print "Found 0 errors"

npm test
# Expected: 1 passed test (the smoke test)

npm run lint
# Expected: clean (no warnings yet because src/ is empty)

npm run format:check
# Expected: clean

npm run dev
# Expected: Vite opens localhost:5173 with the examples landing page.
# Press Ctrl+C to stop.
```

If any of these fail, fix before moving on. Common issues:

- **TypeScript errors about missing types**: ensure `@types/node` is installed and `tsconfig.json` includes `"types": ["vitest/globals", "node"]`.
- **Vite can't find Phaser**: should not happen in Phase 0 (no Phaser usage yet); if it does, check the import paths in `vite.config.ts`.
- **VitePress complaints**: ignore for now; we don't run the docs build until Phase 5.

## Step 12 — Set up VitePress (basic)

```bash
mkdir -p docs-dev/site
cat > docs-dev/site/index.md << 'EOF'
---
layout: home

hero:
  name: pixel-perfect
  text: Pixel-accurate spatial reasoning for Phaser v4
  tagline: Destructible terrain, alpha-aware sprite collision, and bitmap-as-truth utilities.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/dzyamik/pixel-perfect

features:
  - title: Bitmap-as-truth
    details: One authoritative representation. Visuals and colliders derive from it automatically.
  - title: Phaser v4 native
    details: Built on Phaser v4's new renderer and Phaser Box2D. No legacy v3 patterns.
  - title: Three-layer architecture
    details: Pure-TS core, Box2D adapter, Phaser integration. Use as little or as much as you need.
---
EOF

mkdir -p docs-dev/site/.vitepress
cat > docs-dev/site/.vitepress/config.ts << 'EOF'
import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'pixel-perfect',
  description: 'Pixel-accurate spatial reasoning for Phaser v4',
  base: '/pixel-perfect/',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'API', link: '/api/' },
      { text: 'GitHub', link: 'https://github.com/dzyamik/pixel-perfect' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guide/getting-started' },
        ],
      },
    ],
  },
});
EOF

mkdir -p docs-dev/site/guide
cat > docs-dev/site/guide/getting-started.md << 'EOF'
# Getting started

Coming soon. See [the roadmap](https://github.com/dzyamik/pixel-perfect/blob/main/docs-dev/02-roadmap.md) for development status.
EOF
```

The `base` setting (`'/pixel-perfect/'`) is for GitHub Pages serving from `https://dzyamik.github.io/pixel-perfect/`. If you set up a custom domain later, change accordingly.

## Step 13 — First commit

```bash
git add -A
git status                # review what's about to be committed
git commit -m "chore: bootstrap repo

- TypeScript + Vite + Vitest tooling
- Three-layer source skeleton (core / physics / phaser)
- VitePress docs scaffold in docs-dev/site
- CLAUDE.md and SKILL.md placeholders
- Planning documents in docs-dev/
- MIT license

Phase 0 of docs-dev/02-roadmap.md."
git push origin main
git tag v0.0.0
git push origin v0.0.0
```

## Step 14 — Verify GitHub repo state

Open https://github.com/dzyamik/pixel-perfect in a browser:

- [ ] README renders correctly.
- [ ] Folder structure looks right (`docs-dev/`, `src/`, `examples/`, etc.).
- [ ] License shows as MIT in the right sidebar.
- [ ] `v0.0.0` tag visible under "Releases" (or the releases page).

## Step 15 — Set up Claude Code in the repo

```bash
# From the repo root, with Claude Code installed:
claude
```

In the Claude Code session, verify it's reading `CLAUDE.md`:

```
What's this project and what's the next thing I should work on?
```

A correct response will reference pixel-perfect, mention the three-layer architecture, and point to Phase 1 of the roadmap.

If Claude Code does not seem to know the project, troubleshoot:

- Confirm `CLAUDE.md` is at the repo root.
- Confirm you ran `claude` from the repo root.
- Check Claude Code documentation for any version-specific config.

## Step 16 — Done

Phase 0 is complete. You should now have:

- ✅ Public GitHub repo at `dzyamik/pixel-perfect`.
- ✅ Local clone with full tooling installed.
- ✅ All seven planning documents in `docs-dev/`.
- ✅ `CLAUDE.md` and stub `SKILL.md` at repo root.
- ✅ Source skeleton (empty index.ts files, three layers).
- ✅ Smoke tests passing.
- ✅ `npm run dev` opens an examples landing page.
- ✅ VitePress configured for future docs builds.
- ✅ `v0.0.0` tag pushed.

Move on to `07-initial-prompt.md` for the prompt to start Phase 1 with Claude Code.

## Troubleshooting

### `npm install` is very slow

Phaser is a large package. First install can take 2–3 minutes. If it stalls, check network. `npm install --verbose` shows progress.

### Vite dev server doesn't open browser

Add `--open` to `package.json`'s `dev` script: `"dev": "vite --open"`.

### `phaser-box2d` package not found

Check the current package name at https://phaser.io/box2d. The Phaser team has used a few names for the Box2D distribution. Update `package.json` and re-run `npm install`.

### TypeScript can't find Phaser types

After installing Phaser v4, types should be auto-discovered. If not, ensure `tsconfig.json` doesn't restrict `types` in a way that excludes Phaser. The default config in `03-tooling.md` should work.

### Claude Code doesn't read CLAUDE.md

- Run from the repo root, not a sub-folder.
- Check Claude Code version (`claude --version`); the CLAUDE.md convention is widely supported but specifics evolve.
- As a fallback, paste the CLAUDE.md content at the start of your first prompt.

### GitHub Pages doesn't deploy

We're not setting up Pages until Phase 5. When you do:

1. Repo Settings → Pages.
2. Source: "Deploy from a branch."
3. Branch: `main`, folder: `/docs`.
4. Save. Wait a few minutes; visit `https://dzyamik.github.io/pixel-perfect/`.
