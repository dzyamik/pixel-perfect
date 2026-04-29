# 04 — Claude Code setup

How to configure Claude Code for this project so it has the right context, skills, and constraints.

## Install Claude Code

If you don't already have it:

```bash
# Install globally via npm (current installation method)
npm install -g @anthropic-ai/claude-code

# Verify
claude --version

# Authenticate
claude login
```

The exact install command may have changed since this doc was written. Check `https://docs.claude.com/en/docs/claude-code/quickstart` for the current command. From the Anthropic product information, Claude Code is the official CLI tool for agentic coding.

## Recommended Claude Code IDE integrations

Optional but useful for this project:

- **Claude Code for VS Code** — inline editing, easier file context. Install from the VS Code marketplace.
- **Claude Code for JetBrains** — same idea if you prefer WebStorm.

These are not required. Pure terminal workflow works.

## Project-level Claude Code configuration

Claude Code reads `CLAUDE.md` (and `.claude/` directory) from the project root for project context. Create both during Phase 0 bootstrap.

### CLAUDE.md (project root, committed)

This file lives at the repo root and is read at the start of every Claude Code session. It's the "project README for AI." Create it with this content:

```markdown
# pixel-perfect — Claude Code project context

## What this project is

A Phaser v4 library providing pixel-perfect spatial reasoning: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities. The bitmap is the source of truth; renderers and physics colliders are derived from it.

## Architecture (read first)

Three layers, depends downward only:

- `src/phaser/` — Phaser v4 plugin and GameObjects
- `src/physics/` — Box2D adapter
- `src/core/` — pure TypeScript, zero runtime deps

Detailed architecture: `docs-dev/01-architecture.md`.
Roadmap: `docs-dev/02-roadmap.md`.
Tooling: `docs-dev/03-tooling.md`.

## Hard rules

1. Core layer must remain dependency-free. No imports from `src/physics/` or `src/phaser/` into `src/core/`. No npm dependencies in core code.
2. Bitmap is the source of truth. Visuals and colliders are projected from it. Never the reverse.
3. Box2D body creation/destruction is deferred to end-of-frame. Never inside a physics step.
4. Marching squares output uses world coordinates, not chunk-local.
5. Every `setPixel` mutation must mark the owning chunk dirty.
6. Test before claiming done. Run `npm test` after non-trivial changes.

## Code style

- TypeScript strict mode. No `any` without justification.
- Pure functions over classes when reasonable. Classes for stateful subsystems (ChunkedBitmap, Box2DAdapter).
- One concept per file. Match the file structure in `01-architecture.md`.
- TSDoc on every exported symbol.
- Conventional Commits for messages: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Testing

- Unit tests for all `src/core/` exports. Target ≥ 90% coverage.
- Integration tests for `src/physics/` using headless Phaser Box2D where feasible.
- Manual testing for `src/phaser/` via examples.
- Run `npm test` before commits.

## Workflow with Claude Code

- One feature at a time. Don't ask for "implement marching squares + Douglas-Peucker + flood fill in one session."
- Tests first when possible. The tight test→implement→test loop is where AI-assisted dev shines.
- After significant changes: `npm run typecheck && npm test && npm run lint`.
- If you change architecture, update `docs-dev/01-architecture.md` in the same commit.

## Phaser v4 specifics

- Use Phaser v4 APIs only. v3 patterns (Pipelines, FX/Masks separate from Filters) are removed.
- Use `SpriteGPULayer` for high-density sprite rendering when applicable.
- Use `DynamicTexture` for chunk visuals; prefer partial uploads.
- Phaser ships AI Agent skills in `node_modules/phaser/skills/`. Read the relevant ones when working in `src/phaser/`.

## Phaser Box2D specifics

- Use `b2ChainShape` for terrain colliders, `b2PolygonShape` for convex debris ≤ 8 vertices, `b2ChainShape` (loop) for non-convex debris.
- Box2D works in meters. Coordinate conversion is handled by the adapter; do not leak meter coordinates outside it.
- Body lifecycle is owned by the adapter; do not create or destroy Box2D bodies elsewhere.

## What this project is NOT (yet)

- Not on npm. Local development only in v1.
- No CI/CD. Tests run locally.
- No falling sand / cellular automaton — that's v2.
- No Matter.js adapter — that's v2.
- No multiplayer determinism guarantees.

## When stuck

- Read `docs-dev/01-architecture.md` for design intent.
- Check `node_modules/phaser/skills/` for Phaser v4 specifics.
- Consult `https://phaser.io/box2d` for Box2D API.
- Don't invent APIs. Ask for clarification or read the source.
```

### .claude/ directory (committed)

Some Claude Code versions read additional config from `.claude/`. Create:

```
.claude/
├── settings.json           # project-level settings (if supported)
└── skills/                 # project-specific skills
    └── pixel-perfect.md    # this project's own skill (consumer-facing)
```

The structure of `.claude/` evolves; check current Claude Code docs at `https://docs.claude.com/en/docs/claude-code/`. If the directory format has changed, place project-level skills wherever the current Claude Code version reads them.

## Skills to make available

Claude Code's "skills" are markdown files that Claude reads to understand how to work in a given context. For this project, four sources of skills matter:

### 1. Phaser v4 bundled skills

Phaser v4 ships 28 AI Agent skills in `node_modules/phaser/skills/` after `npm install phaser`. They cover every major Phaser subsystem. Claude Code will not auto-discover these — point at them explicitly when working on Phaser-layer code.

Useful Phaser skills for this project (exact filenames depend on the Phaser release):

- Plugin development
- DynamicTexture / textures
- Game Objects and containers
- Scenes and lifecycle
- Filters and masks (replaces v3 FX)
- Camera system
- v3-to-v4 migration (useful when reading old Phaser code online)

When starting a session that touches the Phaser layer:

> "Before answering, read the relevant Phaser skills in `node_modules/phaser/skills/`. We're working on [specific subsystem]."

### 2. Phaser Box2D documentation

Phaser Box2D doesn't ship as bundled skills (yet). Treat its examples folder and online docs as reference. When working on `src/physics/`:

> "Reference Phaser Box2D docs at https://phaser.io/box2d/docs and the examples in node_modules/phaser-box2d/examples/ before implementing."

### 3. Project-internal skill

`.claude/skills/pixel-perfect.md` is the skill *for this library itself*. It explains the public API, common patterns, and pitfalls. As you build, update this skill so future sessions have current context.

Skeleton:

```markdown
# pixel-perfect skill

## When to use
This skill applies when working anywhere inside the pixel-perfect repo,
or when consuming the pixel-perfect library from another project.

## Core concept
Bitmap is truth. Read or modify the ChunkedBitmap; renderers and Box2D
bodies update automatically at end-of-frame.

## Public API (for library consumers)
[fill in as APIs stabilize]

## Pitfalls
[fill in as bugs are found and fixed]

## Code patterns
[fill in as conventions emerge]
```

### 4. The repo's own `docs-dev/`

The seven planning documents in `docs-dev/` are part of Claude Code's context for this project. The `CLAUDE.md` at the root already tells Claude to read them when relevant. No extra setup needed.

## MCP servers

MCP (Model Context Protocol) servers extend Claude Code with external capabilities. For this project, useful MCPs:

### Recommended

- **GitHub MCP** — for managing issues, reading PRs, browsing the repo through Claude. Useful when you start getting external contributors. Set up via:
  ```bash
  claude mcp add github --token <your-pat>
  ```
  Or configure in `.claude/mcp.json` (check current docs for the exact path).

- **Filesystem MCP** — Claude Code already has direct file access in the project root, so this is usually redundant. Skip unless you have a specific use case.

### Optional but useful

- **Context7 MCP** — auto-fetches latest documentation for any package mentioned in code. Helpful for keeping Phaser API references current. Search "Context7 MCP" for current install instructions.

- **Web fetch / web search** — Claude Code has these built in for the chat interface; the CLI version can have them via MCPs. Useful for checking current Phaser releases.

### Not needed

- Database MCPs — no database in this project.
- Email / calendar / chat MCPs — not relevant.
- Cloud provider MCPs (AWS, GCP) — not relevant.

The key insight: MCPs are tools for accessing *external state*. This project is mostly self-contained, so MCP needs are modest.

## Plugins / extensions

For VS Code with Claude Code:

- **Claude Code extension** itself.
- **Vitest extension** — see test results inline.
- **ESLint** — auto-fix on save.
- **Prettier** — formatting on save.
- **Error Lens** — inline error display, helps Claude Code understand context faster when you paste screenshots.

## Working session patterns

### Pattern: Starting a new phase

1. Open Claude Code in the repo root.
2. Reference the phase doc: "We're starting Phase 1 — read `docs-dev/02-roadmap.md` Phase 1 section."
3. State the first task explicitly: "Implement `ChunkedBitmap` per the architecture doc. Start with tests."
4. Let Claude propose a plan. Approve or correct before implementation begins.

### Pattern: Implementing one algorithm

1. Tell Claude which algorithm and where it lives: "Implement marching squares in `src/core/algorithms/MarchingSquares.ts` per the architecture doc."
2. Ask for tests first: "Write `MarchingSquares.test.ts` with the 16 cases as explicit test cases. We'll implement after."
3. Implement against the tests.
4. Run `npm test`. Iterate.

### Pattern: Debugging

1. Run `npm test` and paste the failing output.
2. Don't ask Claude to "fix everything." Ask: "This test fails. Why?"
3. Confirm the diagnosis, then ask for a fix.

### Pattern: Reviewing a session's work

1. Before committing, ask Claude to summarize what changed.
2. Ask for a Conventional Commit message.
3. `git add` selectively — review diffs.
4. Commit.

## What to put in CLAUDE.md vs. what to say in the prompt

**CLAUDE.md** holds invariants — things true across every session. Architecture rules. Hard limits. File layout.

**Per-session prompts** hold task context — the current goal, the files to focus on, the specific question.

If you find yourself repeating the same context in every prompt, move it to `CLAUDE.md`.

## Common Claude Code anti-patterns to avoid

- **Asking Claude to refactor while implementing.** Two changes at once obscures bugs. One task per session.
- **Skipping tests.** When Claude writes code without running tests, errors compound. Make `npm test` part of every loop.
- **Ignoring TS errors.** "It works" without `npm run typecheck` passing means it doesn't actually work.
- **Letting `CLAUDE.md` grow stale.** When architecture changes, update the file in the same commit.
- **Using Claude as a search engine.** Claude doesn't know your repo's current state without reading it. Tell it which files matter for this task.

## After Phase 0 bootstrap

You should have:

- `CLAUDE.md` at repo root, committed.
- `.claude/skills/pixel-perfect.md` as a stub.
- Phaser v4 installed (skills available in `node_modules/phaser/skills/`).
- Claude Code working: `claude` command runs, sees the project context.

Test it: open Claude Code in the repo and ask "What's this project?" — the response should accurately describe pixel-perfect based on `CLAUDE.md`.
