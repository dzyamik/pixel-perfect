# 05 — SKILL.md template

This is the template for the project's own `SKILL.md`, which lives at the repo root and is the reference for AI agents (including future Claude Code sessions) consuming the library. It follows the format Phaser v4 uses for its bundled skills.

`SKILL.md` is filled in incrementally during development. Drop the skeleton at bootstrap; flesh it out as APIs stabilize.

---

## Initial skeleton (commit during Phase 0)

```markdown
# pixel-perfect

> Pixel-perfect spatial reasoning for Phaser v4: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities.

## Status

Alpha. Under active development. APIs may change before v1.0.0.

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

The bitmap is the source of truth. All visuals and physics colliders are
derived from it. To modify the world, mutate the bitmap; the library
handles propagation.

## Quickstart

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
      { id: 1, name: 'dirt', color: 0x8b5a3c, density: 1, friction: 0.7,
        restitution: 0.1, destructible: true, destructionResistance: 0 },
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

### Material

A type with rendering and physics properties (color, density, friction, etc.). Registered up-front when creating a terrain.

### Contour

A polygon outline extracted from the bitmap by marching squares. Used to build Box2D chain colliders and dynamic debris bodies.

### Debris

Solid bitmap regions that become disconnected from anchors after destruction. Detected by flood fill, converted to dynamic Box2D bodies.

## Public API

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
- **Using world coordinates above `width`/`height`.** Coordinates outside the bitmap are clamped silently in v1; this may become a thrown error in v1.1.
- **High-frequency tiny carves.** 1000 carves of radius 1 in one frame still rebuild only the affected chunks (cheap), but the per-call overhead adds up. Batch logically-grouped destruction into one larger carve when possible.
- **Not registering all materials up-front.** Material IDs must exist before any pixel is painted with them.
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
const bitmap = terrain.bitmap;            // ChunkedBitmap
const adapter = terrain.physicsAdapter;   // Box2DAdapter
```

These are not stable APIs. Treat them as escape hatches; ideally file an issue describing the use case so a stable API can be added.

## Reporting issues

https://github.com/dzyamik/pixel-perfect/issues

Include: Phaser version, Phaser Box2D version, repro steps, and ideally a minimal reproduction. The maintainer (dzyamik) is solo; clear repros get fixed faster.

## License

MIT.
```

---

## How to maintain this skill

- Treat it as part of the public API. Update it when the public API changes.
- Each Phase end (per `02-roadmap.md`), do a `SKILL.md` audit: are the documented APIs current? Are new pitfalls captured?
- During Phase 5 (Docs & polish), this is finalized as the v1.0.0 reference.

## Why this matters

The Phaser v4 team chose to ship AI Agent skills inside their npm package. If pixel-perfect ever goes to npm, shipping a polished `SKILL.md` means consumers of the library can drop it into their Claude Code (or any other AI coding assistant) workflow with zero configuration. This is a small but real differentiator versus libraries that make consumers reverse-engineer the API from TypeScript types.

Even before npm publication, having a clean `SKILL.md` in the repo means anyone cloning the project (you in 6 months, contributors, future-you debugging) gets correctly-grounded AI assistance immediately.
