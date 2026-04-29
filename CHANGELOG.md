# Changelog

All notable changes to this project will be documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely; this project does not yet publish to npm.

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
