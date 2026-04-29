# 02 — Roadmap

## Overview

Solo development with Claude Code. Total target: ~10 weeks. Phases are sequential; each phase produces a `git tag` and a `CHANGELOG.md` entry. No external release ceremony — main branch is the published state.

```
Phase 0 — Bootstrap         (2 days)
Phase 1 — Core engine       (3 weeks)
Phase 2 — Physics adapter   (1.5 weeks)
Phase 3 — Phaser integration (1.5 weeks)
Phase 4 — Examples          (2 weeks)
Phase 5 — Docs & polish     (1 week)
```

Each phase has: **scope**, **definition of done**, **risks**, **handoff to next phase**.

---

## Phase 0 — Bootstrap (2 days)

### Scope
- Initialize git repo locally and on GitHub (`dzyamik/pixel-perfect`).
- Create folder structure exactly as specified in `01-architecture.md`.
- Install tooling per `03-tooling.md`.
- Write `README.md` with project intent (1 paragraph), status badge ("alpha — under development"), and link to roadmap.
- Write skeleton `SKILL.md` (will be filled in over time).
- Add `LICENSE` (MIT), `.gitignore` (Node + Vite + IDE artifacts), `.editorconfig`.
- Configure TypeScript (strict mode), Prettier, ESLint.
- Configure Vitest with one passing smoke test (`expect(true).toBe(true)`).
- Configure Vite dev server pointing at `examples/`.
- Configure VitePress with `docs-dev/` as input, `docs/` as output.
- Configure TypeDoc to emit into `docs/api/`.
- Set up Claude Code in the repo per `04-claude-code-setup.md`.

### Definition of done
- `npm install` completes clean.
- `npm test` runs Vitest, one test passes.
- `npm run dev` opens Vite dev server (empty for now).
- `npm run docs:build` produces a `docs/` folder containing the docs site (will be mostly empty).
- `git push` to GitHub succeeds; repo is public.
- Initial commit message: `chore: bootstrap repo`.
- `git tag v0.0.0` placed on bootstrap commit.

### Risks
- Vite + VitePress + TypeDoc all building into `docs/` need clear separation. Sub-folders: `docs/site/` (VitePress) and `docs/api/` (TypeDoc). GitHub Pages serves `docs/` root with an `index.html` that links to both.

### Handoff
- Repo is reproducible: a fresh clone + `npm install` + `npm test` works.
- Next phase begins by writing the first core module's tests (TDD).

---

## Phase 1 — Core engine (3 weeks)

The heart of the project. Pure TypeScript, zero dependencies, fully tested.

### Week 1 — ChunkedBitmap + Materials

**Tasks:**
1. `src/core/types.ts` — define `Contour`, `Chunk`, `Material`, `HitResult`, `Point`.
2. `src/core/Materials.ts` — `MaterialRegistry` class with `register`, `get`, `getOrThrow`. Air (id 0) is implicit.
3. `src/core/ChunkedBitmap.ts`:
   - Constructor: `new ChunkedBitmap({ width, height, chunkSize, materials })`.
   - `getPixel(x, y) → number` (material id or 0).
   - `setPixel(x, y, materialId) → void` — marks owning chunk dirty.
   - `getChunk(cx, cy) → Chunk`.
   - `forEachDirtyChunk(callback)`.
   - `clearDirty(chunk)`.
   - Coordinate conversion helpers: `worldToChunk`, `worldToChunkLocal`.
4. Tests: 100% line coverage on `ChunkedBitmap`, `Materials`.

**DoD:** all unit tests pass. Can construct a 4096×1024 bitmap, write/read pixels, observe correct dirty-flag behavior.

### Week 2 — Carve, Deposit, Marching Squares

**Tasks:**
1. `src/core/ops/Carve.ts`: `circle`, `polygon`. Both iterate affected pixels, write 0, dirty chunks.
2. `src/core/ops/Deposit.ts`: same primitives, write material id instead.
3. `src/core/algorithms/MarchingSquares.ts`:
   - `extract(chunk, bitmap) → Contour[]`.
   - 16-case lookup table.
   - Padding row/column from neighbor chunks.
   - Saddle-point tie-breaker.
   - Returns world-space coordinates.
4. `src/core/algorithms/DouglasPeucker.ts`:
   - `simplify(contour, epsilon) → Contour`.
   - Recursive divide-and-conquer.
   - Handles closed contours.
5. Tests:
   - Carve circle on empty bitmap → expected pixel pattern.
   - Marching squares on simple shapes (square, circle, donut) → expected vertex counts.
   - Douglas-Peucker reduces vertices ≥ 80% on circle contours.
   - Saddle-point case produces topologically consistent output.

**DoD:** can carve a circle, run marching squares + simplification, get a clean polygon back.

### Week 3 — Flood fill, Spatial queries, ops/fromAlpha

**Tasks:**
1. `src/core/algorithms/FloodFill.ts`:
   - `findIslands(bitmap, anchors) → Island[]`.
   - 4-connected BFS.
   - Anchor strategies: `bottomRow`, `customPoints`.
2. `src/core/ops/Carve.ts` extension: `fromAlphaTexture` — accepts an `ImageData` or `HTMLCanvasElement` representing alpha, threshold, x/y offset.
   - Note: this lives in core but operates on raw pixel data passed in. The Phaser layer will provide texture-extraction helpers.
3. `src/core/queries/Spatial.ts`:
   - `isSolid(bitmap, x, y) → boolean`.
   - `sampleMaterial(bitmap, x, y) → number`.
   - `raycast(bitmap, x1, y1, x2, y2) → HitResult | null` (Bresenham line walk).
   - `surfaceY(bitmap, x) → number`.
   - `findGroundBelow(bitmap, x, y, maxDist) → number | null`.
4. `src/core/index.ts` — public re-exports.
5. Tests for all of the above.

**DoD of Phase 1:**
- `git tag v0.1.0`.
- Core module is feature-complete for v1.
- ≥ 90% test coverage on `src/core/`.
- `npm test` runs in < 5 seconds.
- A 200-line example script can: create bitmap, deposit a circular island, carve a hole, run marching squares, render contours to console as ASCII art. (This script lives in `tests/integration/` as a smoke test.)

### Risks
- Marching squares saddle-point bugs are notoriously subtle. Mitigation: write a test for each of the 16 cases explicitly with hand-drawn input.
- Douglas-Peucker on degenerate inputs (3-vertex polygon, collinear points) can NaN. Mitigation: guard with explicit edge-case tests.

---

## Phase 2 — Physics adapter (1.5 weeks)

Bridge core → Box2D. Headless tests where possible (Phaser Box2D runs in Node with care).

### Tasks
1. `src/physics/ContourToBody.ts`:
   - `contourToChain(contour, world, bodyDef) → b2ChainShape`.
   - `contourToPolygon(contour, world, bodyDef) → b2PolygonShape | null` (null if non-convex or > 8 verts; caller falls back to chain).
2. `src/physics/Box2DAdapter.ts`:
   - Holds `Map<Chunk, BodyId[]>`.
   - `rebuildChunk(chunk, contours)`: destroys old bodies, creates new chains.
   - `destroyChunk(chunk)`: cleanup.
   - `createDebrisBody(contour, material) → BodyId`.
3. `src/physics/DeferredRebuildQueue.ts`:
   - `enqueueChunk(chunk)`, `enqueueDebris(contour, material)`.
   - `flush(adapter, perFrameBudget)` — drains up to `perFrameBudget` chunks; remaining roll over.
4. `src/physics/DebrisDetector.ts`:
   - Wraps `FloodFill.findIslands`.
   - Triggered by carve operations when heuristic fires.
   - Emits via callback or event emitter (decided in implementation).
5. `src/physics/index.ts` — re-exports.
6. Integration tests: create world, carve, flush, verify Box2D body counts match expected chunk contours.

### DoD
- `git tag v0.2.0`.
- Can run a headless integration test that destroys a chunk of terrain and observes correct body lifecycle (old destroyed, new created, no leaks).
- Memory leak check: 1000 destruction events with `--expose-gc` shows no growth in retained Box2D bodies.

### Risks
- Box2D body creation/destruction during the physics step crashes. Mitigation: deferred queue is the entire point; verify with stress test that we never create/destroy mid-step.
- Chain shape edge cases: very small polygons (< 3 vertices after simplification) must be skipped. Add validation.

### Handoff
- Phaser layer can call `box2dAdapter.rebuildChunk()` and trust it.

---

## Phase 3 — Phaser integration (1.5 weeks)

The user-facing layer. This is where the library becomes ergonomic.

### Tasks
1. `src/phaser/PixelPerfectPlugin.ts`:
   - Extends `Phaser.Plugins.BasePlugin`.
   - Adds `scene.pixelPerfect = { terrain, sprite }` factories on scene init.
2. `src/phaser/TerrainRenderer.ts`:
   - Per-chunk `DynamicTexture` management.
   - `repaint(chunk, bitmap, materials)` — flat color path for v1; texture-tiled path stubbed for v1.1.
   - Use `setPixel` in tight loop. Profile and if too slow, batch via `ImageData` then `putImageData`.
3. `src/phaser/DestructibleTerrain.ts`:
   - Composite `GameObject`.
   - Owns `ChunkedBitmap`, `Box2DAdapter`, `DeferredRebuildQueue`, `TerrainRenderer`.
   - Public API: `carve.{circle, polygon, fromAlpha}`, `deposit.{...}`, `isSolid`, `raycast`, etc.
   - Wires `EventEmitter` for `debris:detached`, `chunk:rebuilt`.
   - Hooks into scene's update cycle: `postUpdate` → flush queue → repaint dirty chunks.
4. `src/phaser/PixelPerfectSprite.ts`:
   - Extends `Phaser.GameObjects.Sprite`.
   - Lazily computes alpha bitmap from texture.
   - `overlapsPixelPerfect(other) → boolean`.
   - `overlapsTerrain(terrain) → boolean`.
5. `src/phaser/index.ts` and top-level `src/index.ts`.
6. Type definitions: ensure `scene.pixelPerfect` is typed via module augmentation.

### DoD
- `git tag v0.3.0`.
- A minimal Phaser scene can:
  - Register the plugin.
  - Create a terrain from a flat island.
  - On click, carve a hole.
  - Watch the visual update and the body update (debug overlay shows colliders).
- Pixel-perfect sprite overlap demo works (two sprites with transparent regions, only solid pixels collide).

### Risks
- Phaser v4 plugin API has settled but could change in late RCs. Mitigation: pin to current stable RC (RC7 as of April 2026); upgrade after Phase 5.
- DynamicTexture performance for full-chunk repaints. If `setPixel` per-pixel is slow, switch to `Uint8ClampedArray` + `putImageData`.

---

## Phase 4 — Examples (2 weeks)

Five runnable demos under `examples/`. Each demo is its own Vite entry, accessible from a landing page.

### Demos

1. **`01-basic-destruction/`** — flat ground, click to carve circles, observe colliders. Debug overlay on. ~1.5 days.
2. **`02-worms-style/`** — island terrain, controllable character with jump, throwable grenades that explode and carve terrain. Detached chunks fall as debris. The trailer-piece. ~4 days.
3. **`03-pixel-perfect-sprite/`** — two sprites with transparent regions; demonstrate that bounding-box collision triggers but pixel-perfect does not until they truly overlap. ~1 day.
4. **`04-falling-debris/`** — stress test: rapid destruction creating lots of debris, settling realistically. ~2 days.
5. **`05-generate-from-image/`** — load a PNG with transparent background, generate terrain matching it, demonstrate carving works on the generated shape. ~1.5 days.

### Tasks
1. `examples/index.html` — landing page with links to each demo.
2. Each demo: own folder, `index.html`, `main.ts`, minimal Phaser scene.
3. Shared helpers in `examples/_shared/` (debug overlay, character controller, FPS counter).
4. Vite config: multi-page build.

### DoD
- `git tag v0.4.0`.
- All five demos run via `npm run dev` and visit `/examples/`.
- Each demo holds 60 fps on i5/mid-tier mobile in steady state.
- Example #2 (Worms-style) is recordable as a clean 30-second clip.

### Risks
- Worms-style demo balloons in scope (character controllers, grenade physics, etc.). Mitigation: every feature must justify itself as showcasing the library, not the demo. Use simplest possible character controller.

---

## Phase 5 — Docs & polish (1 week)

Make the repo presentable to a stranger.

### Tasks
1. `README.md`:
   - Hero gif (recorded from Worms-style demo).
   - One-paragraph pitch.
   - Quickstart code snippet (10 lines, `<script>` tag style and ESM).
   - Link to docs site.
   - Status section (alpha; what works, what doesn't).
   - Contributing section (link to issues).
2. `docs/site/` (VitePress):
   - Landing page mirrors README.
   - Concepts: what's a chunk, what's a contour, the bitmap-as-truth principle.
   - Recipes: 5 short guides — basic destruction, image-based terrain, debris handling, pixel-perfect sprite, custom materials.
   - API reference auto-generated from TSDoc into `docs/api/`.
3. `SKILL.md` finalized:
   - Overview, when to use, when not to use.
   - Quickstart.
   - Common pitfalls (most relevant for AI consumers).
   - Lookup table of public API surface.
4. Performance pass:
   - Profile each demo, fix hotspots.
   - Verify performance targets from `01-architecture.md`.
5. Repo polish:
   - Add issue templates (`bug`, `feature`).
   - Add `CONTRIBUTING.md`.
   - Add `CODE_OF_CONDUCT.md` (Contributor Covenant).
   - Verify all TODO comments are gone from `src/`.

### DoD
- `git tag v1.0.0`.
- `docs/` folder is built and ready for GitHub Pages manual deployment.
- Repo passes a "fresh visitor" test: someone arrives at the GitHub page, reads README, can run a demo within 5 minutes.

### Risks
- TypeDoc + VitePress integration has rough edges. Mitigation: keep them in separate sub-folders; don't attempt deep integration in v1.

---

## Cross-cutting concerns

### Testing strategy

| Layer | Test type | Coverage target |
|---|---|---|
| Core | Unit (Vitest) | ≥ 90% |
| Physics adapter | Integration (Vitest, headless Phaser Box2D) | ≥ 70% |
| Phaser integration | Manual via examples + smoke tests | best effort |

No E2E browser tests in v1. The five examples serve as manual integration suite.

### Git workflow

- `main` is always shippable. No long-lived branches.
- Each phase ends with a tag and a `CHANGELOG.md` entry.
- Commits follow Conventional Commits: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.
- Squash-merge feature branches if you ever use them; `main` history stays linear.

### Working with Claude Code

- Every phase opens with a "phase context" prompt that loads relevant files into context.
- One feature at a time. Don't ask Claude Code to implement multiple algorithms in one session.
- After each non-trivial change, run `npm test`. The lockstep test → fix → test loop is where Claude Code shines.
- Use the bundled Phaser v4 skills (in the Phaser repo's `skills/` folder) — point Claude Code at them when working on the Phaser layer.

### Versioning (informal)

- Phase tags: `v0.0.0` (bootstrap), `v0.1.0` (core), `v0.2.0` (physics), `v0.3.0` (phaser), `v0.4.0` (examples), `v1.0.0` (docs + polish).
- After v1.0.0: patch versions for fixes, minor for non-breaking features, major for breaking changes. Even though we're not publishing to npm, this discipline helps future-you and any external readers.

### What success looks like

By the end of Phase 5:
- Public GitHub repo, clearly written README, working demos.
- A stranger on the Phaser Discord can be linked to the repo and immediately see what it does.
- Worms-style demo is the visual proof.
- The repo is ready to graduate to npm if/when you decide to.

### What failure looks like (and how to spot it early)

- **Phase 1 takes 5+ weeks.** Cause: scope creep into Phase 2 work. Fix: stop, finish core to tested-spec, move on.
- **Phase 2 hits Box2D edge cases for two weeks.** Cause: trying to support every weird contour. Fix: validate inputs aggressively, fail loudly on unsupported shapes, document the limits.
- **Phase 4 demos look bad.** Cause: art over-investment. Fix: programmer art is fine for v1; the library is the product, not the demos.
- **Phase 5 docs sprawl.** Cause: writing a textbook. Fix: README + 5 recipes + API ref. Stop.
