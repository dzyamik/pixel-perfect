# pixel-perfect

> Pixel-perfect spatial reasoning for Phaser v4: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities.

**Status:** alpha — under active development. Expect API churn before v1.0.0.

## What this is

A library for Phaser v4 games that need pixel-accurate world manipulation:

- Destructible terrain with proper Box2D colliders that follow the bitmap.
- Alpha-aware sprite-vs-sprite and sprite-vs-terrain collision.
- Procedural terrain generation from PNG masks.
- Spatial queries (raycast, surface-find, material sampling) directly on the bitmap.

The bitmap is the source of truth — all visuals and physics colliders are derived from it. Mutate the bitmap; everything else updates automatically at end-of-frame.

## Why

Phaser v4 + Phaser Box2D are both production-ready, but no maintained library exists for pixel-perfect spatial reasoning on this stack. This fills the gap.

## Live demos

The `examples/` folder is built into `docs/` and committed; run them locally with `npm run dev`, or browse the deployed copies at https://dzyamik.github.io/pixel-perfect/.

| Demo | What it shows |
|---|---|
| 01 — basic rendering | TerrainRenderer painting a procedural bitmap |
| 02 — click to carve | input + carve + per-chunk repaint |
| 03 — physics colliders | Box2D world, drop balls, debug overlay |
| 04 — falling debris | DebrisDetector + dynamic bodies, L-shaped pieces falling |

## Quickstart

```ts
import * as Phaser from 'phaser';
import { PixelPerfectPlugin } from 'pixel-perfect';

class GameScene extends Phaser.Scene {
    create() {
        const terrain = this.pixelPerfect.terrain({
            width: 512,
            height: 256,
            chunkSize: 64,
            x: 64,
            y: 32,
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
            // worldId: yourBox2DWorld, // optional — physics integration
        });

        // Carve / deposit at any time. End-of-frame, the plugin
        // flushes pending physics rebuilds and repaints dirty chunks.
        this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
            terrain.carve.circle(p.worldX, p.worldY, 16);
        });
    }
}

new Phaser.Game({
    type: Phaser.AUTO,
    width: 640,
    height: 360,
    scene: GameScene,
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

For physics integration (debris, falling chunks, sprite collision), see the demos under `examples/03-physics/` and `examples/04-falling-debris/`.

## Roadmap

See [`docs-dev/02-roadmap.md`](docs-dev/02-roadmap.md). Current state of in-flight work and known limitations live in [`docs-dev/PROGRESS.md`](docs-dev/PROGRESS.md).

## Architecture

See [`docs-dev/01-architecture.md`](docs-dev/01-architecture.md). Three layers, depend downward only:

- `src/phaser/` — plugin and GameObjects.
- `src/physics/` — Box2D adapter.
- `src/core/` — pure TypeScript, zero runtime deps.

## License

MIT.
