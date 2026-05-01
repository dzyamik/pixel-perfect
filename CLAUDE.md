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
Sim parameter ranges + edge cases: `docs-dev/04-tuning-research.md`.
Sim design rationale (why it's shaped this way): `docs-dev/05-simulation.md`.
v3.0 mass-based fluid plan (shipped as v3.0.0): `docs-dev/06-v3-mass-based-fluid.md`.
v3.1 pool-based fluid plan (shipped as v3.1.0): `docs-dev/07-v3.1-pool-based-fluid.md`.
**Running progress + open issues: `docs-dev/PROGRESS.md`** — read this at session start to catch up on what's in flight.

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

## Demo build deployment (no CI)

The `docs/` folder is the deployed demo site (committed to the repo).
There is no CI; demo deployment is manual:

1. Make demo changes under `examples/`.
2. Run `npm run build` — Vite outputs into `docs/`.
3. `git add docs && git commit` alongside the source changes.

Don't push demo source changes without an updated `docs/` build, or
the public site will lag behind the source.

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