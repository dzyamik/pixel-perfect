/**
 * Demo 09 — falling sand.
 *
 * v2.0's headline feature: a cellular-automaton step over the bitmap
 * that moves materials with `simulation: 'sand'` under gravity each
 * tick. Sand cells:
 *
 *   - Fall straight down when the cell below is air.
 *   - Slide diagonally when blocked by a non-air cell, alternating
 *     L/R preference per tick to avoid pile bias.
 *   - Stop when neither below nor diagonal-below is air.
 *
 *   left mouse  → spawn sand at the cursor (continuous on drag)
 *   right mouse → carve the static rock terrain
 *   wheel       → resize brush
 *   space       → drop a one-shot dump of sand at the top center
 *   R           → reset terrain + clear all sand
 *
 * Two materials are registered:
 *
 *   - **stone** with `simulation: 'static'` — generates Box2D colliders
 *     and is carved by right-click. Forms the U-shaped funnel and the
 *     overall world floor.
 *   - **sand** with `simulation: 'sand'` — falls under the cellular-
 *     automaton step. Does NOT generate Box2D colliders (the collider
 *     extraction filters to static materials only), so the per-frame
 *     sand motion doesn't trigger physics rebuilds.
 *
 * `autoSimulate: true` on the terrain config means the plugin's
 * `terrain.update()` runs one sim tick before the renderer/physics
 * flush each frame, so the user just spawns sand and watches it
 * settle without wiring anything else.
 */

import * as Phaser from 'phaser';
import type { DestructibleTerrain, Material } from '../../src/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';

const WIDTH = 512;
const HEIGHT = 256;
const CHUNK_SIZE = 64;

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

const SAND: Material = {
    id: 2,
    name: 'sand',
    // Slightly varied tones so the pile reads as "individual grains".
    color: 0xd4b06a,
    density: 1,
    friction: 0.5,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'sand',
};

class FallingSandScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private terrainOriginX = 0;
    private terrainOriginY = 0;

    private cursor!: Phaser.GameObjects.Graphics;
    private brushRadius = 3;
    private stats!: ReturnType<typeof attachStats>;

    constructor() {
        super('falling-sand');
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        this.terrainOriginX = (this.scale.width - WIDTH) / 2;
        this.terrainOriginY = (this.scale.height - HEIGHT) / 2;

        this.terrain = this.pixelPerfect.terrain({
            width: WIDTH,
            height: HEIGHT,
            chunkSize: CHUNK_SIZE,
            x: this.terrainOriginX,
            y: this.terrainOriginY,
            materials: [STONE, SAND],
            autoSimulate: true,
        });
        this.regenerateTerrain();

        this.cursor = this.add.graphics().setDepth(9999);

        this.input.mouse?.disableContextMenu();
        const action = (pointer: Phaser.Input.Pointer) => {
            if (pointer.leftButtonDown()) {
                // Spawn sand inside the brush. Only set cells that are
                // currently air so we don't overwrite stone walls.
                this.spawnBrushAt(pointer.worldX, pointer.worldY, SAND.id);
            } else if (pointer.rightButtonDown()) {
                this.terrain.carve.circle(pointer.worldX, pointer.worldY, this.brushRadius);
            }
        };
        this.input.on('pointerdown', action);
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            this.cursor.clear();
            this.cursor.lineStyle(1, 0xffffff, 0.6);
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
        this.input.keyboard?.on('keydown-SPACE', () => this.dumpSand());
        this.input.keyboard?.on('keydown-R', () => this.regenerateTerrain());

        this.stats = attachStats(this);
        showHint(
            this,
            'left = sand · right = carve stone · wheel = brush size · space = sand dump · R = reset',
            7000,
        );
    }

    override update(): void {
        // Auto-sim runs in terrain.update() (called by the plugin on
        // POST_UPDATE). Nothing to do here for the simulation; just
        // keep stats fresh.
        this.stats.update({
            brush: this.brushRadius,
            sand: this.countSand(),
        });
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

    private dumpSand(): void {
        const bm = this.terrain.bitmap;
        // Drop a 64×8 patch of sand near the top-center.
        const x0 = Math.floor((WIDTH - 64) / 2);
        const y0 = 4;
        for (let y = y0; y < y0 + 8; y++) {
            for (let x = x0; x < x0 + 64; x++) {
                if (bm.getPixel(x, y) === 0) bm.setPixel(x, y, SAND.id);
            }
        }
    }

    /**
     * U-shaped funnel of stone with a flat floor at the bottom. Carve
     * a hole through the floor and the sand drains out.
     */
    private regenerateTerrain(): void {
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

    private countSand(): number {
        // Cheap visual stat — iterate the bitmap each frame and count
        // sand cells. For larger worlds this would be tracked more
        // efficiently (e.g. via a deposit/remove counter); the
        // 512×256 demo bitmap iterates in well under a millisecond.
        const bm = this.terrain.bitmap;
        let count = 0;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                if (bm.getPixel(x, y) === SAND.id) count++;
            }
        }
        return count;
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: FallingSandScene,
});
