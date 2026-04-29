/**
 * Demo 03 — physics integration.
 *
 * Wires Box2D into the terrain. Carving the bitmap rebuilds the chunk
 * colliders end-of-frame; a dropped ball lands on whatever shape the
 * terrain has at the moment of impact.
 *
 *   left mouse  → carve (continuous on drag)
 *   right mouse → deposit dirt
 *   wheel       → resize brush
 *   space       → spawn a ball at the cursor
 *   D           → toggle collider debug overlay
 *   R           → reset terrain + clear all balls
 *
 * Visual check:
 *  - The ball falls under gravity and lands on the terrain.
 *  - Carving below a resting ball drops it through.
 *  - Carving across a chunk boundary doesn't leak the ball through
 *    a "seam" (this is what Phase 2.5 cross-chunk stitching fixed).
 *  - With debug overlay on (D), you should see green lines tracing the
 *    contour wrapping each connected solid blob.
 */

import * as Phaser from 'phaser';
import * as b2 from 'phaser-box2d/dist/PhaserBox2D.js';
import { DestructibleTerrain } from '../../src/index.js';
import type { WorldId } from '../../src/physics/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';

const WIDTH = 512;
const HEIGHT = 256;
const CHUNK_SIZE = 64;
const PIXELS_PER_METER = 32;

const MATERIALS = [
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
];

interface Ball {
    bodyId: unknown;
    image: Phaser.GameObjects.Image;
}

class PhysicsScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private worldId!: WorldId;
    private terrainOriginX = 0;
    private terrainOriginY = 0;

    private stats!: ReturnType<typeof attachStats>;
    private cursor!: Phaser.GameObjects.Graphics;
    private debug!: Phaser.GameObjects.Graphics;
    private brushRadius = 16;
    private debugOn = true;

    private readonly balls: Ball[] = [];

    constructor() {
        super('physics');
    }

    preload(): void {
        // Generate a simple white-circle ball texture.
        const g = this.make.graphics({}, false);
        g.fillStyle(0xffe680, 1);
        g.fillCircle(8, 8, 8);
        g.lineStyle(1, 0x000000, 0.5);
        g.strokeCircle(8, 8, 8);
        g.generateTexture('ball', 16, 16);
        g.destroy();
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x1c2a3b);

        // Phaser-box2d: configure scale + create a world. The world
        // pool initializer is idempotent across hot reloads.
        b2.SetWorldScale(PIXELS_PER_METER);
        b2.b2CreateWorldArray();
        const worldDef = b2.b2DefaultWorldDef();
        worldDef.gravity.y = -15; // Box2D y-up: negative = downward in screen
        this.worldId = b2.b2CreateWorld(worldDef);

        this.terrainOriginX = (this.scale.width - WIDTH) / 2;
        this.terrainOriginY = (this.scale.height - HEIGHT) / 2;

        this.terrain = new DestructibleTerrain({
            scene: this,
            width: WIDTH,
            height: HEIGHT,
            chunkSize: CHUNK_SIZE,
            x: this.terrainOriginX,
            y: this.terrainOriginY,
            worldId: this.worldId,
            pixelsPerMeter: PIXELS_PER_METER,
            materials: MATERIALS,
        });
        this.regenerateTerrain();

        // Visual layers: cursor preview on top, debug below cursor.
        this.debug = this.add.graphics().setDepth(9990);
        this.cursor = this.add.graphics().setDepth(9999);

        this.input.mouse?.disableContextMenu();

        const carveOrDeposit = (pointer: Phaser.Input.Pointer) => {
            if (pointer.leftButtonDown()) {
                this.terrain.carve.circle(pointer.worldX, pointer.worldY, this.brushRadius);
            } else if (pointer.rightButtonDown()) {
                this.terrain.deposit.circle(
                    pointer.worldX,
                    pointer.worldY,
                    this.brushRadius,
                    1,
                );
            }
        };
        this.input.on('pointerdown', carveOrDeposit);
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            this.cursor.clear();
            this.cursor.lineStyle(1, 0xffffff, 0.65);
            this.cursor.strokeCircle(pointer.worldX, pointer.worldY, this.brushRadius);
            carveOrDeposit(pointer);
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
                    this.brushRadius + (deltaY < 0 ? 2 : -2),
                    4,
                    64,
                );
            },
        );

        this.input.keyboard?.on('keydown-SPACE', () => {
            const p = this.input.activePointer;
            this.spawnBall(p.worldX, p.worldY);
        });
        this.input.keyboard?.on('keydown-D', () => {
            this.debugOn = !this.debugOn;
            if (!this.debugOn) this.debug.clear();
        });
        this.input.keyboard?.on('keydown-R', () => {
            this.regenerateTerrain();
            this.clearBalls();
        });

        this.stats = attachStats(this);
        showHint(
            this,
            'left/right click carves & deposits · space spawns balls · D toggles debug · R resets',
            7000,
        );

        // Start with a few balls so the demo shows physics from frame 1.
        this.spawnBall(this.terrainOriginX + 100, this.terrainOriginY + 30);
        this.spawnBall(this.terrainOriginX + 250, this.terrainOriginY + 30);
        this.spawnBall(this.terrainOriginX + 400, this.terrainOriginY + 30);
    }

    override update(_time: number, deltaMs: number): void {
        // Step the world. Phaser-box2d's WorldStep auto-amortizes, so
        // pass deltaMs/1000 directly.
        b2.WorldStep({ worldId: this.worldId, deltaTime: deltaMs / 1000 });

        // Sync ball sprite transforms with their bodies.
        for (const ball of this.balls) {
            const pos = b2.b2Body_GetPosition(ball.bodyId);
            const rot = b2.b2Body_GetRotation(ball.bodyId);
            ball.image.x = pos.x * PIXELS_PER_METER;
            ball.image.y = -pos.y * PIXELS_PER_METER; // y-flip: Box2D y-up → screen y-down
            ball.image.rotation = -Math.atan2(rot.s, rot.c);
        }

        // Flush queue + repaint chunks.
        this.terrain.update();

        if (this.debugOn) this.drawDebug();
        this.stats.update({
            balls: this.balls.length,
            brush: this.brushRadius,
        });
    }

    private drawDebug(): void {
        this.debug.clear();
        this.debug.lineStyle(1, 0x4ec9b0, 0.85);

        for (const chunk of this.terrain.bitmap.chunks) {
            if (chunk.contours === null) continue;
            for (const contour of chunk.contours) {
                if (contour.points.length < 2) continue;
                this.debug.beginPath();
                const first = contour.points[0]!;
                this.debug.moveTo(
                    first.x + this.terrainOriginX,
                    first.y + this.terrainOriginY,
                );
                for (let i = 1; i < contour.points.length; i++) {
                    const p = contour.points[i]!;
                    this.debug.lineTo(p.x + this.terrainOriginX, p.y + this.terrainOriginY);
                }
                if (contour.closed) this.debug.closePath();
                this.debug.strokePath();
            }
        }
    }

    private spawnBall(x: number, y: number): void {
        // Box2D position: pixels → meters with y-flip.
        const result = b2.CreateCircle({
            worldId: this.worldId,
            type: b2.DYNAMIC,
            position: new b2.b2Vec2(x / PIXELS_PER_METER, -y / PIXELS_PER_METER),
            radius: 8 / PIXELS_PER_METER,
            density: 1,
            friction: 0.4,
            restitution: 0.3,
        });
        const image = this.add.image(x, y, 'ball').setDepth(50);
        this.balls.push({ bodyId: result.bodyId, image });
    }

    private clearBalls(): void {
        for (const ball of this.balls) {
            b2.b2DestroyBody(ball.bodyId);
            ball.image.destroy();
        }
        this.balls.length = 0;
    }

    private regenerateTerrain(): void {
        const bm = this.terrain.bitmap;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                bm.setPixel(x, y, 0);
            }
        }
        const ground = (x: number) =>
            Math.floor(HEIGHT * 0.5 + Math.sin((x / WIDTH) * Math.PI * 4) * 24);
        for (let x = 0; x < WIDTH; x++) {
            const surfaceY = ground(x);
            for (let y = surfaceY; y < HEIGHT; y++) {
                bm.setPixel(x, y, y - surfaceY < 8 ? 1 : 2);
            }
        }
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: PhysicsScene,
});
