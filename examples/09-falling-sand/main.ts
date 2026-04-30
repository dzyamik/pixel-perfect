/**
 * Demo 09 — falling sand + water.
 *
 * v2's cellular-automaton step in action. Two fluid kinds coexist:
 *
 *  - **sand** falls straight down or slides diagonally; piles like
 *    granular media. Sinks through water on straight-down moves
 *    (density: sand > water).
 *  - **water** falls down → diagonal-down → spreads horizontally, so
 *    a pool levels off over many ticks. Less dense than sand: doesn't
 *    move into sand cells.
 *
 *   left mouse  → spawn the active fluid at the cursor (drag)
 *   right mouse → carve the static stone terrain
 *   wheel       → resize brush
 *   1 / 2       → switch the active fluid (sand / water)
 *   space       → drop a one-shot patch of the active fluid at the top
 *   R           → reset terrain + clear all fluid
 *
 * Three materials registered:
 *
 *  - **stone** (`simulation: 'static'`) — generates Box2D colliders,
 *    carved by right-click. Forms the U-shaped funnel and the floor.
 *  - **sand** (`simulation: 'sand'`).
 *  - **water** (`simulation: 'water'`).
 *
 * `autoSimulate: true` on the terrain config means the plugin's
 * `terrain.update()` runs one sim tick before the renderer/physics
 * flush each frame.
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
    color: 0xd4b06a,
    density: 1,
    friction: 0.5,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'sand',
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

class FallingSandScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private terrainOriginX = 0;
    private terrainOriginY = 0;

    private cursor!: Phaser.GameObjects.Graphics;
    private brushRadius = 3;
    private activeFluid: Material = SAND;
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
            materials: [STONE, SAND, WATER],
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

        this.stats = attachStats(this);
        showHint(
            this,
            'left = active fluid · right = carve · 1/2 = sand/water · space = dump · R = reset',
            7000,
        );
    }

    override update(): void {
        // Auto-sim runs in terrain.update() (called by the plugin on
        // POST_UPDATE). Nothing to do here for the simulation; just
        // keep stats fresh.
        const counts = this.countFluids();
        this.stats.update({
            brush: this.brushRadius,
            tool: this.activeFluid.name,
            sand: counts.sand,
            water: counts.water,
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

    private countFluids(): { sand: number; water: number } {
        // Cheap visual stat — iterate the bitmap each frame. For
        // larger worlds this would be tracked via a deposit/remove
        // counter; the 512×256 demo bitmap iterates in well under a
        // millisecond.
        const bm = this.terrain.bitmap;
        let sand = 0;
        let water = 0;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                const id = bm.getPixel(x, y);
                if (id === SAND.id) sand++;
                else if (id === WATER.id) water++;
            }
        }
        return { sand, water };
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: FallingSandScene,
});
