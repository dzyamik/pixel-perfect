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
│  - Box2DAdapter: chain-body lifecycle                   │
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

Per-chunk state:

```ts
interface Chunk {
  cx: number;                  // chunk grid X
  cy: number;                  // chunk grid Y
  bitmap: Uint8Array;          // chunkSize * chunkSize bytes
  dirty: boolean;              // contour/collider rebuild needed
  visualDirty: boolean;        // GPU texture upload needed
  contours: Contour[] | null;  // cached marching-squares output
  bodyIds: BodyId[];           // current Box2D bodies for this chunk
}
```

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

1. Extract its contour (already have it from marching squares per chunk; need to combine cross-chunk).
2. Remove its cells from the static bitmap (write `0`).
3. Emit a `debris:detached` event with the contour and material info.
4. The Phaser/physics layer creates a dynamic Box2D body and a sprite for the debris.

Performance: full-world flood fill is O(width × height). For a 4 MB world this is ~5ms — acceptable as a per-event cost, not per-frame. Optimization: only run flood fill if the destruction crossed a "narrow connection" heuristic (configurable; default = always run when ≥ 3 chunks dirtied in one operation).

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

Owns the lifecycle of all terrain Box2D bodies. Each chunk has zero or more `b2ChainShape` bodies attached to a single static `b2Body` for that chunk.

Key API:

```ts
class Box2DAdapter {
  rebuildChunk(chunk: Chunk): void;
  destroyChunk(chunk: Chunk): void;
  createDebrisBody(contour: Contour, material: Material): BodyId;
  flush(): void;  // called once per frame, end of update
}
```

`rebuildChunk` is queued via the `DeferredRebuildQueue`, never executed inline. The queue is drained in `flush()`, which runs after `world.step()`.

Why chain shapes (not polygon shapes):

- Chain shapes handle "ghost vertices" automatically, eliminating snag-on-seam bugs at chunk boundaries.
- Chains support arbitrary topology including holes (one chain per closed contour).
- Chains are static-only by design, which matches our terrain semantics.

Dynamic debris bodies use `b2PolygonShape` (or `b2ChainShape` with `IsLoop = true` for hollow shapes). Decision rule: if contour is convex and ≤8 vertices, use polygon; otherwise decompose or use chain.

### DeferredRebuildQueue

```ts
class DeferredRebuildQueue {
  private dirtyChunks: Set<Chunk>;
  private dynamicOps: PendingOp[];

  enqueueChunk(chunk: Chunk): void;
  enqueueDebris(contour: Contour, material: Material): void;
  flush(adapter: Box2DAdapter): void;
}
```

Single-threaded. Drained at end-of-frame. Per-frame budget: rebuild up to N chunks (default 4) to bound worst-case cost; remaining chunks roll to next frame. This is a simple form of time-slicing; sufficient for v1.

### DebrisDetector

Runs flood fill, identifies detached regions, returns a list of debris contours. Called from the carve/deposit operations when triggered by heuristic.

## Phaser layer

### Plugin registration

```ts
class PixelPerfectPlugin extends Phaser.Plugins.BasePlugin {
  init(): void;
  // exposes scene-level factories: scene.pixelPerfect.terrain(...), .sprite(...)
}
```

Registered as a global plugin. Adds `scene.pixelPerfect` namespace.

### DestructibleTerrain GameObject

A composite GameObject that owns:

- A `ChunkedBitmap` instance
- A `Box2DAdapter` instance
- A grid of `DynamicTexture`s (one per chunk) for visual rendering
- An update hook that flushes the rebuild queue and pushes texture updates

Public API on the GameObject:

```ts
terrain.carve.circle(x, y, r);
terrain.carve.polygon(points);
terrain.carve.fromAlpha(x, y, textureKey);
terrain.deposit.circle(x, y, r, materialId);
terrain.isSolid(x, y);
terrain.raycast(x1, y1, x2, y2);
terrain.on('debris:detached', handler);
terrain.on('chunk:rebuilt', handler);  // useful for debugging
```

Visual rendering:

- Each chunk has its own `DynamicTexture` sized to chunk dimensions.
- On `visualDirty`, repaint the chunk's texture from its bitmap.
- For flat-color materials: write color pixels directly via `setPixel`.
- For textured materials (v1.1+): sample a tile texture by `(worldX, worldY)` modulo tile size.
- Use Phaser v4's partial DynamicTexture upload feature when available.

### PixelPerfectSprite

Independent feature, shares bitmap utilities. Provides alpha-aware sprite-vs-sprite collision:

- Each registered sprite has a precomputed alpha bitmap (from its texture).
- Collision check: bounding box overlap → for overlap region, AND the two alpha bitmaps; if any solid pixel found, hit.
- Optional: collision with `DestructibleTerrain` — overlap sprite alpha against terrain bitmap directly. Microsecond operation.

This is the secondary headline feature. It addresses a recurring Phaser community question independent of destructible terrain.

## Data flow: a destruction event

```
1. game code calls terrain.carve.circle(1000, 500, 40)
   ↓
2. core/carve.ts iterates affected pixels, writes 0s
   ↓
3. each affected chunk gets dirty=true, visualDirty=true
   ↓
4. DebrisDetector runs flood fill, finds 1 detached island
   ↓
5. core emits 'debris:detected' with island contour
   ↓
6. (frame ends, scene.update completes)
   ↓
7. plugin's postUpdate hook calls box2dAdapter.flush()
   ↓
8. for each dirty chunk:
      a. marching squares on bitmap → contours
      b. Douglas-Peucker on contours
      c. destroy old bodies for chunk
      d. create new chain bodies
      e. clear dirty flag
   ↓
9. for each detected debris:
      a. create dynamic Box2D body with polygon/chain
      b. create sprite for visual
      c. user-side: parented or independent, user choice
   ↓
10. for each visualDirty chunk:
       a. repaint DynamicTexture from bitmap
       b. clear visualDirty flag
   ↓
11. Phaser renders normally
```

Steps 1-5 happen synchronously inside the carve call. Steps 6-10 happen at end of frame. Step 11 is unchanged from any Phaser game.

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
  Box2DAdapter.ts           # body lifecycle
  DeferredRebuildQueue.ts   # end-of-frame flush
  DebrisDetector.ts         # detached island → dynamic body
  ContourToBody.ts          # contour → b2ChainShape / b2PolygonShape
  index.ts

src/phaser/
  PixelPerfectPlugin.ts     # plugin registration
  DestructibleTerrain.ts    # GameObject
  TerrainRenderer.ts        # DynamicTexture management per chunk
  PixelPerfectSprite.ts     # alpha-aware sprite collision
  index.ts

src/index.ts                # top-level public API
```

## Public API surface (target shape)

```ts
import { PixelPerfectPlugin } from 'pixel-perfect';
// or, advanced: import { ChunkedBitmap, MarchingSquares } from 'pixel-perfect/core';

// In Phaser game config:
plugins: { global: [{ key: 'PixelPerfect', plugin: PixelPerfectPlugin, start: true }] }

// In a scene:
const terrain = this.pixelPerfect.terrain({
  width: 4096,
  height: 1024,
  chunkSize: 128,
  pixelsPerMeter: 32,
  fromImage: 'island-mask',
  materials: [
    { id: 1, name: 'dirt', color: 0x8b5a3c, density: 1.0, friction: 0.7, restitution: 0.1, destructible: true, destructionResistance: 0 },
    { id: 2, name: 'stone', color: 0x666666, density: 2.5, friction: 0.9, restitution: 0.05, destructible: true, destructionResistance: 0.5 },
  ],
  physicsWorld: this.box2dWorld,
});

terrain.carve.circle(1000, 500, 40);
terrain.on('debris:detached', (debris) => { /* ... */ });

// Sprite collision:
const sprite = this.pixelPerfect.sprite(this, 100, 100, 'player');
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

## What's deliberately not in v1

- Falling sand / cellular automaton layer (separate v2 effort)
- WebWorker offload of marching squares
- WebGPU compute paths
- Matter.js physics adapter
- Edge texturing (grass tops, rims)
- Save/load serialization
- Multi-resolution mipmapped chunks
- Networking / lockstep

These are architecturally accommodated (the layered design doesn't preclude any of them) but explicitly out of scope.
