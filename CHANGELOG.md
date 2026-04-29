# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely; this project does not yet publish to npm.

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
