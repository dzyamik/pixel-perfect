# pixel-perfect

> Pixel-perfect spatial reasoning for Phaser v4: chunked-bitmap destructible terrain, alpha-aware sprite collision, and procedural-mask utilities.

![pixel-perfect — destructible terrain demo](media/hero.gif)

**Status:** `v3.1.34` — stable public surface; **mass-based fluid simulation** (water/oil/gas) with continuous Float32 mass per cell. Pressure emerges from the over-compression overflow rule, so surfaces actually flatten. **Pool-aware step (v3.1.x)**: every tick the sim flood-fills connected fluid components — multi-material as of v3.1.17, so any 4-connected fluid cells (regardless of id) join one pool — and writes a density-stratified bottom-up profile (heaviest fluid at the bottom, lightest at the top, transitioning row-by-row). Oil floats on water, gas rises through both, and a water "chimney" through oil heals within a tick. As of v3.1.19, **enclosed air bubbles** (air pockets fully bounded by fluid + static) are detected and lifted one row per tick by swapping with the fluid cell directly above; bubbles surface at an open-air boundary and pop, sealed lids trap them under the lid. v3.1.20 hardens the bubble lift against gas (which is lighter than air, so swapping would invert the correct density layering) and adds a float-drift tolerance to the multi-fluid transition row so a residual 1e-7 of the heavier fluid can't steal the cell slot the lighter fluid needs. v3.1.21 routes "stuck" bubbles (cells trapped under a stone overhang) through `distributePoolMass` to relocate them to the pool surface in one tick, so a vase / cavity / U-shape filled from above doesn't leave a dead air pocket below. Pool interiors skip per-cell flow; perimeter cells handle drainage and cross-material swaps. **Gas-pool lift (v3.1.28-34)**: gas pools translate as a unit — `liftGasPool` swaps gas cells with whatever sits above (air, fire, water, etc.) so a contiguous blob rises without smearing. v3.1.29 adds diagonal-up swaps so gas slides around overhangs; v3.1.30 spreads gas laterally when a ceiling blocks vertical motion (so volume "grows" against the lid instead of piling at one column); v3.1.33 collapses the per-cell cascade into a polygon column-shift (read the upcells once, copy gas masses up by `k` rows in one tight loop, write `k` cells of gas at the top + `k` cells of air at the bottom — ~50× fewer id writes per column for a tall blob); v3.1.34 raises the lift rate to 6 rows / tick (vertical + lateral). v3.1.32 also caches the air-flood `visited` scratch and fast-paths edge-touching air components, so the per-tick pool pipeline doesn't allocate a fresh `Uint8Array(W×H)` every frame. **Cliff drainage** (v3.1.12-16): off-cliff lateral donation requires a stone-anchored source; donation distance scales with the source's "head" so pool depth N → stream width N (Bernoulli `width ∝ head`, discretized). Lateral scan direction and within-row processing order ping-pong per tick for L/R symmetry. Lateral reach spreads up to 25 cells/tick (~25× gravity), throttled to 5 above ~8 000 active cells. Sand / fire / static stay binary (v2.x rules preserved). Cross-material density swaps still atomic. Sparse active-cell tracking (v2.4) + fast-path direct array access (v3.0.3) keep step cost proportional to moving cells. Demos 03/07/09 carry annotated `@snippet` blocks rendered as ready-to-paste cards (v2.6); a top-level [recipes index](https://dzyamik.github.io/pixel-perfect/recipes/) aggregates them. Local development only (not on npm yet).

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

The `examples/` folder is built into `docs/` and committed; run them locally with `npm run dev`, or browse the deployed copies at https://dzyamik.github.io/pixel-perfect/. Every demo's nav has a "view source" link straight to its `main.ts`.

| Demo | What it shows |
|---|---|
| 01 — basic rendering | TerrainRenderer painting a procedural bitmap |
| 02 — click to carve | input + carve + per-chunk repaint |
| 03 — physics colliders | Box2D world, drop balls, debug overlay |
| 04 — falling debris | DebrisDetector + dynamic bodies, L-shaped pieces falling |
| 05 — pixel-perfect sprite | drag a circle onto a ring + terrain; bbox vs pixel-perfect |
| 06 — worms-style | walking circle + grenades that carve and detach cliff slabs |
| 07 — image-based terrain | stamp a PNG / canvas alpha mask onto the bitmap, then carve |
| 08 — sprite playground | upload your own PNG; cyan outline traces the alpha mask |
| 09 — falling sand sandbox | five fluid kinds (sand / water / oil / gas / fire) + flammable wood + ball drop |

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

## API reference

Generated by TypeDoc from the `src/` TSDoc comments. Built locally
via `npm run build` into `docs/api/` and deployed alongside the demos
at https://dzyamik.github.io/pixel-perfect/api/.

## Roadmap

See [`docs-dev/02-roadmap.md`](docs-dev/02-roadmap.md). Current state of in-flight work and known limitations live in [`docs-dev/PROGRESS.md`](docs-dev/PROGRESS.md).

## Architecture

See [`docs-dev/01-architecture.md`](docs-dev/01-architecture.md). Three layers, depend downward only:

- `src/phaser/` — plugin and GameObjects.
- `src/physics/` — Box2D adapter.
- `src/core/` — pure TypeScript, zero runtime deps.

## Contributing

Patches and bug reports welcome. See
[`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev workflow and
[`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/) for bug / feature
templates. Project conduct: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## License

MIT.
