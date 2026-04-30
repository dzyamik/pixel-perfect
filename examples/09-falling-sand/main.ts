/**
 * Demo 09 — falling sand + water + settled-sand piles + Box2D ball.
 *
 * v2's cellular-automaton step in action, with v2.2's bridge between
 * fluid sim and physics: a sand grain that's been at rest for 30
 * ticks (~0.5 s at 60 fps) gets promoted to a `'static'`-simulation
 * variant ("settled sand") that joins the static collider mesh, so
 * the pile starts supporting dynamic bodies.
 *
 *  - **sand** falls / slides; sinks through water (density swap on
 *    straight-down moves). Settles after 30 stationary ticks.
 *  - **settled sand** is the static promotion target — slightly
 *    darker tone, generates Box2D colliders. Carve to clear.
 *  - **water** falls / spreads horizontally — pools level off.
 *  - **stone** is plain static terrain (the funnel + floor).
 *
 *   left mouse  → spawn the active fluid at the cursor (drag)
 *   right mouse → carve any static cell (stone or settled sand)
 *   wheel       → resize brush
 *   1 / 2       → switch active fluid (sand / water)
 *   space       → one-shot patch of the active fluid at the top
 *   B           → drop a debris ball — watch it land on settled-sand piles
 *   R           → reset terrain + clear everything
 *
 * `autoSimulate: true` runs one sim tick at the start of every
 * `terrain.update()`. Box2D physics is wired in as well, so the
 * ball drop demonstrates the sim → physics bridge: pour sand into
 * the funnel, wait for it to settle, drop a ball, watch it roll
 * on the pile.
 */

import * as Phaser from 'phaser';
import * as b2 from 'phaser-box2d/dist/PhaserBox2D.js';
import type { DestructibleTerrain, Material } from '../../src/index.js';
import type { BodyId, WorldId } from '../../src/physics/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';

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

const SETTLED_SAND: Material = {
    id: 4,
    name: 'settled-sand',
    // Slightly darker / desaturated tone vs SAND so the user sees
    // grains "lock in" as they settle.
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
    // Sand at rest for half a second at 60 fps becomes part of the
    // static collider mesh — debris bodies can stand on the pile.
    settlesTo: SETTLED_SAND.id,
    settleAfterTicks: 30,
};

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
};

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

        this.terrain = this.pixelPerfect.terrain({
            width: WIDTH,
            height: HEIGHT,
            chunkSize: CHUNK_SIZE,
            x: this.terrainOriginX,
            y: this.terrainOriginY,
            worldId: this.worldId,
            pixelsPerMeter: PIXELS_PER_METER,
            materials: [STONE, SAND, WATER, SETTLED_SAND],
            autoSimulate: true,
        });
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
        this.input.keyboard?.on('keydown-ONE', () => {
            this.activeFluid = SAND;
        });
        this.input.keyboard?.on('keydown-TWO', () => {
            this.activeFluid = WATER;
        });
        this.input.keyboard?.on('keydown-B', () => {
            const p = this.input.activePointer;
            this.spawnBall(p.worldX, p.worldY);
        });

        this.stats = attachStats(this);
        showHint(
            this,
            'L: fluid · R-click: carve · 1/2: sand/water · space: dump · B: ball · R: reset',
            7000,
        );
    }

    override update(_time: number, deltaMs: number): void {
        // Same pattern as demos 03/04/06: rebuild terrain (which
        // includes the auto-simulate sand/water tick AND any chunk
        // promotions to settled-sand) before the physics step, so
        // the step sees the freshest collider mesh.
        this.terrain.update();

        b2.WorldStep({ worldId: this.worldId, deltaTime: deltaMs / 1000 });

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
        this.stats.update({
            brush: this.brushRadius,
            tool: this.activeFluid.name,
            sand: counts.sand,
            settled: counts.settledSand,
            water: counts.water,
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

    /**
     * Sets every air cell within `brushRadius` of `(sceneX, sceneY)`
     * to `materialId`. We can't use `terrain.deposit.circle` directly
     * because that overwrites whatever was there (including stone
     * walls); we want sand to spawn ONLY into air pockets.
     */
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
        for (let y = y0; y <= y1; y++) {
            for (let x = x0; x <= x1; x++) {
                const dx = x - cx;
                const dy = y - cy;
                if (dx * dx + dy * dy > r2) continue;
                if (bm.getPixel(x, y) === 0) bm.setPixel(x, y, materialId);
            }
        }
    }

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
    }

    private countFluids(): { sand: number; water: number; settledSand: number } {
        // Cheap visual stat — iterate the bitmap each frame. For
        // larger worlds this would be tracked via a deposit/remove
        // counter; the 512×256 demo bitmap iterates in well under a
        // millisecond.
        const bm = this.terrain.bitmap;
        let sand = 0;
        let water = 0;
        let settledSand = 0;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const id = bm.getPixel(x, y);
                if (id === SAND.id) sand++;
                else if (id === WATER.id) water++;
                else if (id === SETTLED_SAND.id) settledSand++;
            }
        }
        return { sand, water, settledSand };
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: FallingSandScene,
});
