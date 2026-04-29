/**
 * Demo 01 — basic rendering.
 *
 * What it exercises:
 *  - Phaser layer can boot a scene.
 *  - DestructibleTerrain renders a `ChunkedBitmap` to canvas-backed
 *    Phaser game objects.
 *  - Visual repaint of `visualDirty` chunks happens each frame.
 *
 * What it doesn't do (yet): no interaction, no physics, no debris.
 * Subsequent demos add those one feature at a time.
 *
 * Visual check: you should see a procedurally-generated terrain with
 * a sky-blue background and a rolling hill of dirt/stone. No physics,
 * just pixels.
 */

import * as Phaser from 'phaser';
import { DestructibleTerrain, Deposit } from '../../src/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';

const WIDTH = 512;
const HEIGHT = 256;
const CHUNK_SIZE = 64;

class BasicRenderingScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private stats!: ReturnType<typeof attachStats>;

    constructor() {
        super('basic-rendering');
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x1c2a3b);

        this.terrain = new DestructibleTerrain({
            scene: this,
            width: WIDTH,
            height: HEIGHT,
            chunkSize: CHUNK_SIZE,
            x: (this.scale.width - WIDTH) / 2,
            y: (this.scale.height - HEIGHT) / 2,
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
                {
                    id: 2,
                    name: 'stone',
                    color: 0x556070,
                    density: 2.5,
                    friction: 0.9,
                    restitution: 0.05,
                    destructible: true,
                    destructionResistance: 0.5,
                },
            ],
        });

        // Procedural terrain: a sinewave hill, dirt above, stone below.
        const ground = (x: number) =>
            Math.floor(HEIGHT * 0.5 + Math.sin((x / WIDTH) * Math.PI * 4) * 24);

        for (let x = 0; x < WIDTH; x++) {
            const surfaceY = ground(x);
            for (let y = surfaceY; y < HEIGHT; y++) {
                const id = y - surfaceY < 8 ? 1 : 2; // 8px topsoil, then stone
                this.terrain.bitmap.setPixel(x, y, id);
            }
        }

        // Carve a couple of caves so we see varied geometry.
        Deposit.circle(this.terrain.bitmap, 120, 200, 18, 0); // air pocket
        Deposit.circle(this.terrain.bitmap, 380, 220, 12, 0);

        this.stats = attachStats(this);
        showHint(this, 'demo 01 — procedural terrain rendering');
    }

    override update(): void {
        this.terrain.update();
        this.stats.update({
            chunks: this.terrain.bitmap.chunks.length,
        });
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: BasicRenderingScene,
});
