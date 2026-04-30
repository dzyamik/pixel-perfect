# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely; this project does not yet publish to npm.

## [v2.2.0] — 2026-04-30

Sand-pile-becomes-static. The bridge between fluid sim and physics:
sand grains that have been at rest for `settleAfterTicks` tick(s)
get promoted in place to a `'static'`-simulation variant ("settled
sand"), join the static collider mesh, and start supporting dynamic
bodies. Demo 09 grew a `B`-key ball-drop so you can see this
end-to-end — pour sand, wait for the pile, drop a ball, watch it
roll on the cured pile.

### Added — data model

- `ChunkedBitmap.cellTimers` — lazy-allocated `Uint8Array(width *
  height)` of per-cell counters. Used by `CellularAutomaton.step`
  for any feature that needs state across ticks. Auto-reset to 0
  by `setPixel` because a cell's content just changed; whatever
  timer was tracked for the previous occupant is no longer
  meaningful for the new one. Caps at 255 (Uint8Array max).
- `Material.settlesTo?: number` and `Material.settleAfterTicks?:
  number` — the promotion target id and the rest-tick threshold.
  Both must be set for settling to engage; either undefined
  disables the path.

### Added — simulation

- `CellularAutomaton.stepSand` checks for settling whenever a sand
  cell didn't move this tick (blocked downward AND no diagonal
  slide). Increments the cell's timer; promotes via `setPixel(x,
  y, settlesTo)` when the threshold is reached. Sand cells that
  move on a given tick reset their timer (handled implicitly by
  `setPixel`'s auto-reset).

### Demo 09

- New `SETTLED_SAND` material — `simulation: 'static'`, slightly
  desaturated tone vs SAND so grains are visibly "locking in".
- `SAND.settlesTo = SETTLED_SAND.id`, `settleAfterTicks = 30`
  (~0.5 s at 60 fps).
- Box2D world wired in. `B` key spawns a debris ball at the cursor.
  The ball falls onto the funnel, lands on settled-sand piles,
  rolls naturally — the visual proof that fluid sim and physics
  bridge correctly.
- Stats overlay tracks sand / water / settled-sand / ball counts.

### Tests

5 new cases in `tests/core/algorithms/CellularAutomaton.test.ts`:
timer accumulates when at rest and promotes at threshold; moving
sand never accumulates (timer resets on every move); sand without
settlesTo configured never promotes; promoted material is static
and doesn't move on subsequent ticks; carving a settled cell
clears it without leftover state. Total suite now 275 tests
across 20 files; typecheck and lint clean.

---

## [v2.1.1] — 2026-04-30

Build / tooling polish.

### Fixed

- **Dev server now serves `/media/*` from the project root.** Vite's
  `root: 'examples'` meant the dev server couldn't see the
  project-root `media/` folder, so requests for `/media/hero.gif`
  fell through to the SPA index.html (status 200 but `text/html`,
  ~9 KB instead of 740 KB). The README and the demo landing page
  reference `media/hero.gif`, so the page showed a broken image
  during local development. Production was unaffected — the build's
  `cp -r media docs/` step copies the file into the deployed
  location. Added a small Vite plugin
  (`pp-serve-project-root-media`) in `vite.config.ts` that
  intercepts `/media/*` requests and streams from the project root,
  with a directory-traversal guard.

---

## [v2.1.0] — 2026-04-30

Water joins sand as a simulated fluid kind. Sand and water coexist
with a density rule (sand sinks through water on straight-down moves;
water can't displace sand).

### Added

- `SimulationKind` extended to `'static' | 'sand' | 'water'`.
- `'water'` cell rules: fall straight down → diagonal-down →
  spread horizontally. The horizontal-spread rule is what lets a
  pool of water settle to a level over multiple ticks.
- Sand-water density swap: a sand cell with water below swaps with
  the water on its straight-down move. Sand sinks through water
  columns one row per tick. Diagonals stay air-only — no
  multi-cell-swap bookkeeping.

### Changed

- `CellularAutomaton.step` refactored from a sand-only inner loop
  into a per-kind dispatch (`stepSand` / `stepWater`). Same scan
  order, same bottom-up + L/R alternation invariants.

### Demo 09

`examples/09-falling-sand/` retitled "falling sand + water". `1` and
`2` keys switch between sand and water as the active fluid; the
brush outline tints with the active fluid's color so you see what
you'd spawn before clicking. Stats overlay tracks both counts.

### Tests

6 new cases in `tests/core/algorithms/CellularAutomaton.test.ts`:
water falls straight down, water spreads horizontally to a flat
floor (column drains, three water cells at the floor, no leftover
mid-air water), water fills a U-cup from the bottom up, sand sinks
through a water column on straight-down moves, water doesn't
displace sand (less dense), mixed sand-water column settles into
sand-bottom / water-top after enough ticks. Total suite now 270
across 20 files; typecheck and lint clean.

---

## [v2.0.0] — 2026-04-30

The headline v2 feature lands: a cellular-automaton step that
simulates fluid materials (sand for now; water / gas later) on the
bitmap. Static and fluid materials coexist in the same world; the
static-material colliders generate physics bodies, fluid materials
move per tick under gravity. Demo 09 (falling sand) is the
visualization.

### Added

- `Material.simulation?: 'static' | 'sand'` — optional field on
  `Material`. Defaults to `'static'` for v1 back-compat. Existing
  v1 materials work without changes.
- `core/algorithms/CellularAutomaton.step(bitmap, tick?)` — pure
  one-tick simulator. Bottom-up sweep so a grain falls one row per
  tick; per-tick L/R alternation kills directional bias on diagonal
  slides. Sand can't tunnel through walls (a diagonal slide
  requires the side cell at the same row to also be air). Air is
  the only "passable" cell in v2.0; sand doesn't yet displace
  other fluid kinds.
- `DestructibleTerrain.simStep()` — runs one tick on the terrain's
  bitmap with an internal counter that flips L/R bias each call.
- `DestructibleTerrainOptions.autoSimulate` — when `true`, the
  terrain runs `simStep()` at the start of every `update()` call,
  before the rebuild flush. Default `false` (v1 behavior unchanged).

### Changed

- **Collider extraction filters by simulation kind.** Both
  `chunkToContours` and `componentToContours` now skip cells whose
  material's `simulation` is non-static. This prevents per-frame
  sand motion from triggering per-frame physics rebuilds —
  necessary for the simulation to be cheap.

### Demo 09 — falling sand

`examples/09-falling-sand/`: stone funnel, left-click spawns sand
at the cursor, right-click carves the stone, space dumps a one-shot
patch of sand at the top, R resets. The cellular automaton runs
auto-simulate via the plugin's POST_UPDATE hook; nothing else to
wire on the user's end.

### Tests

12 new tests in `tests/core/algorithms/CellularAutomaton.test.ts`:
single grain falls, sand at bottom row stays put, sand on rock
doesn't move, stone never moves, diagonal slide over a single
block, no tunneling through walls, alternation across ticks,
collapse-into-pyramid invariants (sand count preserved + no sand
floats), sand doesn't displace sand, bottom-up correctness across
tick chain, world-boundary handling at x=0, unset simulation
defaults to static. Total suite now 264 tests across 20 files;
typecheck + lint clean.

### Compatibility

This is a major version bump to mark the addition of fluid
simulation as a meaningful capability shift, not because of any
breaking signature changes. All v1 code continues to work
unchanged: `Material.simulation` is optional (defaults to
`'static'`), `autoSimulate` is opt-in (defaults to `false`), and
the collider-filter behavior for v1 materials is identical (no
`simulation` field → treated as static → generates colliders just
like v1).

---

## [v1.1.0] — 2026-04-30

Two `PixelPerfectSprite` v1 limitations lifted (scaling and rotation),
the last open known limitation closed (sub-pixel jitter on actively-
carved chunks), and three new public helpers in `core/queries`.

### Added — `PixelPerfectSprite` scaling + rotation

- `setScale(...)` is honored. The cached alpha mask is nearest-
  neighbor stretched to `displayWidth × displayHeight` on
  extraction. Cache invalidates automatically when scale changes,
  so runtime `setScale` works without manual
  `invalidateAlphaMask()` calls. Memory cost is `O(scaleX × scaleY)`
  per cached mask — fine up to 8× for typical sprite sizes.
- `rotation` is honored. Unrotated sprites dispatch to the cheap
  axis-aligned path (`maskMaskOverlap` / `maskBitmapOverlap`);
  rotated sprites use the new transformed variants which
  back-rotate each sample point at the cost of a few muls/adds
  per pixel. AABB-cull bounds the work to the rotated bounding
  box's intersection.
- New public method `sprite.getEffectiveAlphaMask()` returns the
  post-flip, post-scale mask the overlap math actually uses.
  Useful for visualization (e.g. drawing the alpha-mask outline)
  without duplicating extraction logic.

### Added — `core/queries/AlphaOverlap` (transformed surface)

```ts
interface MaskTransform {
    x: number;
    y: number;
    pivotX?: number;     // mask-local
    pivotY?: number;
    rotation?: number;   // radians
}

transformedMaskBounds(mask, t)            // scene-space AABB
maskMaskOverlapTransformed(a, ta, b, tb)  // rotated sprite ↔ sprite
maskBitmapOverlapTransformed(mask, t, bm) // rotated sprite ↔ terrain
```

The transform places the mask's pivot at scene `(x, y)` and rotates
the mask by `rotation` radians around `(pivotX, pivotY)` in
mask-local space. With the defaults the transform reduces to the
axis-aligned `maskMaskOverlap` / `maskBitmapOverlap` convention.

Sampling correctness: integer-pixel back-rotation lands on cell
boundaries at multiples of 90°, and `floor()` rolls into the wrong
neighbor. The transformed paths sample at pixel centers
(`sx + 0.5, sy + 0.5`) to avoid the off-by-one. Axis-aligned
identity transforms still return identical results to the simple
overlap helpers.

### Added — `AlphaOverlap.maskToContours`

Wraps an alpha mask in a single-chunk temp `ChunkedBitmap`, runs
marching squares + Douglas-Peucker, and returns contours in
mask-local coordinates. Backs the alpha-mask outline drawing in
demos 08; useful for any UI that wants to outline a sprite's
pixel-perfect footprint.

### Fixed — sub-pixel jitter on actively-carved chunks

The last open known limitation. Continuous-drag carving rebuilt a
chunk's static body every frame; `b2DestroyShapeInternal` woke
every dynamic body contacting it, and the cycle of "wake → gravity
for one step → narrow-phase contact recreation → resolve back"
injected a small velocity each frame that didn't fully dissipate
before the next rebuild. Box2D's natural sleep timer never reached
`sleepTime` under continuous waking.

`Box2DAdapter.restoreDynamicBodies` now has a force-settle branch:
if a body has at least one static shape overlapping its AABB AND
its pre-rebuild speed² is below `0.01 m²/s²` (~0.1 m/s; tighter
than Box2D's natural sleep threshold of `0.05`), zero its velocity
and sleep regardless of pre-rebuild awake state. Acts as the
manual shortcut for what Box2D's `sleepTime` accumulator would do
if the rebuild cycle weren't waking the body each frame. See
`docs-dev/PROGRESS.md` § "RESOLVED — sub-pixel jitter" for the
full design record + trade-off discussion.

### Demos

- Demo 08 (sprite playground) gained scale + rotation sliders. The
  cyan alpha-mask outline projects each contour vertex through the
  same Phaser scale-and-rotate transform, so the outline tracks
  scaling and rotation in real time.
- Demo 08's AABB indicator switched to `sprite.getBounds()` so the
  rectangle shows the rotated AABB (what a naive cheap-collision
  pre-check would actually see).

### Tests

12 new tests across `tests/core/queries/AlphaOverlap.test.ts` and
`tests/integration/Phase2Pipeline.test.ts` covering the transformed
surface (AABB invariants, identity reduces to axis-aligned,
90°/180° geometry checks, rotated mask vs bitmap solid block) and
the force-settle path (low-vel awake body settles; fast body
preserved). Total suite now 252 tests across 19 files; typecheck
and lint clean.

---

## [v1.0.0] — 2026-04-30

Phase 5 of `docs-dev/02-roadmap.md`: docs & polish. Project reaches
v1: stable public API, complete example surface, browseable docs.

### Added — onboarding & polish

- TypeDoc API reference auto-generated into `docs/api/` as part of
  every `npm run build`. Linked from README, the demo landing
  footer, and CONTRIBUTING.
- `CONTRIBUTING.md` (dev workflow, Conventional Commits, testing
  expectations), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1),
  and `.github/ISSUE_TEMPLATE/{bug,feature}.yml` for structured
  issue intake.
- Re-exported public-surface types from each layer's `index.ts`
  (`BodySnapshot`, `BaseShapeOptions`, `TerrainPhysics`,
  `DebrisCreatedEvent`, `chunkToContours`, `contourToTriangles`,
  `paintChunkPixels`, `buildColorLut`, `AlphaMask`) so the
  generated API ref covers everything users can reach.
- "View source" link on every demo's nav, pointing at the demo's
  `main.ts` on GitHub. Each runnable demo doubles as a copy-
  pasteable code reference.

### Added — demo 08 — sprite playground

`examples/08-sprite-playground/`: drag-and-test sandbox for
`PixelPerfectSprite`. Toolbar checkboxes for outline / AABB
visibility; file input (and canvas drag-drop) to load any PNG and
swap the dragger's texture. Cyan outline traces the alpha mask
the collision math actually uses, via the new
`AlphaOverlap.maskToContours(mask, epsilon)` primitive.

### Added — `core/queries/AlphaOverlap.maskToContours`

Public helper that wraps an alpha mask in a single-chunk temp
`ChunkedBitmap`, runs marching squares + Douglas-Peucker, and
returns contours in mask-local coordinates. Useful for any UI
that wants to outline a sprite's pixel-perfect footprint without
rolling marching squares by hand. 4 unit tests cover empty masks,
single blobs, multiple disjoint blobs, and edge-touching cells.

### Changed

- Architecture, changelog, and skill docs reconciled with what
  actually shipped after the Phase 3 collider-model rewrite (per-
  chunk + polygon, snapshot/restore + ghost-float fix). Stale
  references to `b2ChainShape`, the v0.2.5 cross-chunk stitching,
  the `perFrameBudget` option, and the `terrain.on(...)` event
  surface are gone.
- `npm run build` chains `vite build` and then `npm run docs:api`
  so the TypeDoc output survives Vite's `emptyOutDir: true` and
  lands alongside the demos at `docs/api/`.

### Tests

- 5 new tests in `tests/core/queries/AlphaOverlap.test.ts` (4 for
  `maskToContours`, plus the prior 16 still pass).
- Total suite now 240 tests across 19 files, ~1.4 s. typecheck +
  lint clean.

### Known limitations carried into v1.x

- Sub-pixel jitter on bodies in the chunk being **actively**
  carved during continuous drag — closed in v1.1.0.
- `PixelPerfectSprite` overlap math assumes `scale = 1` and
  `rotation = 0` — both lifted in v1.1.0.
- Hero gif/video for the README is a v1.0.x polish item — the
  recipe is in `PROGRESS.md`.

---

## [v0.4.0] — 2026-04-30

Phase 4 of `docs-dev/02-roadmap.md`: examples + perf pass.

### Added — examples

- **Demo 06 — Worms-style** (`examples/06-worms-style/`). The
  trailer piece. Walking circle character on a wide hilly bitmap;
  arrows / WASD walk + jump (grounded check via a tiny pixel probe
  against the bitmap, no Box2D contact listener); F throws fused
  grenades that carve craters and apply a radial linear impulse to
  nearby dynamic bodies; cliff slabs detached by the carve fall as
  dynamic debris bodies via the existing `extractDebris` path.
  Camera follows the player; G toggles a green-line collider debug
  overlay; R resets.
- **Demo 07 — image-based terrain** (`examples/07-image-terrain/`).
  Stamps an alpha mask onto the bitmap via
  `terrain.deposit.fromAlphaTexture(...)`. The source canvas is
  drawn procedurally at preload to keep the demo self-contained,
  but the bridge from "PNG asset" to "destructible terrain" is
  identical to a real `this.load.image('island', 'island.png')`
  flow. Two-pass deposit at different alpha thresholds gives
  multi-material terrain (sand outline + dirt core) from a single
  source image.

### Performance — TerrainRenderer hot loop

~10× speedup on chunk repaint (0.080 ms → 0.007 ms per 128×128
chunk on Node 24). Replaced the per-pixel
`materials.get(id)` + 4-byte writes with a 256-entry packed-RGBA
LUT keyed by material id, written through a `Uint32Array` view of
the `ImageData` data buffer. The hot loop is now `pixels32[i] =
colorLut[bitmapData[i]]`. Two new exported helpers,
`paintChunkPixels(bitmapData, pixels32, colorLut)` and
`buildColorLut(materials)`, both pure and unit-tested without a
Phaser scene. The LUT is rebuilt every repaint (256 ops,
amortized); materials registered after construction are reflected
on the next repaint automatically.

### Tests

- 8 new tests in `tests/phaser/TerrainRenderer.test.ts` covering
  packed-RGBA correctness, byte-level round-trip through the
  `Uint32Array` view, and a 100-iteration 128×128 perf-smoke test.
- Total suite now 236 tests across 19 files, ~1.4 s.

---

## [v0.3.0] — 2026-04-30

Phase 3 of `docs-dev/02-roadmap.md`: Phaser integration.

### Added — `src/phaser/`

- `TerrainRenderer` — per-chunk canvas-backed visuals. Each chunk gets its own `<canvas>` registered via `textures.addCanvas`, repainted from the bitmap on `repaintDirty()`.
- `DestructibleTerrain` — composite GameObject. Owns the bitmap, renderer, and (optionally) the physics adapter + queue. Public surface: `carve.{circle,polygon,fromAlphaTexture}`, `deposit.{...}`, `isSolid`, `sampleMaterial`, `raycast`, `surfaceY`, `extractDebris`, `update`. All scene-coord in / scene-coord out. The `chunk.contours` field is populated on rebuild so debug renderers can read live colliders. Origin alignment: optional `x`/`y` constructor options shift both rendering and physics-body placement.
- `PixelPerfectPlugin` — `Phaser.Plugins.ScenePlugin`. Mapped to `scene.pixelPerfect`. Provides `terrain(options)` and `sprite(x, y, key, frame?)` factories (scene supplied automatically), tracks created terrains, auto-flushes them on `POST_UPDATE`, auto-destroys on `SHUTDOWN` / `DESTROY`. Module-augments `Phaser.Scene` so `pixelPerfect` is typed.
- `PixelPerfectSprite` — extends `Phaser.GameObjects.Sprite`. `overlapsPixelPerfect(other)` and `overlapsTerrain(terrain)` go through pure `core/queries/AlphaOverlap` helpers (`maskMaskOverlap`, `maskBitmapOverlap`). Mask is extracted lazily on first overlap, cached, invalidated on frame change; respects `flipX` / `flipY`. v1 limits: no rotation, no scaling.
- `core/queries/AlphaOverlap` — pure helpers + `AlphaMask` type. 16 unit tests cover threshold conversion from `AlphaSource`, mask-vs-mask overlap with checkerboard / partial / disjoint cases, and mask-vs-`ChunkedBitmap` overlap including out-of-bounds placements.

### Changed — collider model

Per-chunk colliders, two-sided polygon shapes (triangulated via
[earcut](https://github.com/mapbox/earcut)). This replaces both the
v0.2.0 per-chunk chain-shape model and the v0.2.5 per-blob global
rebuild — the latter is gone, the former is a different shape type.
Why each step:

- **Polygon triangulation** instead of `b2ChainShape`. Two-sided polygons resolve penetration on either side, fixing the wrong-side tunnelling that one-sided chains caused under continuous-carve drag. Also fixes the "non-convex L-shaped debris doesn't act solid" bug — earcut handles non-convex outlines directly, no chain fallback needed.
- **Per-chunk** rebuild (the 2.5 stitching is now obsolete). Each chunk's solid mass is independently triangulated; carving in chunk A no longer rebuilds chunks B…N. Bodies on those chunks keep their static body and contacts intact, so carving on the opposite side of the world doesn't wake settled bodies.
- **Snapshot/restore** of dynamic bodies across each rebuild. `Box2DAdapter.snapshotDynamicBodies` queries `b2World_OverlapAABB` over the dirty-chunks AABB, saves `(transform, linearVelocity, angularVelocity, awake)` per body, and writes them back after the rebuild. Sleeping settled bodies stay asleep through the carve. The awake restore is gated by a follow-up `b2Body_ComputeAABB` + overlap check so a body whose support is *actually* carved out wakes and falls naturally instead of hanging in midair (the "ghost float" bug).

### Added — earcut, support detection, rotation handling

- `earcut` (npm) wired into `ContourToBody.contourToTriangles(bodyId, contour, options)`. Each triangle attaches as a separate `b2PolygonShape` via `b2ComputeHull` + `b2MakePolygon` + `b2CreatePolygonShape`. Replaces the old "polygon-or-chain" branch in `Box2DAdapter`.
- `chunkToContours(chunk, bitmap, epsilon)` — single-chunk extraction with 1px air padding so every contour closes locally; replaces the global `componentToContours` call in the queue's hot path. `componentToContours` itself stays for `DebrisDetector`.
- Box2D binding surface extended: `b2AABB`, `b2Rot` (constructor), `b2DefaultQueryFilter`, `b2World_OverlapAABB`, `b2Shape_GetBody`, `b2Body_ComputeAABB`, transform/velocity/awake getters and setters. The `b2Rot` instance is required for `b2Body_SetTransform` — passing a plain `{c, s}` literal aliases it into `bodySim.rotation0` and crashes the next world step on `copyTo` (the literal has no `clone()` method).

### Demos

Five runnable demos under `examples/`, all built into `docs/` (committed):

- 01 — basic rendering: `TerrainRenderer` painting a procedural bitmap.
- 02 — click to carve: input + carve + per-chunk repaint.
- 03 — physics colliders: Box2D world, drop balls, debug overlay.
- 04 — falling debris: `DebrisDetector` + dynamic bodies; floating brick falls on load, shelves drop as L-shapes when their necks are severed.
- 05 — pixel-perfect sprite: drag a filled-circle sprite onto a ring sprite + a terrain patch; outline color encodes AABB-only vs pixel-perfect overlap.

Demo 04 was the verification path for the plugin migration: it uses `this.pixelPerfect.terrain({...})` instead of `new DestructibleTerrain(...)`.

Build / deploy: `npm run build` writes the demo bundle into `docs/` (committed). No CI; rebuild and commit alongside source changes. The vite config uses `base: './'` so the output works at any URL prefix (root, `/pixel-perfect/`, `file://`, etc.).

### Known limitations carried into v0.3.x / Phase 4

- Sub-pixel jitter on bodies in the chunk being **actively** carved during continuous drag. Bodies on other chunks are unaffected. See `docs-dev/PROGRESS.md` § "KNOWN LIMITATIONS" for the mechanism, when to revisit, and three candidate fixes ranked by effort.

### Tests

Test suite is now 212 across 17 files, ~1.5 s. typecheck and lint clean. Coverage targets unchanged.

---

## [v0.2.5] — 2026-04-29

Phase 2.5: cross-chunk contour stitching. Removes the v0.2.0 limitation that constrained terrain colliders to chunk-sized blobs.

### Changed

- **`DeferredRebuildQueue.flush` now does a per-blob global rebuild.** When any chunk is dirty, the queue runs `FloodFill.findAllComponents` on the bitmap, extracts each component's closed contour(s) via the new `ContourExtractor.componentToContours` helper, and routes each component to a representative chunk (the chunk containing the component's lex-smallest cell — its BFS start). The `Box2DAdapter`'s `Map<Chunk, BodyId>` now holds at most one entry per blob; chunks fully interior to a blob have no body at all. Previously-unsupported large blobs spanning many chunks now produce a coherent single body.
- The `perFrameBudget` option on `flush` and the `defaultPerFrameBudget` constructor option are removed. Per-blob rebuilds can't be amortized as cleanly as per-chunk ones; if the global pass becomes a profile hotspot, the optimization is to confine flood fill + extraction to the dirty chunks' bounding box (deferred).
- `DeferredRebuildQueue.flush` now clears the collider dirty flag on *every* chunk after a rebuild (since the rebuild is global, every chunk's collider state is now in sync).

### Added

- `FloodFill.findAllComponents(bitmap)` — every connected solid component, regardless of anchoring. Internally `findIslands(bitmap, { kind: 'customPoints', points: [] })`.
- `ContourExtractor.componentToContours(component, bitmap, epsilon)` — shared utility that builds a single-chunk temp bitmap covering the component, runs marching squares, and returns the simplified contours. Used by `DeferredRebuildQueue` for terrain rebuild and by `DebrisDetector` for debris contour extraction. Crucial detail: the temp bitmap uses one chunk sized to the component, so MS sees the entire component in one extraction pass — fixing the recursive cross-chunk problem that the v0.2.0 path would have inherited.
- `Box2DAdapter.trackedChunks()` — iterator over chunks that currently have a terrain body. Used by the queue to destroy bodies for chunks that no longer host a component after a global rebuild.

### Tests

- Three new cross-chunk integration cases in `tests/integration/Phase2Pipeline.test.ts`: a single blob spanning 4 chunks produces one coherent body; two disjoint cross-chunk blobs produce two bodies; a carve that bisects a multi-chunk bar destroys the old body and produces ≥ 1 valid new body.
- All 198 prior tests still pass; total is now 201 / ~1.3 s.

### Known limitations remaining

- Two blobs whose first cells happen to fall in the same chunk merge into one Box2D body (with multiple chain shapes). For static terrain this is harmless — the colliders are correct — but it slightly couples rebuild work for unrelated blobs. Splitting them would require allocating multiple body slots per chunk, which the current `Map<Chunk, BodyId>` shape doesn't support.

---

## [v0.2.0] — 2026-04-29

Phase 2 of `docs-dev/02-roadmap.md` is complete: the `src/physics/` module bridges core contours to live Box2D bodies via [`phaser-box2d`](https://phaser.io/box2d).

### Added — `src/physics/`

- `box2d.ts` — single typed binding to the subset of `phaser-box2d` we use. The package ships untyped JS; this file is the entire DOM-free typed surface for the rest of the physics layer (and the only place we import from `phaser-box2d/dist/PhaserBox2D.js`).
- `types.ts` — opaque branded `BodyId`, `ChainId`, `WorldId`. Brand prevents accidental cross-use; runtime values are phaser-box2d's plain index/revision objects.
- `ContourToBody` — `contourToChain(bodyId, contour, options)` and `contourToPolygon(bodyId, contour, options)`. Closed-loop chains for terrain, polygons (≤ 8 vertices, convex) for small debris, with chain fallback for non-convex / large debris. Pixel-to-meter conversion with y-flip is handled here so the rest of the codebase stays in pixel space.
- `Box2DAdapter` — single owner of body lifecycle. `rebuildChunk(chunk, contours)` destroys the previous static body and builds a new one with chain shapes for each contour; `destroyChunk(chunk)` cleans up; `createDebrisBody(contour, material)` creates a dynamic body at the contour's centroid (translated to body-local space so it rotates correctly). `dispose()` destroys every chunk body the adapter holds.
- `DeferredRebuildQueue` — funnel for end-of-frame physics work, satisfying CLAUDE.md hard rule #3 (no body create/destroy inside a Box2D step). Bounded `perFrameBudget` for chunk rebuilds with rollover; unbounded debris processing; stable row-major drain order; `onDebrisCreated` / `onChunkRebuilt` callbacks for downstream wiring.
- `DebrisDetector` — `detect` and `detectAndRemove` wrap `FloodFill` plus contour extraction. Each `DebrisInfo` carries the island, its outline contours (closed before open, sorted by descending vertex count), and the dominant material id for adapter property lookup.

### Tests

- 51 new physics tests across 5 files. All pass; no flakiness in the headless Box2D path.
- `tests/integration/Phase2Pipeline.test.ts` — 3 cases verifying the end-to-end pipeline (terrain rebuild after carve, floating block detected and dynamic-bodied, 200-cycle leak check).
- Total test suite is now 190+ tests, ~1 s.

### Architecture decisions

- `BodyId` / `ChainId` / `WorldId` are opaque branded types declared as `unknown & { __brand }`. The runtime values come from phaser-box2d unchanged; the brand only exists to catch type-confusion bugs.
- Box2D coordinate conversion (pixels → meters, y-down → y-up) lives entirely in `ContourToBody` and the adapter's `createDebrisBody`. Higher layers never see meter coordinates.
- Static terrain bodies are placed at world origin so chain shapes can use world-space coordinates directly. Dynamic debris bodies are placed at the contour centroid with shapes translated into body-local space (so the body rotates around its center).
- Single typed binding (`box2d.ts`) instead of one big `.d.ts` for the whole `phaser-box2d` surface — keeps the typed footprint to the ~15 functions we actually use and makes adding more deliberate.

### Known limitation — cross-chunk contour stitching

Per-chunk marching-squares output produces *open* polylines when a contour spans multiple chunks. Box2D's open chain shape requires ≥ 4 vertices for ghost-vertex handling, but a typical cross-chunk fragment collapses to 2–3 vertices after Douglas-Peucker simplification and is silently dropped.

Practical consequence: per-chunk colliders are reliable for destructible *islands* up to roughly chunk-size in extent. Larger blobs need cross-chunk stitching — extracting a global contour for each connected solid component and routing it to one chunk's body. This is deliberately deferred to v1.1; `tests/integration/Phase2Pipeline.test.ts` uses single-chunk worlds to stay within the supported regime.

### Not yet implemented (Phase 3+)

- `src/phaser/` — plugin, `DestructibleTerrain` GameObject, `PixelPerfectSprite`, `DynamicTexture` chunk renderer.
- Cross-chunk contour stitching (deferred, see above).
- Examples (`examples/`), runtime demos, performance pass.

---

## [v0.1.0] — 2026-04-29

Phase 1 of `docs-dev/02-roadmap.md` is complete: the `src/core/` module is feature-complete for v1, framework-agnostic, and fully tested.

### Added — `src/core/`

- `ChunkedBitmap` — chunked byte-grid data structure with dirty tracking, pixel I/O, and coordinate conversion. Bitmap is the source of truth for terrain state (CLAUDE.md hard rule #2).
- `MaterialRegistry` — id-validated material lookup. Air (id `0`) is implicit; valid ids are `1..255`.
- `Carve` and `Deposit` ops — `circle`, `polygon`, and `fromAlphaTexture` with shared internal rasterizer. Sub-pixel coords supported, bounding box auto-clipped, even-odd polygon fill rule. `fromAlphaTexture` accepts any structural `AlphaSource = { data: Uint8ClampedArray, width, height }` so core takes no DOM dependency.
- `MarchingSquares.extract(chunk, bitmap)` — 16-case lookup with TL-BR-joined saddle convention. Returns world-space contours; chunks include 1-pixel padding from neighbors so contours close locally when possible.
- `DouglasPeucker.simplify(contour, epsilon)` — iterative RDP simplification. Closed contours are split at the vertex farthest from `points[0]` for stable two-half simplification. Refuses to degenerate a closed contour below 3 vertices.
- `FloodFill.findIslands(bitmap, anchor)` — 4-connected BFS with `bottomRow` and `customPoints` anchor strategies. Returns connected components with `cells` and tight `bounds`.
- `Spatial` queries — `isSolid`, `sampleMaterial`, `surfaceY`, `findGroundBelow`, and Bresenham `raycast`. All read directly from the bitmap; out-of-world coords are treated as air consistently.

### Tests

- 144 tests across 11 files. Total runtime ~0.7 s.
- 100% line / branch / function coverage on `src/core/` implementation files (`types.ts` is interface-only and is naturally 0%).
- `tests/integration/Phase1Pipeline.test.ts` exercises the full deposit → carve → marching squares → Douglas-Peucker → spatial-query pipeline end-to-end (the Phase 1 DoD smoke).

### Bootstrap (Phase 0)

- Repo scaffolding: TypeScript 5 strict mode, Vite, Vitest, ESLint flat config, Prettier, VitePress placeholders, `.claude/` setup, planning docs in `docs-dev/`.

### Architecture decisions

- `BodyId` is intentionally absent from the core `Chunk` type. The Box2D adapter (Phase 2) will own its own `Map<Chunk, BodyId[]>` so `src/core/` stays dependency-free per CLAUDE.md hard rule #1. `docs-dev/01-architecture.md` updated to match.
- MS saddle convention: "TL-BR diagonal joined." Applied uniformly so adjacent chunks produce topologically consistent stitching.
- MS winding: solid-on-visual-LEFT in y-down screen coords (math-CCW around solid blobs). The Phase 2 Box2D adapter will use this winding for chain-shape orientation.
- Out-of-bounds policy: `getPixel` is lenient (returns 0); `setPixel` is strict (throws). Carve / deposit ops clip their footprint before calling `setPixel` so callers can pass any world coordinates without pre-clipping.

### Not yet implemented (Phase 2+)

- `src/physics/` — Box2D adapter, deferred rebuild queue, debris detector.
- `src/phaser/` — plugin, `DestructibleTerrain` GameObject, `PixelPerfectSprite`, `DynamicTexture` chunk renderer.
- Examples (`examples/`), runtime demos, performance pass.
