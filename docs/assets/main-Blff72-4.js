const n=`/**
 * Demo 02 — click to carve.
 *
 * Adds interactive pointer input on top of demo 01's procedural terrain.
 *
 *   left mouse  → carve a circle of air at the cursor
 *   right mouse → deposit dirt
 *   mouse wheel → resize brush
 *   R key       → regenerate the terrain
 *
 * Visual check:
 *  - Cursor shows a brush-radius outline circle.
 *  - Carving a hole instantly updates the bitmap; the affected chunk
 *    repaints on the next frame (visible as a one-frame texture swap).
 *  - The FPS overlay shows \`repainted N\` rising briefly when you carve,
 *    then settling back to 0 — confirming repaints are demand-driven,
 *    not per-frame.
 */

import * as Phaser from 'phaser';
import { DestructibleTerrain } from '../../src/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';
import { mountCodePanel } from '../_shared/code-panel.js';
import demoSource from './main.ts?raw';

const WIDTH = 512;
const HEIGHT = 256;
const CHUNK_SIZE = 64;

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

class ClickToCarveScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private stats!: ReturnType<typeof attachStats>;
    private cursor!: Phaser.GameObjects.Graphics;
    private brushRadius = 16;
    /** Chunks repainted on the latest update(). Surfaced via stats. */
    private lastRepainted = 0;

    constructor() {
        super('click-to-carve');
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
            materials: MATERIALS,
        });
        this.regenerateTerrain();

        // Brush preview cursor.
        this.cursor = this.add.graphics().setDepth(9999);

        // Disable browser context menu so right-click is usable.
        this.input.mouse?.disableContextMenu();

        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            this.drawCursor(pointer.worldX, pointer.worldY);
        });

        // @snippet carve-deposit-on-click
        // @title Carve / deposit at the cursor
        // @desc Left-click carves a circle of air; right-click
        // @desc deposits a circle of material id 1 ("dirt"). Both
        // @desc are scene-space coordinates — \`pointer.worldX/Y\`
        // @desc accounts for camera transforms. Listen on
        // @desc \`pointerdown\` for one-shot, \`pointermove\` (with a
        // @desc button-down check) for continuous brushing.
        this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
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
        });
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
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
        });
        // @endsnippet

        // @snippet wheel-resize-brush
        // @title Mouse wheel resizes the brush
        // @desc Standard pattern across all the demos. Phaser's
        // @desc \`wheel\` event delivers \`deltaY\` (positive when
        // @desc scrolling down). \`Phaser.Math.Clamp\` keeps the
        // @desc value in a sensible range.
        this.input.on(
            'wheel',
            (
                _pointer: Phaser.Input.Pointer,
                _gameObjects: Phaser.GameObjects.GameObject[],
                _deltaX: number,
                deltaY: number,
            ) => {
                this.brushRadius = Phaser.Math.Clamp(
                    this.brushRadius + (deltaY < 0 ? 2 : -2),
                    4,
                    64,
                );
            },
        );
        // @endsnippet

        this.input.keyboard?.on('keydown-R', () => this.regenerateTerrain());

        this.stats = attachStats(this);
        showHint(
            this,
            'left-click carves · right-click deposits · wheel resizes · R resets',
            6000,
        );
    }

    // @snippet count-chunk-repaints
    // @title Count how many chunks repainted this frame
    // @desc \`terrain.renderer.repaintDirty()\` returns the number
    // @desc of chunks it uploaded a fresh texture for. Useful
    // @desc as a perf signal — if it's nonzero every frame
    // @desc with no input, something is dirtying chunks needlessly.
    // @desc Replaces the convenience \`terrain.update()\` call
    // @desc which discards this number.
    override update(): void {
        this.lastRepainted = this.terrain.renderer.repaintDirty();
        this.stats.update({
            brush: this.brushRadius,
            repainted: this.lastRepainted,
        });
    }
    // @endsnippet

    private drawCursor(worldX: number, worldY: number): void {
        this.cursor.clear();
        this.cursor.lineStyle(1, 0xffffff, 0.65);
        this.cursor.strokeCircle(worldX, worldY, this.brushRadius);
        this.cursor.lineStyle(1, 0x000000, 0.3);
        this.cursor.strokeCircle(worldX, worldY, this.brushRadius + 1);
    }

    private regenerateTerrain(): void {
        const bm = this.terrain.bitmap;
        // Clear everything.
        for (let y = 0; y < HEIGHT; y++) {
            for (let x = 0; x < WIDTH; x++) {
                bm.setPixel(x, y, 0);
            }
        }
        // Procedural ground.
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

// Override DestructibleTerrain.update so this demo can tally repainted
// chunks via terrain.renderer.repaintDirty's return value, instead of
// terrain.update() which discards it. Cleanest: just call repaintDirty
// directly in the scene's update loop.
bootSandbox({
    width: 720,
    height: 360,
    scene: ClickToCarveScene,
});

mountCodePanel(demoSource);
`;export{n as d};
