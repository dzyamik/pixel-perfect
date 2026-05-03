/**
 * Demo 09 — falling sand + multi-fluid sandbox + ball drop.
 *
 * Showcase for the v2.3 cellular-automaton extensions: density-
 * ordered swaps across five fluid kinds, multi-cell horizontal flow
 * for liquids and gases, fire ignition + burn-out, plus the v2.2
 * sand → settled-sand bridge between fluid sim and physics.
 *
 *  - **sand**  falls / slides; sinks through water and oil; settles
 *               after 30 stationary ticks → settled-sand (static).
 *  - **water** falls / spreads (multi-cell flow); sinks through oil.
 *  - **oil**   floats on water (rank 3 < water rank 4); spreads.
 *  - **gas**   bubbles upward through air, water, oil; spreads.
 *  - **fire**  doesn't move; ignites adjacent flammable cells; dies
 *               after `burnDuration` ticks.
 *  - **wood**  static + flammable — fire's preferred fuel.
 *  - **napalm** flammable oil (v3.1.18) — `'oil'` simulation +
 *               `flammable: true`; ignites and burns across the
 *               connected pool when fire touches it.
 *  - **stone** plain static terrain (the funnel + floor).
 *  - **settled-sand** static promotion target; generates colliders.
 *
 *   left mouse  → spawn the active material at the cursor (drag)
 *   right mouse → carve any static cell (stone, wood, settled sand)
 *   wheel       → resize brush
 *   1 / 2 / 3 / 4 / 5 / 6 / 7
 *               → switch active material (sand / water / oil / gas / fire / wood / napalm)
 *   space       → one-shot patch of the active material at the top
 *   B           → drop a debris ball
 *   R           → reset terrain + clear everything
 *
 * `autoSimulate: true` runs one sim tick at the start of every
 * `terrain.update()`. Box2D physics is wired in too, so the ball
 * drop still demonstrates the sim → physics bridge — pour sand,
 * wait for it to settle, drop a ball, watch it roll on the pile.
 */

import * as Phaser from 'phaser';
import * as b2 from 'phaser-box2d/dist/PhaserBox2D.js';
import type { DestructibleTerrain, Material } from '../../src/index.js';
import type { BodyId, WorldId } from '../../src/physics/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';
import { mountCodePanel } from '../_shared/code-panel.js';
import demoSource from './main.ts?raw';

const WIDTH = 512;
const HEIGHT = 256;
const CHUNK_SIZE = 64;
const PIXELS_PER_METER = 32;
const BALL_RADIUS_PX = 6;

const STONE: Material = {
    id: 1,
    name: 'stone',
    color: 0x556070,
    density: 2.5,
    friction: 0.9,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'static',
};

// @snippet settling-sand
// @title Settling sand (sim → physics bridge)
// @desc A `'sand'`-simulation Material that, after 30 stationary
// @desc ticks (~½ s at 60 fps), promotes in-place to a static
// @desc variant. The static promotion enters the chunk-collider
// @desc mesh, so dynamic bodies can stand on the resulting pile.
const SETTLED_SAND: Material = {
    id: 4,
    name: 'settled-sand',
    color: 0xa88848,
    density: 1,
    friction: 0.7,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'static',
};

const SAND: Material = {
    id: 2,
    name: 'sand',
    color: 0xd4b06a,
    density: 1,
    friction: 0.5,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'sand',
    settlesTo: SETTLED_SAND.id,
    settleAfterTicks: 30,
};
// @endsnippet

// @snippet water-material
// @title Water material
// @desc Liquid: falls / spreads. Density rank 4 — sinks through
// @desc oil (rank 3) and gas (rank 0); blocked by sand (rank 5)
// @desc and any static cell. `flowDistance: 4` is the v2.7
// @desc default if omitted; tune per-fluid for visual variety
// @desc (lava: 2 = treacly, water: 4, gas: 6 = aggressive).
const WATER: Material = {
    id: 3,
    name: 'water',
    color: 0x4080c0,
    density: 1,
    friction: 0,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'water',
    flowDistance: 4,
};
// @endsnippet

const OIL: Material = {
    id: 5,
    name: 'oil',
    color: 0x2a1f14,
    density: 0.9,
    friction: 0.2,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'oil',
    // Slightly viscous compared to water — slower spread.
    flowDistance: 3,
};

const GAS: Material = {
    id: 6,
    name: 'gas',
    color: 0x90b0d0,
    density: 0.1,
    friction: 0,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'gas',
    // Aggressive lateral spread so a rising plume reaches the
    // ceiling and levels visibly within a couple of ticks.
    flowDistance: 6,
};

// @snippet fire-and-fuel
// @title Fire material + flammable fuel
// @desc Fire ages and dies after `burnDuration` ticks. Each
// @desc tick it ignites the first adjacent cell whose material
// @desc has `flammable: true`, converting it to a fresh fire
// @desc cell with its own full burn timer. burnDuration must
// @desc be in 1..256 (Uint8Array clamp; values > 256 burn
// @desc forever — see docs-dev/04-tuning-research.md).
const FIRE: Material = {
    id: 7,
    name: 'fire',
    color: 0xff7030,
    density: 0,
    friction: 0,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'fire',
    burnDuration: 40,
};

const WOOD: Material = {
    id: 8,
    name: 'wood',
    color: 0x80502c,
    density: 1,
    friction: 0.6,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'static',
    flammable: true,
};
// @endsnippet

// @snippet napalm
// @title Napalm — flammable oil (v3.1.18)
// @desc A flammable variant of oil: same `'oil'` simulation kind
// @desc (density rank 3, floats on water, sinks through gas) but
// @desc `flammable: true` so an adjacent fire cell ignites it.
// @desc Each ignited cell turns to fire; the per-tick "fire
// @desc spreads to one flammable cardinal neighbor" rule then
// @desc walks the flame across the connected napalm pool, leaving
// @desc air behind as each cell's burn timer expires.
const NAPALM: Material = {
    id: 9,
    name: 'napalm',
    color: 0xb84020,
    density: 0.95,
    friction: 0.15,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'oil',
    flowDistance: 3,
    flammable: true,
};
// @endsnippet

interface Ball {
    bodyId: BodyId;
    image: Phaser.GameObjects.Image;
}

class FallingSandScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private worldId!: WorldId;
    private terrainOriginX = 0;
    private terrainOriginY = 0;

    private cursor!: Phaser.GameObjects.Graphics;
    private brushRadius = 3;
    private activeFluid: Material = SAND;
    private readonly balls: Ball[] = [];
    private stats!: ReturnType<typeof attachStats>;

    constructor() {
        super('falling-sand');
    }

    preload(): void {
        // Programmer-art ball: bright yellow disc, 1-px outline.
        const g = this.make.graphics({}, false);
        g.fillStyle(0xffe680, 1);
        g.fillCircle(BALL_RADIUS_PX, BALL_RADIUS_PX, BALL_RADIUS_PX);
        g.lineStyle(1, 0x000000, 0.6);
        g.strokeCircle(BALL_RADIUS_PX, BALL_RADIUS_PX, BALL_RADIUS_PX);
        g.generateTexture('ball', BALL_RADIUS_PX * 2, BALL_RADIUS_PX * 2);
        g.destroy();
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        // Box2D world.
        b2.SetWorldScale(PIXELS_PER_METER);
        b2.b2CreateWorldArray();
        const worldDef = b2.b2DefaultWorldDef();
        worldDef.gravity.y = -15;
        this.worldId = b2.b2CreateWorld(worldDef);

        this.terrainOriginX = (this.scale.width - WIDTH) / 2;
        this.terrainOriginY = (this.scale.height - HEIGHT) / 2;

        // @snippet terrain-with-fluids
        // @title Create terrain with fluids + Box2D
        // @desc `autoSimulate: true` runs one cellular-automaton
        // @desc tick at the start of every `terrain.update()`.
        // @desc `worldId` + `pixelsPerMeter` wires the chunk-
        // @desc collider mesh into Box2D — only `'static'`
        // @desc materials (and settled-sand) generate colliders;
        // @desc fluid cells are rendered but invisible to physics.
        this.terrain = this.pixelPerfect.terrain({
            width: WIDTH,
            height: HEIGHT,
            chunkSize: CHUNK_SIZE,
            x: this.terrainOriginX,
            y: this.terrainOriginY,
            worldId: this.worldId,
            pixelsPerMeter: PIXELS_PER_METER,
            materials: [STONE, SAND, WATER, SETTLED_SAND, OIL, GAS, FIRE, WOOD, NAPALM],
            autoSimulate: true,
        });
        // @endsnippet
        this.regenerateTerrain();

        this.cursor = this.add.graphics().setDepth(9999);

        this.input.mouse?.disableContextMenu();
        const action = (pointer: Phaser.Input.Pointer) => {
            if (pointer.leftButtonDown()) {
                // Spawn the active fluid inside the brush. Only set
                // cells currently air so we don't overwrite stone
                // walls or already-existing fluid.
                this.spawnBrushAt(pointer.worldX, pointer.worldY, this.activeFluid.id);
            } else if (pointer.rightButtonDown()) {
                this.terrain.carve.circle(pointer.worldX, pointer.worldY, this.brushRadius);
            }
        };
        this.input.on('pointerdown', action);
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            this.cursor.clear();
            // Tint the brush outline with the active fluid's color so
            // the user sees what they'd spawn before clicking.
            this.cursor.lineStyle(1, this.activeFluid.color, 0.85);
            this.cursor.strokeCircle(p.worldX, p.worldY, this.brushRadius);
            action(p);
        });
        this.input.on(
            'wheel',
            (
                _p: Phaser.Input.Pointer,
                _o: Phaser.GameObjects.GameObject[],
                _dx: number,
                deltaY: number,
            ) => {
                this.brushRadius = Phaser.Math.Clamp(
                    this.brushRadius + (deltaY < 0 ? 1 : -1),
                    1,
                    16,
                );
            },
        );
        this.input.keyboard?.on('keydown-SPACE', () => this.dumpFluid());
        this.input.keyboard?.on('keydown-R', () => this.regenerateTerrain());
        this.input.keyboard?.on('keydown-ONE', () => { this.activeFluid = SAND; });
        this.input.keyboard?.on('keydown-TWO', () => { this.activeFluid = WATER; });
        this.input.keyboard?.on('keydown-THREE', () => { this.activeFluid = OIL; });
        this.input.keyboard?.on('keydown-FOUR', () => { this.activeFluid = GAS; });
        this.input.keyboard?.on('keydown-FIVE', () => { this.activeFluid = FIRE; });
        this.input.keyboard?.on('keydown-SIX', () => { this.activeFluid = WOOD; });
        this.input.keyboard?.on('keydown-SEVEN', () => { this.activeFluid = NAPALM; });
        this.input.keyboard?.on('keydown-B', () => {
            const p = this.input.activePointer;
            this.spawnBall(p.worldX, p.worldY);
        });

        this.stats = attachStats(this);
        showHint(
            this,
            'L: paint · R-click: carve · 1-7: sand/water/oil/gas/fire/wood/napalm · B: ball · R: reset',
            8000,
        );
    }

    override update(_time: number, deltaMs: number): void {
        // Per-phase timing for profiling. v3.0.3 closed the
        // collider-rebuild stall, but the user's "10 fps with many
        // elements" report still warrants confirming where the
        // remaining frame budget goes. Numbers surface in the
        // stats overlay so the user sees them in real time.
        const t0 = performance.now();
        this.terrain.simStep();
        const tSim = performance.now();
        // Manual flush of the physics queue + repaint, lifted out of
        // `terrain.update()` so we can time them separately.
        this.terrain.bitmap.forEachDirtyChunk((chunk) => {
            this.terrain.physics?.queue.enqueueChunk(chunk);
        });
        this.terrain.physics?.queue.flush(this.terrain.physics.adapter);
        const tPhysFlush = performance.now();
        this.terrain.renderer.repaintDirty();
        const tRepaint = performance.now();
        b2.WorldStep({ worldId: this.worldId, deltaTime: deltaMs / 1000 });
        const tBox2D = performance.now();

        // Sync each ball's image with its body's transform. Cull
        // anything that fell off the world.
        for (let i = this.balls.length - 1; i >= 0; i--) {
            const ball = this.balls[i]!;
            const pos = b2.b2Body_GetPosition(ball.bodyId);
            const rot = b2.b2Body_GetRotation(ball.bodyId);
            ball.image.x = pos.x * PIXELS_PER_METER;
            ball.image.y = -pos.y * PIXELS_PER_METER;
            ball.image.rotation = -Math.atan2(rot.s, rot.c);
            if (ball.image.y > this.scale.height + 100) {
                b2.b2DestroyBody(ball.bodyId);
                ball.image.destroy();
                this.balls.splice(i, 1);
            }
        }

        const counts = this.countFluids();
        const fmt = (ms: number): string => ms.toFixed(2) + 'ms';
        this.stats.update({
            brush: this.brushRadius,
            tool: this.activeFluid.name,
            sim: fmt(tSim - t0),
            phys: fmt(tPhysFlush - tSim),
            paint: fmt(tRepaint - tPhysFlush),
            box2d: fmt(tBox2D - tRepaint),
            active: this.terrain.bitmap.activeCells.size,
            sand: counts.sand,
            settled: counts.settledSand,
            water: counts.water,
            oil: counts.oil,
            gas: counts.gas,
            fire: counts.fire,
            napalm: counts.napalm,
            balls: this.balls.length,
        });
    }

    private spawnBall(sceneX: number, sceneY: number): void {
        const result = b2.CreateCircle({
            worldId: this.worldId,
            type: b2.DYNAMIC,
            position: new b2.b2Vec2(
                sceneX / PIXELS_PER_METER,
                -sceneY / PIXELS_PER_METER,
            ),
            radius: BALL_RADIUS_PX / PIXELS_PER_METER,
            density: 1,
            friction: 0.5,
            restitution: 0.25,
        });
        const image = this.add.image(sceneX, sceneY, 'ball').setDepth(50);
        this.balls.push({ bodyId: result.bodyId, image });
    }

    private clearBalls(): void {
        for (const ball of this.balls) {
            b2.b2DestroyBody(ball.bodyId);
            ball.image.destroy();
        }
        this.balls.length = 0;
    }

    // @snippet paint-into-air
    // @title Paint a fluid into air cells only
    // @desc `terrain.deposit.circle` overwrites whatever was
    // @desc there. For a sand/water "paint brush" you usually
    // @desc want to spawn only into air, leaving stone walls
    // @desc and existing fluid alone. This walks the brush
    // @desc footprint and writes per cell.
    // @desc
    // @desc Fluid (water / oil / gas) cells are seeded at mass
    // @desc 0.5 via `setMass` rather than the default `setPixel`
    // @desc mass=1.0. A burst of paint at mass 1.0 puts more
    // @desc mass on top of a saturated pool than one tick of
    // @desc lateral spread can dispose of, triggering the
    // @desc compression-overflow-up rule and producing a visible
    // @desc vertical pile at the brush's centroid. Half-mass
    // @desc cells render identically (≥ MIN_MASS) but settle
    // @desc into existing pools without the spike. Sand / fire
    // @desc / wood are binary so still go through `setPixel`.
    private spawnBrushAt(sceneX: number, sceneY: number, materialId: number): void {
        const bm = this.terrain.bitmap;
        const cx = sceneX - this.terrainOriginX;
        const cy = sceneY - this.terrainOriginY;
        const r = this.brushRadius;
        const r2 = r * r;
        const x0 = Math.max(0, Math.floor(cx - r));
        const y0 = Math.max(0, Math.floor(cy - r));
        const x1 = Math.min(WIDTH - 1, Math.ceil(cx + r));
        const y1 = Math.min(HEIGHT - 1, Math.ceil(cy + r));
        const sim = bm.materials.get(materialId)?.simulation;
        const isFluid = sim === 'water' || sim === 'oil' || sim === 'gas';
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x - cx;
                const dy = y - cy;
                if (dx * dx + dy * dy > r2) continue;
                if (bm.getPixel(x, y) !== 0) continue;
                // For fluid brushes, walk the brush cell downward
                // through the air column to the first supported cell
                // (water or static directly below) and drop most of
                // the mass there. ALSO leave a small visual mass at
                // the brush position so the user can see the pour
                // in flight. The visual cell cascades downward
                // through subsequent ticks via the normal vertical
                // step; with v3.1.12's anchor check it doesn't leak
                // laterally.
                if (isFluid) {
                    let py = y;
                    while (py + 1 < HEIGHT && bm.getPixel(x, py + 1) === 0) {
                        py += 1;
                    }
                    if (bm.getPixel(x, py) !== 0) continue;
                    bm.setMass(x, py, 0.5, materialId);
                    if (py !== y) {
                        bm.setMass(x, y, 0.1, materialId);
                    }
                } else {
                    bm.setPixel(x, y, materialId);
                }
            }
        }
    }
    // @endsnippet

    private dumpFluid(): void {
        const bm = this.terrain.bitmap;
        // Drop a 64×8 patch of the active fluid near the top-center.
        const id = this.activeFluid.id;
        const x0 = Math.floor((WIDTH - 64) / 2);
        const y0 = 4;
        for (let y = y0; y < y0 + 8; y++) {
            for (let x = x0; x < x0 + 64; x++) {
                if (bm.getPixel(x, y) === 0) bm.setPixel(x, y, id);
            }
        }
    }

    /**
     * U-shaped funnel of stone with a flat floor at the bottom. Carve
     * a hole through the floor and the sand drains out.
     */
    private regenerateTerrain(): void {
        this.clearBalls();
        const bm = this.terrain.bitmap;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) bm.setPixel(x, y, 0);
        }
        // Side walls — angled inward toward the center so sand piles
        // form a wedge.
        for (let y = 40; y < HEIGHT - 16; y++) {
            const inset = Math.floor((y - 40) * 0.4);
            for (let x = 0; x < 80 - inset; x++) bm.setPixel(x, y, STONE.id);
            for (let x = WIDTH - (80 - inset); x < WIDTH; x++) bm.setPixel(x, y, STONE.id);
        }
        // Floor — full width, 16 px thick at the bottom.
        for (let y = HEIGHT - 16; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) bm.setPixel(x, y, STONE.id);
        }
        // Wood plank sitting on the floor. Switch to fire (key 5),
        // click an air cell adjacent to the plank, and watch it
        // burn — flame walks the wood and consumes it to air.
        const plankY0 = HEIGHT - 22;
        const plankX0 = Math.floor(WIDTH / 2) - 30;
        for (let y = plankY0; y < HEIGHT - 16; y++) {
            for (let x = plankX0; x < plankX0 + 60; x++) bm.setPixel(x, y, WOOD.id);
        }
    }

    private countFluids(): {
        sand: number;
        water: number;
        settledSand: number;
        oil: number;
        gas: number;
        fire: number;
        napalm: number;
    } {
        // Cheap visual stat — iterate the bitmap each frame. For
        // larger worlds this would be tracked via a deposit/remove
        // counter; the 512×256 demo bitmap iterates in well under a
        // millisecond.
        const bm = this.terrain.bitmap;
        let sand = 0;
        let water = 0;
        let settledSand = 0;
        let oil = 0;
        let gas = 0;
        let fire = 0;
        let napalm = 0;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const id = bm.getPixel(x, y);
                if (id === SAND.id) sand++;
                else if (id === WATER.id) water++;
                else if (id === SETTLED_SAND.id) settledSand++;
                else if (id === OIL.id) oil++;
                else if (id === GAS.id) gas++;
                else if (id === FIRE.id) fire++;
                else if (id === NAPALM.id) napalm++;
            }
        }
        return { sand, water, settledSand, oil, gas, fire, napalm };
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: FallingSandScene,
});

mountCodePanel(demoSource);
