# pixel-perfect

> Pixel-perfect spatial reasoning for Phaser v4: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities.

## Status

Alpha. Under active development. APIs may change before v1.0.0.

Phase progression:

- ✅ **Phase 1 — `src/core/`** (`v0.1.0`): `ChunkedBitmap`, `Materials`, `Carve` / `Deposit` (circle / polygon / fromAlphaTexture), `MarchingSquares`, `DouglasPeucker`, `FloodFill`, `Spatial` queries.
- ✅ **Phase 2 — `src/physics/`** (`v0.2.0`): typed `phaser-box2d` binding, `Box2DAdapter` (static terrain + dynamic debris bodies), `DeferredRebuildQueue` (end-of-frame body churn), `DebrisDetector` (FloodFill + contour extraction).
- ✅ Phase 2.5 retired and superseded by Phase 3's per-chunk + polygon-triangulation collider model. Cross-chunk stitching is no longer required.
- ✅ **Phase 3 — `src/phaser/`** (`v0.3.0`): `TerrainRenderer`, `DestructibleTerrain` GameObject, `PixelPerfectPlugin` (the public entry point — `scene.pixelPerfect.terrain({...})`, `.sprite(...)`), `PixelPerfectSprite` (alpha-aware sprite-vs-sprite + sprite-vs-terrain collision). Collider model is per-chunk, two-sided polygons triangulated via earcut, with snapshot/restore of dynamic bodies across each rebuild.
- ✅ **Phase 4 — examples + perf pass** (`v0.4.0`): Worms-style demo (`06`), image-based terrain demo (`07`), and a ~10× speedup on the `TerrainRenderer` hot loop via packed-RGBA LUT + `Uint32Array` view of `ImageData`.
- ✅ **Phase 5 — docs & polish** (`v1.0.0`): TypeDoc API ref, CONTRIBUTING / CoC / issue templates, hero gif.
- ✅ **v1.1 — `PixelPerfectSprite` scaling + rotation, jitter fix** (`v1.1.0`): both v1 sprite limitations lifted; the residual sub-pixel jitter on actively-carved chunks closed via force-settle in `Box2DAdapter.restoreDynamicBodies`.
- ✅ **v2 — cellular-automaton falling sand** (`v2.0.0`): `Material.simulation: 'static' | 'sand'`, `CellularAutomaton.step`, `DestructibleTerrain.simStep` + `autoSimulate` opt-in, demo 09. Static-only collider filtering means per-frame sand motion doesn't trigger physics rebuilds.
- ✅ **v2.1 — water + density swap** (`v2.1.0`): `SimulationKind` extended with `'water'`. Water falls / slides diagonally / spreads horizontally. Sand sinks through water on straight-down moves; water doesn't displace sand. Demo 09 gained a sand/water tool toggle.
- ✅ **v2.2 — sand-pile settling** (`v2.2.0`): bridges fluid sim and physics. `Material.settlesTo` + `settleAfterTicks` promote at-rest sand cells to a static variant that joins the collider mesh, so dynamic bodies can stand on piles. New `ChunkedBitmap.cellTimers` per-cell `Uint8Array` for any per-tick state. Demo 09 wired Box2D + a `B`-key ball drop so the bridge is visible end-to-end.

The seven runnable demos are in `examples/`, built into `docs/`:

| Demo | What it shows |
|---|---|
| 01 — basic rendering | TerrainRenderer painting a procedural bitmap |
| 02 — click to carve | input + carve + per-chunk repaint |
| 03 — physics colliders | Box2D world, drop balls, debug overlay |
| 04 — falling debris | DebrisDetector + dynamic bodies, L-shaped pieces falling |
| 05 — pixel-perfect sprite | drag a circle onto a ring + terrain; bbox vs pixel-perfect overlap |
| 06 — worms-style | walking circle + grenades that carve and detach cliff slabs |
| 07 — image-based terrain | stamp a PNG / canvas alpha mask onto the bitmap, then carve |
| 08 — sprite playground | upload a PNG, see its alpha mask outlined, scale + rotate the sprite; AABB vs pixel-perfect side-by-side |
| 09 — falling sand + water | sand and water under a cellular-automaton step; sand sinks through water; carve the funnel floor to drain |

For current in-flight work and known limitations, see `docs-dev/PROGRESS.md`.

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

## Quickstart

```ts
import * as Phaser from 'phaser';
import { PixelPerfectPlugin } from 'pixel-perfect';

class GameScene extends Phaser.Scene {
    create() {
        const terrain = this.pixelPerfect.terrain({
            width: 1024,
            height: 512,
            chunkSize: 64,
            pixelsPerMeter: 32,
            x: 64,
            y: 64,
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
            // worldId: yourBox2DWorldId, // optional — physics integration
            // onDebrisCreated: ({ bodyId, contour, material }) => { /* ... */ },
        });

        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            terrain.carve.circle(p.worldX, p.worldY, 40);
        });
    }
}

new Phaser.Game({
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    scene: GameScene,
    // Register the plugin once. `mapping: 'pixelPerfect'` is what
    // makes `scene.pixelPerfect` available inside any scene.
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
```

The plugin auto-flushes terrain rebuilds and chunk repaints on the
scene's `POST_UPDATE` event. Demos that step a Box2D world themselves
inside `update()` should still call `terrain.update()` manually before
the step so colliders are fresh — see `examples/03-physics/main.ts`
and `examples/04-falling-debris/main.ts` for the pattern.

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

### `Carve.fromAlphaTexture(bitmap, source, dstX, dstY, threshold = 128) → void` / `Deposit.fromAlphaTexture(bitmap, source, dstX, dstY, materialId, threshold = 128) → void`

Stamps an alpha mask onto the bitmap. The source is an `AlphaSource = { data: Uint8ClampedArray, width, height }` (browser `ImageData` satisfies this); for each source pixel whose alpha byte is `>= threshold`, the corresponding bitmap cell at world `(dstX + sx, dstY + sy)` is set (Carve → 0, Deposit → `materialId`). Source rectangles that overhang or fall entirely outside the world are clipped silently. Threshold default `128` matches the typical "non-transparent counts as solid" cut-off for game-asset PNG masks.

### `MarchingSquares.extract(chunk, bitmap) → Contour[]`

Extracts contour polygons from one chunk. Output vertices are in world coordinates at half-integer positions (cell-edge midpoints). Saddle cells use the TL-BR-joined convention uniformly so adjacent chunks produce topologically consistent contours. Each contour reports `closed: true` if the polyline closes within the chunk's padded sample window. Walks each segment with solid on the visual-LEFT side, so closed solid blobs walk visually-clockwise (math-CCW in y-down).

For the destructible-terrain pipeline, the physics adapter doesn't call `MarchingSquares.extract` directly — it goes through `chunkToContours(chunk, bitmap, epsilon)` (in `src/physics/`), which builds a 1-pixel-air-padded temp bitmap of just the chunk's pixels so every contour closes locally regardless of how the surrounding world looks. This keeps each chunk's collider self-contained and lets carving in chunk A leave chunks B…N untouched.

### `DouglasPeucker.simplify(contour, epsilon) → Contour`

Reduces a polyline's vertex count by removing interior points within `epsilon` of the chord between their kept neighbors. Endpoints are always preserved. For closed contours, the input is split at the vertex farthest from `points[0]` so each half is simplified as a well-anchored open polyline; the closure is restored before return. The algorithm refuses to reduce a closed contour below 3 vertices — degenerate inputs are returned unchanged so consumers can keep treating the result as a polygon. Use `epsilon ≈ 1.0` pixel for default destructible-terrain output; circle contours typically reduce by ≥ 80%.

### `FloodFill.findIslands(bitmap, anchor) → Island[]`

Returns every connected component of solid cells that is not reachable from the anchor set. `anchor` is `{ kind: 'bottomRow' }` (treats every solid cell on the world's bottom row as anchored) or `{ kind: 'customPoints', points }` (caller-supplied anchors; air and out-of-bounds points are silently ignored). 4-connected BFS — diagonal-only contacts produce separate islands. Each `Island` carries `cells: Point[]` (BFS order) and `bounds: { minX, maxX, minY, maxY }` (inclusive). Use this in the destruction pipeline to identify newly-detached debris that should become dynamic Box2D bodies.

### `Spatial.isSolid(bitmap, x, y) → boolean` / `Spatial.sampleMaterial(bitmap, x, y) → number`

Direct read of the bitmap. Out-of-world coordinates return `false` / `0` (treat-as-air, consistent with `bitmap.getPixel`).

### `Spatial.surfaceY(bitmap, x) → number`

Walks down column `x` from `y = 0` and returns the y of the first solid cell. Returns `bitmap.height` when the column is empty or `x` is out of range — pick this sentinel so `surfaceY(x) - entityHeight` always yields a usable spawn position.

### `Spatial.findGroundBelow(bitmap, x, y, maxDist) → number | null`

Bounded version of `surfaceY`. Walks at most `maxDist` rows starting at `y` (inclusive); returns `null` if no solid cell is found in range or `maxDist <= 0`.

### `Spatial.raycast(bitmap, x1, y1, x2, y2) → HitResult | null`

Bresenham line walk from `(x1, y1)` to `(x2, y2)`. Returns the first solid cell encountered, with its material id and Euclidean distance from the start, or `null` for an air-only path. Endpoints are floored to integers internally; rays starting on solid return the start cell with distance 0.

## Public API (Phaser layer)

### `scene.pixelPerfect.terrain(options)` → `DestructibleTerrain`

Plugin factory. Creates a destructible terrain whose scene is
auto-supplied; the returned terrain is registered with the plugin
for auto-update and auto-destroy. Equivalent direct constructor:
`new DestructibleTerrain({ scene: this, ...options })`.

Options:

- `width`, `height` — world size in pixels (must divide `chunkSize`).
- `chunkSize` — default 64.
- `x`, `y` — top-left of the terrain in scene coordinates. Default `(0, 0)`.
- `pixelsPerMeter` — default 32 (matches Phaser Box2D convention).
- `materials` — array of `Material` definitions to register with the bitmap.
- `worldId` — optional Box2D world id. Without it, the terrain is purely visual (carve/deposit/queries still work; no colliders).
- `simplificationEpsilon` — Douglas-Peucker epsilon for collider contours. Default 1.
- `onDebrisCreated` — callback invoked once per debris body the queue creates, after `extractDebris()` detaches an island.

To stamp a PNG mask onto an existing terrain, use `terrain.carve.fromAlphaTexture(source, dstX, dstY, threshold?)` or the matching `terrain.deposit.fromAlphaTexture(...)`.

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

### `terrain.extractDebris(anchor?, simplificationEpsilon?)`

Detects every connected solid component that is not anchored, removes
its cells from the bitmap, and (when physics is enabled) enqueues a
dynamic body for each. Returns the detected debris as
`DebrisInfo[]` with scene-coordinate contours and bounds, ready for
the caller to spawn its own visuals. Anchor strategy defaults to
`{ kind: 'bottomRow' }`.

### Debris callback (set at construction)

Pass `onDebrisCreated: ({ bodyId, contour, material }) => { ... }`
when constructing the terrain. The plugin's
`scene.pixelPerfect.terrain({ ... })` factory accepts this option.
The callback fires once per dynamic body the queue creates, with the
bitmap-space outer contour and the material used for the body's
physical properties. Body lifetime is the caller's responsibility —
debris bodies are not destroyed by the terrain itself.

There is currently no `chunk:rebuilt` event on the terrain; if you
need that for a debug overlay, pass `onChunkRebuilt` to a
`DeferredRebuildQueue.flush(...)` call directly. Or read
`terrain.bitmap.chunks[*].contours` after `terrain.update()`.

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
const terrain = this.pixelPerfect.terrain({
    // ...
    onDebrisCreated: ({ bodyId, contour, material }) => {
        // contour is in bitmap coords; the body sits at the contour
        // centroid translated to the terrain's scene origin. Build a
        // Phaser.Graphics traced from the contour minus its centroid
        // (so it rotates around the body's COM) — see
        // examples/04-falling-debris/main.ts for the reference impl.
    },
});

// Trigger detection — typically once per frame after potentially
// detaching carves. extractDebris() removes cells from the bitmap
// and enqueues dynamic bodies for the next plugin update.
this.terrain.extractDebris();
```

### Procedural island from PNG

```ts
// In preload():
this.load.image('island-mask', 'assets/island.png');

// In create():
const terrain = this.pixelPerfect.terrain({
    width: 1024,
    height: 512,
    chunkSize: 64,
    materials: [/* ... */],
});

// Stamp the mask: anywhere alpha is >= threshold becomes solid
// material id 1.
const tex = this.textures.get('island-mask');
const src = tex.getSourceImage() as HTMLImageElement;
const tmp = document.createElement('canvas');
tmp.width = src.width;
tmp.height = src.height;
const ctx = tmp.getContext('2d')!;
ctx.drawImage(src, 0, 0);
const imageData = ctx.getImageData(0, 0, src.width, src.height);
terrain.deposit.fromAlphaTexture(imageData, 0, 0, 1, 128);
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
- **Box2D coords (meters)** — handled by the adapter. Don't see these unless you reach into `terrain.physics?.adapter` directly.

## When you need to escape

If the public API doesn't expose what you need:

```ts
const bitmap = terrain.bitmap;          // ChunkedBitmap
const adapter = terrain.physics?.adapter; // Box2DAdapter | undefined
const queue = terrain.physics?.queue;     // DeferredRebuildQueue | undefined
```

These are not stable APIs. Treat them as escape hatches; ideally file an issue describing the use case so a stable API can be added.

## Reporting issues

https://github.com/dzyamik/pixel-perfect/issues

Include: Phaser version, Phaser Box2D version, repro steps, and ideally a minimal reproduction. The maintainer (dzyamik) is solo; clear repros get fixed faster.

## Building the demos

The `examples/` folder holds runnable Phaser-based demo scenes. They are built into `docs/` (committed) and served as a static site. There is no CI / automated deployment:

```bash
npm run dev      # local dev server (http://localhost:5173/)
npm run build    # writes docs/ for deploy + commit
```

Treat `docs/` like generated source: re-run `npm run build` and commit before pushing demo changes you want public.

## License

MIT.
