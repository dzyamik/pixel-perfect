# 01 — Architecture

## Purpose

`pixel-perfect` is a Phaser v4 library for pixel-accurate spatial reasoning. The bitmap is the source of truth; renderers and physics colliders are derived from it. This document defines the data structures, algorithms, layer boundaries, and data flow.

## Design principles

1. **Bitmap is truth.** The authoritative world state is a 2D byte grid of material IDs. Visuals and colliders are projections of that state. They never mutate the bitmap; only operations on the bitmap mutate them.
2. **Three layers, decoupled.** Core (pure TS, no engine deps) → Physics adapter (Box2D bridge) → Phaser integration. Each layer is usable without the layers above it.
3. **Chunked, not monolithic.** All world data is partitioned into fixed-size chunks. Operations dirty individual chunks; rebuilds happen at chunk granularity.
4. **Deferred rebuilds.** Physics body recreation never happens during a Box2D step. It is queued and flushed at end-of-frame.
5. **Operations are pure functions of bitmap state.** Same bitmap → same output. This unlocks future serialization, replay, and determinism.
6. **Zero runtime deps in core.** Algorithms (marching squares, Douglas-Peucker, flood fill) are self-contained and tested in isolation.

## Three-layer architecture

```
┌─────────────────────────────────────────────────────────┐
│ Phaser layer (src/phaser/)                              │
│  - Phaser plugin registration                           │
│  - DestructibleTerrain GameObject                       │
│  - DynamicTexture management (partial uploads)          │
│  - PixelPerfectSprite (alpha-aware collision wrapper)   │
│  - Scene helpers and event bridging                     │
└─────────────────┬───────────────────────────────────────┘
                  │ depends on
                  ▼
┌─────────────────────────────────────────────────────────┐
│ Physics layer (src/physics/)                            │
│  - Box2DAdapter: polygon-body lifecycle                 │
│  - DeferredRebuildQueue: end-of-frame flush             │
│  - DebrisDetector: detached island → dynamic body       │
│  - Adapter interface (allows Matter.js adapter later)   │
└─────────────────┬───────────────────────────────────────┘
                  │ depends on
                  ▼
┌─────────────────────────────────────────────────────────┐
│ Core layer (src/core/)                                  │
│  - ChunkedBitmap: data structure, dirty tracking        │
│  - Materials: ID registry, properties                   │
│  - Carve / Deposit operations: circle, polygon, alpha   │
│  - MarchingSquares: bitmap → contour polygons           │
│  - DouglasPeucker: polygon simplification               │
│  - FloodFill: connected-component / island detection    │
│  - SpatialQueries: isSolid, raycast, surfaceY, sample   │
└─────────────────────────────────────────────────────────┘
```

The split is real: a PixiJS user can import `src/core/` and `src/physics/` without ever touching Phaser. The Phaser layer is a consumer, not a co-author, of the core.

## Core data structures

### ChunkedBitmap

The world is a `width × height` grid of bytes (`Uint8Array`). Each byte is a material ID. `0` is reserved for air (empty). IDs `1..255` are user-defined materials.

```
World: 4096 × 1024 pixels
Chunk size: 128 × 128 pixels (configurable)
Grid: 32 × 8 chunks = 256 chunks
```

Per-chunk state (core type):

```ts
interface Chunk {
  cx: number;                  // chunk grid X
  cy: number;                  // chunk grid Y
  bitmap: Uint8Array;          // chunkSize * chunkSize bytes
  dirty: boolean;              // contour/collider rebuild needed
  visualDirty: boolean;        // GPU texture upload needed
  contours: Contour[] | null;  // cached marching-squares output
}
```

Box2D body ids are **not** stored on the core `Chunk` type. Keeping `BodyId`
out of the core layer preserves the dependency-free rule (Rule 1 in
`CLAUDE.md`); the Box2D adapter owns its own `Map<Chunk, BodyId[]>` instead.

Why chunked:

- Destruction at one point affects 1–4 chunks, not 256.
- Dirty flags isolate work to changed regions.
- GPU texture uploads can be partial (one chunk at a time).
- Box2D body counts stay manageable per chunk.

Why `Uint8Array` (not bitset):

- Materials need more than one bit (256 material types is plenty).
- Direct pixel-to-byte mapping makes algorithms readable.
- Memory cost is acceptable: 4096 × 1024 × 1B = 4 MB total.

### Material registry

```ts
interface Material {
  id: number;                       // 1..255
  name: string;
  color: number;                    // fallback flat color (0xRRGGBB)
  textureKey?: string;              // Phaser texture for tiled rendering
  density: number;                  // for debris dynamic bodies
  friction: number;
  restitution: number;
  destructible: boolean;            // false = indestructible bedrock
  destructionResistance: number;    // 0..1, scales explosion radius
}
```

Material `0` is air, hardcoded, not in the registry.

## Algorithms

### Carve / Deposit

Both operate on the bitmap directly. Carve writes `0`. Deposit writes a material ID. Same iteration code, different output value.

Primitives:

- `circle(x, y, radius)`
- `polygon(points[])`
- `fromAlphaTexture(x, y, textureKey, threshold)` — reads pixel alpha from a Phaser texture and writes corresponding bitmap cells

After any carve/deposit:
1. Mark every touched chunk `dirty = true` and `visualDirty = true`.
2. Return early. Rebuild happens later (deferred).

### Marching Squares

Standard 2x2 cell scan over the bitmap. For each cell, the four corners' "solid or air" classification produces one of 16 cases. Each case maps to zero, one, or two line segments crossing the cell.

Output: a list of edge segments per chunk. Connected segments are walked into closed polygon contours (one outer boundary + N hole contours per island).

Implementation notes:

- Pad each chunk by 1 pixel on all sides during sampling. Without padding, polygons stop one pixel short of chunk edges and visible seams appear.
- Sample the neighbor chunks' edge pixels for the padding row/column. Edge of world = treat outside as air.
- Saddle point cases (0101 and 1010) need a tie-breaker rule. Pick one consistently (we use "connect upper-left to lower-right always") to avoid contour topology bugs.
- Output uses world-space coordinates, not chunk-local. This simplifies physics consumption.

### Douglas-Peucker simplification

Marching squares emits a vertex at every pixel boundary. A 50-pixel destruction circle produces ~150 vertices. Box2D becomes unstable above ~16 vertices per chain, and collinear points cause manifold bugs.

Apply Douglas-Peucker with epsilon ≈ 1.0 pixels:

- Recursive divide-and-conquer on each contour.
- Keeps endpoints; drops interior points within epsilon of the chord.
- Typical reduction: 90%+ vertices, no visible quality loss.
- Closed contours: simplify as if open, then ensure first and last point are not redundant.

Output: simplified `Contour[]` per chunk.

### Flood fill (island detection)

When destruction may have detached a chunk of terrain, run flood fill from "anchor" cells:

- Default anchor strategy: bottom row of the world.
- Custom anchors: user-supplied points marked as "permanently attached."
- Algorithm: 4-connected BFS from anchors, marking all reachable solid cells.
- Any solid cell not marked is part of a detached island.

When a detached island is found:

1. Extract its contour via `componentToContours` — flood fill identified the cells, this builds a temp bitmap of just those cells (with 1 px padding) and runs marching squares on it. The component's contour comes back closed in one extraction pass; no cross-chunk stitching needed since the temp bitmap is sized to the component itself.
2. Remove its cells from the static bitmap (write `0`).
3. Hand the contour + dominant material to `DeferredRebuildQueue.enqueueDebris(...)`.
4. On the next queue flush, the adapter creates a dynamic Box2D body for the debris (triangulated polygon shapes — see "Why polygons" below). The user wires a sprite to it via `terrain`'s `onDebrisCreated` callback.

Performance: full-world flood fill is O(width × height). For a 4 MB world this is ~5ms — acceptable as a per-event cost, not per-frame. The Phase-3 demos run `extractDebris()` every frame because the bitmaps are small (≤ 512×320); for larger worlds, gate it behind "did the carve plausibly detach something?" heuristics.

### Spatial queries

All implemented directly on the bitmap; do not delegate to Box2D.

- `isSolid(x, y) → boolean` — single byte read, O(1)
- `sampleMaterial(x, y) → number` — byte value, O(1)
- `raycast(x1, y1, x2, y2) → HitResult | null` — Bresenham line walk until first solid cell, O(line length)
- `surfaceY(x) → number` — walk down from y=0 until first solid; useful for spawning entities on terrain
- `findGroundBelow(x, y, maxDist) → number | null` — bounded version of surfaceY

These are microsecond operations and replace dozens of Box2D queries that game logic would otherwise issue.

## Physics layer

### Box2DAdapter

Owns the lifecycle of all terrain Box2D bodies. **One static `b2Body` per chunk that has solid pixels**, made of N triangulated `b2PolygonShape`s — the chunk's solid mass extracted via `chunkToContours` and run through earcut. The adapter maintains an internal `Map<Chunk, BodyId>` (single body per chunk; the core `Chunk` type does not carry body ids).

Key API:

```ts
class Box2DAdapter {
  rebuildChunk(chunk: Chunk, contours: readonly Contour[]): void;
  destroyChunk(chunk: Chunk): void;
  createDebrisBody(contour: Contour, material: Material): BodyId | null;
  snapshotDynamicBodies(aabbPx): BodySnapshot[];
  restoreDynamicBodies(snapshots): void;
  dispose(): void;
}
```

`rebuildChunk` is queued via the `DeferredRebuildQueue`, never executed inline. The queue does the per-chunk extraction, calls `rebuildChunk` for each dirty chunk, and wraps the body churn with `snapshotDynamicBodies` / `restoreDynamicBodies` so dynamic bodies don't drift while their underlying static body is destroyed and recreated.

Why **polygons** (not chain shapes):

- Two-sided collision. A dynamic body that drifts to the wrong side of a chain shape's seam during a destroy/recreate cycle isn't seen as colliding (chain normals are one-sided) and tunnels. Two-sided polygons resolve penetration regardless of which side the body ended up on.
- Non-convex debris (e.g. an L-shape left over after a carve severs a neck) doesn't need a fallback path. Earcut handles non-convex outlines directly; closed-chain dynamic bodies don't act as solid masses, polygons do.
- Static terrain bodies and dynamic debris bodies share the same shape type, so `contourToTriangles(bodyId, contour, opts)` is the only shape-creation entry point.

Cost: more shapes per blob (~38 triangles for a 40-vertex outline vs 40 chain edges). Box2D handles triangle counts in the thousands without complaint.

### DeferredRebuildQueue

```ts
class DeferredRebuildQueue {
  private bitmap: ChunkedBitmap;
  private dirtyChunks: Set<Chunk>;
  private pendingDebris: PendingDebris[];

  enqueueChunk(chunk: Chunk): void;
  enqueueDebris(contour: Contour, material: Material): void;
  flush(adapter: Box2DAdapter, options?: FlushOptions): void;
}
```

Single-threaded. `flush()` snapshots dynamic bodies in the union AABB of the dirty chunks, iterates dirty chunks in `(cy, cx)` order extracting each via `chunkToContours` and calling `rebuildChunk` (skipping any chunk whose contour list is bit-identical to last frame's), then restores the dynamic bodies. Debris is processed unconditionally — the dynamic bodies the queue creates would visibly pop in if delayed.

### DebrisDetector

Runs flood fill, identifies detached regions, returns a list of debris contours. Called from the carve/deposit operations when triggered by heuristic.

## Phaser layer

### Plugin registration

```ts
class PixelPerfectPlugin extends Phaser.Plugins.ScenePlugin {
  boot(): void;
  // factories: scene.pixelPerfect.terrain(...), .sprite(...)
}
```

Registered as a **scene** plugin under `mapping: 'pixelPerfect'`, so `scene.pixelPerfect` is available inside any scene. The plugin auto-flushes terrain rebuilds and chunk repaints on the scene's `POST_UPDATE` event, and auto-destroys tracked terrains on `SHUTDOWN` / `DESTROY`. Sprite GameObjects use Phaser's regular GameObject lifecycle; the plugin doesn't track them.

### DestructibleTerrain GameObject

A composite that owns:

- A `ChunkedBitmap` instance.
- A `TerrainRenderer` (one canvas-backed Phaser texture per chunk).
- Optional `Box2DAdapter` + `DeferredRebuildQueue` (when `worldId` is supplied).

Public API:

```ts
terrain.carve.circle(sceneX, sceneY, r);
terrain.carve.polygon(points);
terrain.carve.fromAlphaTexture(source, dstX, dstY, threshold?);
terrain.deposit.circle(sceneX, sceneY, r, materialId);
terrain.deposit.polygon(points, materialId);
terrain.deposit.fromAlphaTexture(source, dstX, dstY, materialId, threshold?);
terrain.isSolid(sceneX, sceneY);
terrain.sampleMaterial(sceneX, sceneY);
terrain.raycast(x1, y1, x2, y2);
terrain.surfaceY(sceneX);
terrain.extractDebris(anchor?, simplificationEpsilon?); // detect + remove + enqueue
terrain.update();                                       // manual flush trigger
```

The debris notification surface is a constructor option, not a `.on(...)` event:

```ts
this.pixelPerfect.terrain({
    /* ... */
    onDebrisCreated: ({ bodyId, contour, material }) => {
        // spawn a Phaser Graphics traced from contour, sync it
        // every frame to the body's transform.
    },
});
```

Visual rendering — `TerrainRenderer`:

- Each chunk has its own `<canvas>` (size `chunkSize × chunkSize`) registered with Phaser's TextureManager via `addCanvas`, and a `Phaser.GameObjects.Image` placed at the chunk's scene position.
- On `visualDirty`, the hot loop walks the chunk's bitmap once, indexes a 256-entry packed-RGBA LUT keyed by material id, and writes through a `Uint32Array` view of the underlying `ImageData.data` buffer — one byte read + one indexed lookup + one 32-bit write per pixel. Then `putImageData` + `texture.refresh()` for GPU re-upload.
- For textured materials (v1.1+): the LUT is per-pixel-color today; replace with per-pixel sampler / shader for tiled textures later.
- Phaser v4's partial DynamicTexture upload is a follow-up if profiling shows GPU upload as the bottleneck — currently it's not.

### PixelPerfectSprite

Independent feature, shares bitmap utilities. Provides alpha-aware sprite-vs-sprite collision:

- Each registered sprite has a precomputed alpha bitmap (from its texture).
- Collision check: bounding box overlap → for overlap region, AND the two alpha bitmaps; if any solid pixel found, hit.
- Optional: collision with `DestructibleTerrain` — overlap sprite alpha against terrain bitmap directly. Microsecond operation.

This is the secondary headline feature. It addresses a recurring Phaser community question independent of destructible terrain.

## Data flow: a destruction event

```
1. game code calls terrain.carve.circle(sceneX, sceneY, r)
   ↓
2. core/carve.ts iterates affected pixels, writes 0s
   ↓
3. each affected chunk gets dirty=true, visualDirty=true
   ↓
4. (optional) game calls terrain.extractDebris() — flood fill from
   anchors finds detached components, removes their cells from the
   bitmap (more dirty chunks), enqueues a dynamic body per component
   ↓
5. (frame ends, scene.update completes)
   ↓
6. plugin's POST_UPDATE hook calls terrain.update(), which calls
   queue.flush(adapter):
   ↓
7. queue.flush:
      a. Snapshot every dynamic body whose AABB overlaps the
         union AABB of the dirty chunks (transform, lin/ang vel,
         awake flag).
      b. For each dirty chunk in (cy, cx) order:
           i.   chunkToContours → marching squares + Douglas-Peucker
                 within the chunk's pixels (1 px air padding).
           ii.  If contoursEqual(cached, new), skip rebuild.
           iii. Otherwise destroy old static body, create new one
                 with triangulated polygon shapes per contour.
      c. For each pending debris contour: create a dynamic body
         (centroid-translated, triangulated) and fire the
         onDebrisCreated callback so the user can spawn a visual.
      d. Restore dynamic bodies to their snapshot, gating the awake
         flag on whether the body's AABB still overlaps any static
         shape (avoids the "ghost-float" bug).
   ↓
8. for each visualDirty chunk:
      a. paintChunkPixels writes the chunk's solid bitmap to the
         per-chunk canvas via a packed-RGBA LUT + Uint32Array view.
      b. canvas → texture refresh.
      c. clear visualDirty flag.
   ↓
9. Phaser renders normally.
```

Steps 1-4 happen synchronously inside the user's update logic. Steps 6-8 happen at the scene's `POST_UPDATE` event (or whenever the user calls `terrain.update()` manually — demos that wire their own physics step do it manually so colliders are fresh before `world.Step`). Step 9 is unchanged from any Phaser game.

## Coordinate systems

Three coordinate spaces, with explicit conversion functions:

- **World coords** — Phaser world units (typically pixels in 2D games). Public API uses these.
- **Bitmap coords** — integer pixel indices into the bitmap. `1 world unit = pixelsPerMeter / something` configurable; default 1:1.
- **Chunk-local coords** — pixel index within a single chunk's bitmap. Used internally only.

Box2D uses meters. The adapter handles conversion: `metersPerPixel = 1 / pixelsPerMeter`. Default `pixelsPerMeter = 32` (matches Phaser Box2D examples).

## File-by-file responsibilities

```
src/core/
  ChunkedBitmap.ts          # data structure, dirty tracking, getPixel/setPixel
  Materials.ts              # MaterialRegistry, defaults
  ops/
    Carve.ts                # circle, polygon, alpha
    Deposit.ts              # mirror of Carve
  algorithms/
    MarchingSquares.ts      # bitmap → contours
    DouglasPeucker.ts       # contour simplification
    FloodFill.ts            # island detection
  queries/
    Spatial.ts              # isSolid, raycast, surfaceY
  types.ts                  # Contour, Chunk, HitResult, etc.
  index.ts                  # public re-exports

src/physics/
  box2d.ts                  # typed binding to phaser-box2d
  types.ts                  # branded BodyId / ChainId / WorldId
  Box2DAdapter.ts           # body lifecycle + snapshot/restore
  DeferredRebuildQueue.ts   # end-of-frame flush, per-chunk
  DebrisDetector.ts         # detached island detection
  ContourExtractor.ts       # chunkToContours + componentToContours
  ContourToBody.ts          # contour → b2PolygonShape (triangulated)
  index.ts

src/phaser/
  PixelPerfectPlugin.ts     # plugin registration
  DestructibleTerrain.ts    # GameObject
  TerrainRenderer.ts        # DynamicTexture management per chunk
  PixelPerfectSprite.ts     # alpha-aware sprite collision
  index.ts

src/index.ts                # top-level public API
```

## Public API surface

```ts
import * as Phaser from 'phaser';
import { PixelPerfectPlugin } from 'pixel-perfect';
// Advanced: import { ChunkedBitmap, MarchingSquares } from 'pixel-perfect/core';

// Register the plugin once per game.
new Phaser.Game({
    // ...
    plugins: {
        scene: [
            {
                key: 'PixelPerfectPlugin',
                plugin: PixelPerfectPlugin,
                mapping: 'pixelPerfect',
            },
        ],
    },
});

// In a scene's create():
const terrain = this.pixelPerfect.terrain({
    width: 1024,
    height: 512,
    chunkSize: 64,
    pixelsPerMeter: 32,
    x: 64,
    y: 64,
    materials: [
        { id: 1, name: 'dirt', color: 0x8b5a3c, density: 1, friction: 0.7, restitution: 0.1, destructible: true, destructionResistance: 0 },
        { id: 2, name: 'stone', color: 0x666666, density: 2.5, friction: 0.9, restitution: 0.05, destructible: true, destructionResistance: 0.5 },
    ],
    worldId: this.worldId, // optional — pure-visual terrain works without it
    onDebrisCreated: ({ bodyId, contour, material }) => {
        // spawn a Phaser Graphics or Image for the debris body
    },
});

terrain.carve.circle(1000, 500, 40);
// Source-from-PNG: stamp the alpha mask into the bitmap.
// const imageData = ctx.getImageData(0, 0, w, h);
// terrain.deposit.fromAlphaTexture(imageData, dstX, dstY, /* materialId */ 1);

// Sprite collision:
const sprite = this.pixelPerfect.sprite(100, 100, 'player');
if (sprite.overlapsPixelPerfect(otherSprite)) { /* ... */ }
if (sprite.overlapsTerrain(terrain)) { /* ... */ }
```

## Performance targets

For v1, validated on mid-range hardware (i5 desktop / mid-tier Android):

| Scenario | Target |
|---|---|
| World size | 4096 × 1024 px (32 chunks of 128²) |
| Idle frame cost | < 0.5 ms |
| Single destruction event (1–4 chunks) | < 4 ms total (carve + rebuild + GPU upload) |
| 10 destruction events / second | 60 fps held |
| 100 destruction events / second | 30+ fps degradation acceptable, no crash |
| 50 active debris bodies | 60 fps held |
| Memory footprint (4 MB world) | < 16 MB total including textures |
| Frame allocations | Zero in steady state (object pools for hot paths) |

## Determinism

Best-effort, not guaranteed in v1:

- Algorithms are deterministic given same input.
- Iteration order over chunks is stable (sorted by (cx, cy)).
- Box2D body creation order matters for some Box2D builds; we order by chunk coords for stability.
- Floating-point in Douglas-Peucker is the residual non-determinism source. Across same-architecture machines it's reliable; cross-architecture not guaranteed.

This is enough for replay debugging, not enough for lockstep multiplayer.

## v2 / v3 — cellular-automaton fluid layer

Shipped in `v2.0.0` (sand), `v2.1.0` (water + density swap),
`v2.2.0` (sand-pile settling), `v2.3.0` (oil / gas / fire +
multi-cell flow), `v2.4.0` (sparse active-cell tracking),
`v3.0.0` (mass-based liquids), `v3.1.0` (pool-aware fast path),
and the `v3.1.x` patch chain ending at `v3.1.16` (cliff drainage
hydrostatics: pool flood-fill every tick, bottom-up hydrostatic
distribution, narrow-stream-from-anchored-edge rule, width-from-
depth Bernoulli discretization, and L/R scan-order ping-pong for
symmetric drainage). v3 details in
`docs-dev/06-v3-mass-based-fluid.md`,
`docs-dev/07-v3.1-pool-based-fluid.md`, and the running ledger in
`docs-dev/PROGRESS.md`.

`Material.simulation?: SimulationKind` controls how a material
moves. `'static'` (default for back-compat) generates Box2D
colliders and never moves on its own. `'sand'`, `'water'`, `'oil'`,
`'gas'`, and `'fire'` are mobile kinds processed by
`CellularAutomaton.step(bitmap, tick)` — a pure one-tick simulator
that mutates the bitmap in place.

Density-ranked vertical swap (high → low):
`sand (5) > water (4) > oil (3) > fire (2) > air (1) > gas (0)`.
Static cells never swap. **Sand and fire stay binary** (one cell
holds one full unit of material). **Water, oil, and gas use
mass-based simulation** (each cell stores a `Float32` mass; pressure
emerges from over-compression overflow). Cross-material density
swaps remain atomic — masses are preserved when two cells of
different materials swap places.

**Pool-aware step (v3.1)** — every tick (since v3.1.8 the
threshold is 0), the step flood-fills connected components of
same-material fluid cells and writes a hydrostatic bottom-up
mass distribution to each (rows saturated at `MAX_MASS` from
the bottom up; topmost row carries the remainder). Pool cells
deep inside a component (every 4-neighbor in the same pool)
skip per-cell `stepLiquid` entirely. Perimeter cells still go
through `stepLiquid` so off-pool spreading, cliff drainage, and
cross-material swaps work normally. The flood-fill + distribute
is the canonical "instant pool flattening" trick from the
W-Shadow / Noita / jgallant CA-fluid lineage.

**Cliff drainage rules (v3.1.12-v3.1.16)** — the lateral step
in `stepLiquid` allows a source cell to donate to "unsupported
air" (target air whose deep neighbor is also air — the cliff-
drop column) ONLY when the source has stone / static directly
below (anchored on the cliff base). Donation distance scales
with the source's "head" — count of same-material cells
directly above the source — so a pool 3 rows deep at the
cliff edge spawns a 3-cell-wide off-cliff stream (Bernoulli
`width ∝ head`, discretized). Lateral scan direction and
within-row processing order ping-pong each tick for L/R
symmetry.

**Active-cell tracking (v2.4)** — `step` iterates a sparse
`Set<number>` of cell indices on `ChunkedBitmap.activeCells`
instead of scanning the full bitmap. The set is maintained
automatically: `setPixel` auto-marks the changed cell + its 8-cell
Moore neighborhood once tracking is initialized. The sim's own
swap-mutations and external carve / deposit / paint ops therefore
propagate activation organically. Cells with ongoing state (fire
timer, sand rest counter) explicitly call `markActive` to stay in
the rotation; everything else drops on its non-moving tick and
returns only when a neighbor's mutation re-adds it.

Cost: O(active cells × log active cells) per tick (the log factor
is the snapshot sort that orders rows bottom-up). For a settled
world the set is empty and `step` is effectively a no-op. For a
busy demo it scales with the moving cell count, not world
dimensions.

Critical interaction with the physics layer: `chunkToContours` and
`componentToContours` filter the temp bitmap to **only** static
materials. Fluid cells are visible to the renderer (they appear at
the right color) and to spatial queries (`isSolid` returns true)
but are invisible to physics colliders. Without this filter, every
sand grain falling one row per frame would dirty its chunks and
trigger a static-body rebuild — a continuous physics churn that
would defeat the whole point.

`DestructibleTerrain` exposes `simStep()` (one-tick) and
`autoSimulate?: boolean` option (run a tick at the start of every
`update()`). Demo 09 (`examples/09-falling-sand/`) is the
visualization.

## What's deliberately not in v2

- WebWorker offload of marching squares
- WebGPU compute paths
- Matter.js physics adapter (the last v2 item from the original
  `CLAUDE.md` list — still open)
- Edge texturing (grass tops, rims)
- Save/load serialization
- Multi-resolution mipmapped chunks
- Networking / lockstep

These are architecturally accommodated (the layered design doesn't preclude any of them) but explicitly out of scope.
