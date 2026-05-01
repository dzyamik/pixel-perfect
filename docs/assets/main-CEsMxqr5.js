const n=`/**
 * Demo 04 — falling debris.
 *
 * Carve through anchored terrain to detach pieces; detached pieces
 * become dynamic Box2D bodies and fall under gravity.
 *
 *   left mouse  → carve (continuous on drag)
 *   right mouse → deposit dirt
 *   wheel       → resize brush
 *   D           → toggle collider debug overlay
 *   R           → reset terrain + clear all debris
 *
 * Initial state: a wide flat ground anchored to the bottom row, plus
 * three "shelves" attached to it via thin necks. There is also one
 * pre-floating brick at the top — it is detached from frame 1, so it
 * should fall immediately on load (this proves the
 * detect → enqueue → body creation pipeline runs even without a
 * user-initiated carve).
 *
 * \`extractDebris\` runs every frame, so as soon as a carve severs a
 * neck the attached shelf detaches in the same frame.
 *
 * Visual check:
 *  - On load, the floating brick at top falls onto the ground.
 *  - Carve through one of the necks. The shelf above detaches and
 *    falls as a single rigid piece.
 *  - The detached piece's outline (rendered as a Phaser Graphics)
 *    rotates naturally under gravity.
 *  - With debug on, the green chain outlines only the static
 *    (anchored) terrain — never the debris.
 */

import * as Phaser from 'phaser';
import * as b2 from 'phaser-box2d/dist/PhaserBox2D.js';
import type {
    Contour,
    DestructibleTerrain,
    Material,
    Point,
} from '../../src/index.js';
import type { BodyId, WorldId } from '../../src/physics/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';
import { mountCodePanel } from '../_shared/code-panel.js';
import demoSource from './main.ts?raw';

const WIDTH = 512;
const HEIGHT = 256;
const CHUNK_SIZE = 64;
const PIXELS_PER_METER = 32;

const DIRT: Material = {
    id: 1,
    name: 'dirt',
    color: 0x8b5a3c,
    density: 1,
    friction: 0.7,
    restitution: 0.1,
    destructible: true,
    destructionResistance: 0,
};

interface Debris {
    bodyId: BodyId;
    /** Phaser Graphics tracing the contour, drawn at the body's position. */
    graphics: Phaser.GameObjects.Graphics;
}

class FallingDebrisScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private worldId!: WorldId;
    private terrainOriginX = 0;
    private terrainOriginY = 0;

    private stats!: ReturnType<typeof attachStats>;
    private cursor!: Phaser.GameObjects.Graphics;
    private debug!: Phaser.GameObjects.Graphics;
    private brushRadius = 8;
    private debugOn = false;

    private readonly debris: Debris[] = [];

    constructor() {
        super('falling-debris');
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x1c2a3b);

        b2.SetWorldScale(PIXELS_PER_METER);
        b2.b2CreateWorldArray();
        const worldDef = b2.b2DefaultWorldDef();
        worldDef.gravity.y = -15;
        this.worldId = b2.b2CreateWorld(worldDef);

        this.terrainOriginX = (this.scale.width - WIDTH) / 2;
        this.terrainOriginY = (this.scale.height - HEIGHT) / 2;

        // @snippet terrain-with-debris-callback
        // @title Hook into automatic debris detection
        // @desc \`onDebrisCreated\` fires once per island the
        // @desc DebrisDetector finds — passing the new dynamic
        // @desc body's id, its contour (in bitmap coords), and
        // @desc the dominant material. Use it to spawn whatever
        // @desc visual you want (Phaser Graphics, Sprite, etc.)
        // @desc and pair it with the body for per-frame transform
        // @desc syncing in update().
        this.terrain = this.pixelPerfect.terrain({
            width: WIDTH,
            height: HEIGHT,
            chunkSize: CHUNK_SIZE,
            x: this.terrainOriginX,
            y: this.terrainOriginY,
            worldId: this.worldId,
            pixelsPerMeter: PIXELS_PER_METER,
            materials: [DIRT],
            onDebrisCreated: ({ bodyId, contour, material }) => {
                this.spawnDebrisVisual(bodyId, contour, material);
            },
        });
        this.regenerateTerrain();
        // @endsnippet

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
                    32,
                );
            },
        );

        this.input.keyboard?.on('keydown-D', () => {
            this.debugOn = !this.debugOn;
            if (!this.debugOn) this.debug.clear();
        });
        this.input.keyboard?.on('keydown-R', () => {
            this.regenerateTerrain();
            this.clearDebris();
        });

        this.stats = attachStats(this);
        showHint(
            this,
            'carve through the necks → shelves detach and fall · D debug · R reset',
            7000,
        );
    }

    override update(_time: number, deltaMs: number): void {
        // Run debris extraction every frame so detachments register the
        // moment a carve severs a connection (no waiting for pointerup).
        // Detect is O(width × height); cheap for our 512×256 bitmap.
        this.extractDebris();

        // IMPORTANT: terrain rebuilds run BEFORE the world step (see the
        // matching comment in demo 03). The step sees fresh static
        // bodies, so balls and debris resting on the terrain don't
        // tunnel through during a destroy/recreate cycle.
        this.terrain.update();

        b2.WorldStep({ worldId: this.worldId, deltaTime: deltaMs / 1000 });

        // Sync each debris's Graphics to its body's position + rotation.
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i]!;
            const pos = b2.b2Body_GetPosition(d.bodyId);
            const rot = b2.b2Body_GetRotation(d.bodyId);
            d.graphics.x = pos.x * PIXELS_PER_METER;
            d.graphics.y = -pos.y * PIXELS_PER_METER;
            d.graphics.rotation = -Math.atan2(rot.s, rot.c);

            // Cull debris that fell off-screen.
            if (d.graphics.y > this.scale.height + 100) {
                b2.b2DestroyBody(d.bodyId);
                d.graphics.destroy();
                this.debris.splice(i, 1);
            }
        }

        if (this.debugOn) this.drawDebug();
        this.stats.update({
            brush: this.brushRadius,
            debris: this.debris.length,
        });
    }

    // @snippet extract-debris-each-frame
    // @title Run debris extraction every frame
    // @desc \`terrain.extractDebris()\` floods the bitmap from
    // @desc anchor cells (bottom row by default), finds any
    // @desc unanchored islands, carves them out of the static
    // @desc bitmap, and queues them as dynamic-body work. The
    // @desc \`onDebrisCreated\` callback fires per body when
    // @desc \`terrain.update()\` flushes the queue. Calling this
    // @desc every frame means severing a neck detaches the
    // @desc shelf in the same frame — no waiting for pointer-up.
    // @desc Cost is O(width × height) per call; cheap for
    // @desc moderate-sized bitmaps.
    private extractDebris(): void {
        const detected = this.terrain.extractDebris();
        if (detected.length > 0) {
            // eslint-disable-next-line no-console
            console.log(
                '[debris]',
                detected.map((info) => ({
                    cells: info.island.cells.length,
                    bounds: info.island.bounds,
                    contours: info.contours.map((c) => ({
                        verts: c.points.length,
                        closed: c.closed,
                    })),
                    materialId: info.dominantMaterial,
                })),
            );
        }
    }
    // @endsnippet

    // @snippet contour-graphics-from-debris
    // @title Render a debris contour as a rotatable Graphics
    // @desc The contour is in bitmap coords; the body's scene
    // @desc position is \`(centroid + originPx)\`. To rotate the
    // @desc Graphics around the body's center of mass, draw the
    // @desc contour points MINUS the centroid (i.e. as local
    // @desc coordinates) and let Phaser handle the per-frame
    // @desc transform from \`b2Body_GetPosition / GetRotation\`.
    private spawnDebrisVisual(
        bodyId: BodyId,
        contour: Contour,
        material: Material,
    ): void {
        let sumX = 0;
        let sumY = 0;
        for (const p of contour.points) {
            sumX += p.x;
            sumY += p.y;
        }
        const cx = sumX / contour.points.length;
        const cy = sumY / contour.points.length;

        const localPoints: Point[] = contour.points.map((p) => ({
            x: p.x - cx,
            y: p.y - cy,
        }));

        const g = this.add.graphics().setDepth(50);
        g.fillStyle(material.color, 1);
        g.lineStyle(1, 0xffffff, 0.5);
        g.beginPath();
        const first = localPoints[0]!;
        g.moveTo(first.x, first.y);
        for (let i = 1; i < localPoints.length; i++) {
            g.lineTo(localPoints[i]!.x, localPoints[i]!.y);
        }
        g.closePath();
        g.fillPath();
        g.strokePath();

        // eslint-disable-next-line no-console
        console.log(
            '[body]',
            'verts:',
            contour.points.length,
            'centroid:',
            { x: cx, y: cy },
            'closed:',
            contour.closed,
        );

        this.debris.push({ bodyId, graphics: g });
    }
    // @endsnippet

    private clearDebris(): void {
        for (const d of this.debris) {
            b2.b2DestroyBody(d.bodyId);
            d.graphics.destroy();
        }
        this.debris.length = 0;
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

    /**
     * Builds: an anchored ground, three neck-supported shelves, plus
     * one floating brick at the top that is detached from frame 1.
     * The floating brick is the no-carve test of the debris pipeline —
     * it should fall on first update().
     */
    private regenerateTerrain(): void {
        const bm = this.terrain.bitmap;
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                bm.setPixel(x, y, 0);
            }
        }
        // Anchored ground (bottom 24 px).
        for (let x = 0; x < WIDTH; x++) {
            for (let y = HEIGHT - 24; y < HEIGHT; y++) {
                bm.setPixel(x, y, 1);
            }
        }
        // Three shelves with thin neck supports.
        const shelves = [
            { x: 60, neckW: 4, neckH: 60, shelfW: 100, shelfH: 16 },
            { x: 220, neckW: 4, neckH: 100, shelfW: 120, shelfH: 16 },
            { x: 380, neckW: 4, neckH: 80, shelfW: 100, shelfH: 16 },
        ];
        for (const s of shelves) {
            const neckX = s.x + s.shelfW / 2 - s.neckW / 2;
            const neckYTop = HEIGHT - 24 - s.neckH;
            for (let yy = neckYTop; yy < HEIGHT - 24; yy++) {
                for (let xx = neckX; xx < neckX + s.neckW; xx++) {
                    bm.setPixel(xx, yy, 1);
                }
            }
            const shelfY = neckYTop - s.shelfH;
            for (let yy = shelfY; yy < neckYTop; yy++) {
                for (let xx = s.x; xx < s.x + s.shelfW; xx++) {
                    bm.setPixel(xx, yy, 1);
                }
            }
        }
        // Floating brick (no support — detached from frame 1).
        for (let yy = 20; yy < 36; yy++) {
            for (let xx = 240; xx < 280; xx++) {
                bm.setPixel(xx, yy, 1);
            }
        }
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: FallingDebrisScene,
});

mountCodePanel(demoSource);
`;export{n as d};
