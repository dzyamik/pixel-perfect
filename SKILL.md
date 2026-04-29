# pixel-perfect

> Pixel-perfect spatial reasoning for Phaser v4: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities.

## Status

Alpha. Under active development. APIs may change before v1.0.0.

**Currently implemented (Phase 1, Weeks 1–2):**

- `src/core/types.ts` — shared types: `Point`, `Material`, `Contour`, `Chunk`, `HitResult`.
- `src/core/Materials.ts` — `MaterialRegistry` (id-validated material lookup).
- `src/core/ChunkedBitmap.ts` — chunked byte grid, dirty tracking, pixel I/O, coordinate conversion.
- `src/core/ops/Carve.ts` and `src/core/ops/Deposit.ts` — `circle(...)` and `polygon(...)`. Carve writes 0 (air); Deposit writes a caller-supplied material id. Same rasterizer underneath (`src/core/ops/raster.ts`). Sub-pixel coords supported; bounding box auto-clipped; degenerate inputs (radius ≤ 0, < 3 polygon vertices) are no-ops. Polygons use the even-odd fill rule, so self-intersecting shapes are handled correctly.
- `src/core/algorithms/MarchingSquares.ts` — `extract(chunk, bitmap)` returns the per-chunk contour polygons in world coords. 1-pixel padding from neighbor chunks; saddle-point convention "TL-BR diagonal joined" is applied uniformly. Closed contours are emitted with `closed: true`; contours that pass through a chunk boundary come back as open chains for the physics adapter to stitch in Phase 2.

**Not yet implemented:** `Carve.fromAlphaTexture`, Douglas-Peucker, flood fill, spatial queries, the Box2D adapter, the Phaser plugin, `DestructibleTerrain` GameObject, `PixelPerfectSprite`. See `docs-dev/02-roadmap.md` for the build sequence.

## When to use this skill

Apply this skill when:

- Building a Phaser v4 game with destructible terrain.
- Implementing alpha-aware (pixel-perfect) sprite collision.
- Generating gameplay terrain from a PNG mask.
- Doing spatial queries against a procedurally-modified 2D world.

Do not apply this skill when:

- Working in Phaser v3 (incompatible).
- Building a 3D game.
- Needing a full physics-driven destruction simulation (use a dedicated engine).

## Core principle

The bitmap is the source of truth. All visuals and physics colliders are derived from it. To modify the world, mutate the bitmap; the library handles propagation.

## Quickstart (target API, post-Phase-3)

```ts
import Phaser from 'phaser';
import { PixelPerfectPlugin } from 'pixel-perfect';

const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    scene: { create, update },
    plugins: {
        global: [{ key: 'PixelPerfect', plugin: PixelPerfectPlugin, start: true }],
    },
};

new Phaser.Game(config);

function create(this: Phaser.Scene) {
    const terrain = this.pixelPerfect.terrain({
        width: 4096,
        height: 1024,
        chunkSize: 128,
        pixelsPerMeter: 32,
        fromImage: 'island-mask',
        materials: [
            {
                id: 1,
                name: 'dirt',
                color: 0x8b5a3c,
                density: 1,
                friction: 0.7,
                restitution: 0.1,
                destructible: true,
                destructionResistance: 0,
            },
        ],
        physicsWorld: this.box2dWorld,
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
        terrain.carve.circle(p.worldX, p.worldY, 40);
    });

    terrain.on('debris:detached', (debris) => {
        console.log('detached:', debris.contour.length, 'vertices');
    });
}

function update(this: Phaser.Scene) {
    // The plugin auto-flushes pending physics rebuilds in postUpdate.
    // Nothing to do here for terrain.
}
```

## Concepts

### Bitmap

A `width × height` byte grid. Each byte is a material ID. `0` = air, `1..255` = user-defined materials.

### Chunk

A fixed-size sub-region of the bitmap (default 128×128 pixels). All operations dirty chunks; rebuilds happen at chunk granularity.

Each chunk carries two independent dirty flags:

- `dirty` — collider rebuild pending. Cleared by the physics adapter via `bitmap.clearDirty(chunk)` after a successful rebuild.
- `visualDirty` — texture upload pending. Cleared by the renderer via `bitmap.clearVisualDirty(chunk)` after a successful upload.

### Material

A type with rendering and physics properties (color, density, friction, etc.). Registered up-front when creating a terrain.

### Contour

A polygon outline extracted from the bitmap by marching squares. Used to build Box2D chain colliders and dynamic debris bodies. Vertices are in world coordinates.

### Debris

Solid bitmap regions that become disconnected from anchors after destruction. Detected by flood fill, converted to dynamic Box2D bodies.

## Currently exposed core API (Phase 1, Week 1)

The following surfaces are stable enough to use today. Higher-level wrappers (`scene.pixelPerfect.terrain`, etc.) build on these.

### `new ChunkedBitmap({ width, height, chunkSize, materials? })`

Creates a chunked byte grid sized `width × height`. `chunkSize` must divide both. Materials are optional at construction; the registry can be added to later via `bitmap.materials.register(material)`.

### `bitmap.getPixel(x, y) → number`

Returns the material id at world coords. Out-of-bounds returns `0` (treat-as-air); this simplifies neighbor sampling at world edges.

### `bitmap.setPixel(x, y, materialId) → void`

Writes a cell. Throws on out-of-bounds coordinates and on material ids outside `0..255`. Skips the dirty mark if the new value equals the current value (no spurious rebuilds for redundant carves).

### `bitmap.getChunk(cx, cy) → Chunk`

Returns a chunk by chunk-grid coords. Throws if out of range.

### `bitmap.forEachDirtyChunk(callback)`

Iterates dirty chunks in row-major (cy, cx) order — stable for replay debugging.

### `bitmap.clearDirty(chunk)` / `bitmap.clearVisualDirty(chunk)`

Independently clear the collider and visual flags. Call from the physics adapter and renderer respectively.

### `bitmap.worldToChunk(x, y) → { cx, cy }` / `bitmap.worldToChunkLocal(x, y) → Point`

Coordinate-conversion helpers.

### `new MaterialRegistry(materials?)` / `registry.register(material)` / `registry.get(id)` / `registry.getOrThrow(id)`

Material lookup. Ids must be integers in `1..255` (id 0 is reserved for air).

### `Carve.circle(bitmap, cx, cy, radius) → void`

Sets every cell within `radius` of `(cx, cy)` to air. Cells at exactly `radius` are included (`dx² + dy² ≤ r²`). Sub-pixel `cx`/`cy` are allowed. The bounding box is clipped to bitmap bounds; circles that fall entirely outside are silent no-ops. `radius ≤ 0` and `NaN` are no-ops.

### `Carve.polygon(bitmap, points) → void`

Sets every cell inside the closed polygon to air. The polygon is implicitly closed (the last point connects back to the first). Filling uses the even-odd rule, so self-intersecting polygons carve correctly (a bowtie carves both lobes; the central crossing region is left untouched). Polygons with fewer than 3 vertices are no-ops; the scanline range is clipped to the bitmap, so polygons that fall outside are silent.

### `Deposit.circle(bitmap, cx, cy, radius, materialId) → void` / `Deposit.polygon(bitmap, points, materialId) → void`

Same shapes and clipping as `Carve.*`, but writes `materialId` instead of air. Throws (via `setPixel`) if `materialId` is outside `0..255`. The id is not validated against the bitmap's material registry — callers may use unregistered ids if they own their own renderer / lookup pipeline (the renderer or physics adapter will surface the bad id when it tries to look up properties).

### `MarchingSquares.extract(chunk, bitmap) → Contour[]`

Extracts contour polygons from one chunk. Output vertices are in world coordinates at half-integer positions (cell-edge midpoints). Saddle cells use the TL-BR-joined convention uniformly so adjacent chunks produce topologically consistent stitching. Each contour reports `closed: true` if the polyline closes within the chunk's padded sample window, or `closed: false` if it extends across a chunk boundary — the physics adapter is responsible for joining open chains across chunks. Walks each segment with solid on the visual-LEFT side, so closed solid blobs walk visually-clockwise (math-CCW in y-down).

## Public API (target shape, post-Phase-3)

### `scene.pixelPerfect.terrain(config)` → `DestructibleTerrain`

Creates a destructible terrain GameObject. Config:

- `width`, `height` — world size in pixels.
- `chunkSize` — default 128.
- `pixelsPerMeter` — default 32.
- `fromImage` — Phaser texture key with alpha; non-zero alpha becomes solid.
- `materials` — array of `Material` definitions.
- `physicsWorld` — Phaser Box2D world reference.

### `terrain.carve.circle(x, y, radius)`

### `terrain.carve.polygon(points)`

### `terrain.carve.fromAlpha(x, y, textureKey, threshold?)`

### `terrain.deposit.circle(x, y, radius, materialId)`

### `terrain.deposit.polygon(points, materialId)`

Mutate the bitmap. Affected chunks are dirtied; rebuild and visual update happen at end-of-frame.

### `terrain.isSolid(x, y) → boolean`

### `terrain.sampleMaterial(x, y) → number`

### `terrain.raycast(x1, y1, x2, y2) → HitResult | null`

### `terrain.surfaceY(x) → number`

Spatial queries. Read directly from the bitmap; microsecond cost.

### `terrain.on(event, handler)`

Events:

- `'debris:detached'` — emitted when destruction creates an isolated solid region. Handler receives `{ contour, material, position }`.
- `'chunk:rebuilt'` — emitted after a chunk's colliders are regenerated. Useful for debug overlays.

### `scene.pixelPerfect.sprite(scene, x, y, textureKey)` → `PixelPerfectSprite`

Wraps a Phaser sprite with alpha-aware collision.

### `pixelSprite.overlapsPixelPerfect(other)` → `boolean`

### `pixelSprite.overlapsTerrain(terrain)` → `boolean`

Alpha-aware overlap checks.

## Common patterns

### Carving from a grenade explosion

```ts
function explode(x: number, y: number, radius: number) {
    terrain.carve.circle(x, y, radius);
    // Knockback nearby dynamic bodies (your game logic, not the library).
}
```

### Spawning a character on the terrain surface

```ts
const groundY = terrain.surfaceY(spawnX);
const character = scene.add.sprite(spawnX, groundY - 16, 'character');
```

### Handling falling debris

```ts
terrain.on('debris:detached', ({ contour, material, position, body }) => {
    const sprite = scene.add.image(position.x, position.y, 'debris-texture');
    // Optionally attach the sprite to the body for rendering.
});
```

### Procedural island from PNG

```ts
this.load.image('island-mask', 'assets/island.png');
// then:
const terrain = scene.pixelPerfect.terrain({
    /* ... */
    fromImage: 'island-mask',
});
```

## Pitfalls

- **Modifying a terrain before `physicsWorld` exists.** Initialize Box2D first.
- **Calling `carve` from inside a Box2D contact callback.** Defer to next frame; the rebuild queue assumes single-pass mutation.
- **Expecting visuals to update synchronously after `carve`.** Updates happen at end-of-frame via `postUpdate`. If you need synchronous visual feedback (a flash), draw it yourself; don't rely on the chunk repaint.
- **Using world coordinates above `width`/`height`.** `getPixel` clamps silently to air; `setPixel` throws. Carve / deposit ops are responsible for clipping their footprints before calling `setPixel`.
- **High-frequency tiny carves.** 1000 carves of radius 1 in one frame still rebuild only the affected chunks (cheap), but the per-call overhead adds up. Batch logically-grouped destruction into one larger carve when possible.
- **Not registering all materials up-front.** The `ChunkedBitmap` itself accepts any byte 0..255 in `setPixel`, but renderers and the physics adapter look up by id; an unregistered id will fall back to "unknown material" or throw at the consumer.
- **Treating a `PixelPerfectSprite` as a normal sprite for performance.** The alpha bitmap is computed lazily on first overlap check. Pre-warm in `preload` if you have many.

## Performance notes

- Default chunk size 128×128 is tuned for typical use. Smaller chunks = finer dirty granularity but more overhead. Larger chunks = fewer ops but heavier per-rebuild cost.
- The deferred rebuild queue processes up to 4 chunks per frame by default. Configurable.
- Marching squares + Douglas-Peucker for one chunk is ~1ms on mid-range hardware.
- `surfaceY` is O(height); for repeated queries on the same column, cache the result.
- Pixel-perfect sprite collision is O(overlap area). A 64×64 sprite vs 64×64 sprite is ~4096 pixel checks; fast but not free.

## Coordinate systems

- **World coords** — what you pass to public APIs. Pixels in your Phaser world.
- **Bitmap coords** — internal. 1:1 with world coords by default; configurable via `pixelsPerMeter`.
- **Box2D coords (meters)** — handled by the adapter. Don't see these unless you reach into `terrain.physicsAdapter` directly.

## When you need to escape

If the public API doesn't expose what you need:

```ts
const bitmap = terrain.bitmap; // ChunkedBitmap
const adapter = terrain.physicsAdapter; // Box2DAdapter
```

These are not stable APIs. Treat them as escape hatches; ideally file an issue describing the use case so a stable API can be added.

## Reporting issues

https://github.com/dzyamik/pixel-perfect/issues

Include: Phaser version, Phaser Box2D version, repro steps, and ideally a minimal reproduction. The maintainer (dzyamik) is solo; clear repros get fixed faster.

## License

MIT.
