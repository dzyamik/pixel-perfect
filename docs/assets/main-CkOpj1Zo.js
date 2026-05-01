const e=`/**
 * Demo 07 — image-based terrain.
 *
 * Demonstrates the "PNG mask in, destructible terrain out" pipeline:
 *
 *   1. preload(): draw an irregular island onto an HTMLCanvasElement
 *      and register it as a Phaser texture. (Self-contained demo,
 *      no asset files committed. In your game you'd
 *      \`this.load.image('island', 'assets/island.png')\` and the rest
 *      of the demo is identical — see the comment in \`stampSource\`.)
 *   2. create(): grab the texture's source canvas, read its alpha via
 *      \`getImageData\`, and stamp it onto the bitmap with
 *      \`terrain.deposit.fromAlphaTexture(...)\`. The same \`AlphaSource\`
 *      shape (\`{ data, width, height }\`) that core uses for carve
 *      operations is exactly what \`getImageData\` returns.
 *   3. The user can carve the resulting terrain — proves the bitmap
 *      built from the image behaves like any other terrain.
 *
 *   left mouse  → carve
 *   right mouse → re-deposit dirt
 *   wheel       → resize brush
 *   R           → reset (re-stamp the source image)
 *
 * The top-left of the screen shows the source image preview alongside
 * the live terrain so you can see the input and the result side by
 * side.
 */

import * as Phaser from 'phaser';
import type { DestructibleTerrain, Material } from '../../src/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';
import { mountCodePanel } from '../_shared/code-panel.js';
import demoSource from './main.ts?raw';

const SOURCE_W = 256;
const SOURCE_H = 192;
const BITMAP_W = 512;
const BITMAP_H = 256;
const CHUNK_SIZE = 64;
const SOURCE_TEXTURE_KEY = 'island-source';

const SAND: Material = {
    id: 1,
    name: 'sand',
    color: 0xd4b06a,
    density: 1,
    friction: 0.7,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
};

const DIRT: Material = {
    id: 2,
    name: 'dirt',
    color: 0x8b5a3c,
    density: 1,
    friction: 0.7,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
};

class ImageTerrainScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private terrainOriginX = 0;
    private terrainOriginY = 0;

    private cursor!: Phaser.GameObjects.Graphics;
    private brushRadius = 12;
    private stats!: ReturnType<typeof attachStats>;

    constructor() {
        super('image-terrain');
    }

    preload(): void {
        // Build the source image procedurally. In your game this
        // would be \`this.load.image('island', 'assets/island.png')\`;
        // everything from \`create()\` onwards is identical.
        const canvas = document.createElement('canvas');
        canvas.width = SOURCE_W;
        canvas.height = SOURCE_H;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;

        // Translucent background so we can see the alpha cut clearly.
        // (Not strictly required — the deposit op only reads alpha.)
        ctx.clearRect(0, 0, SOURCE_W, SOURCE_H);

        // Body: an irregular blob assembled from a few overlapping
        // ellipses + a tree silhouette so the result has interesting
        // contours when carved.
        ctx.fillStyle = '#d4b06a';
        ctx.beginPath();
        ctx.ellipse(SOURCE_W / 2, SOURCE_H * 0.62, SOURCE_W * 0.42, SOURCE_H * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        // Small extra mound on the right.
        ctx.beginPath();
        ctx.ellipse(SOURCE_W * 0.78, SOURCE_H * 0.5, 32, 22, -0.3, 0, Math.PI * 2);
        ctx.fill();
        // A "shore bump" on the left.
        ctx.beginPath();
        ctx.ellipse(SOURCE_W * 0.18, SOURCE_H * 0.55, 28, 18, 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Dirt cap in a darker color above the sand body.
        ctx.fillStyle = '#8b5a3c';
        ctx.beginPath();
        ctx.ellipse(SOURCE_W / 2, SOURCE_H * 0.5, SOURCE_W * 0.32, SOURCE_H * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();

        // Tree silhouettes (just for visual interest in the source —
        // the bitmap will see them as solid alpha and will keep them).
        const tree = (cx: number, cy: number) => {
            ctx.fillStyle = '#5a3a22';
            ctx.fillRect(cx - 1.5, cy, 3, 8);
            ctx.fillStyle = '#3a6a3a';
            ctx.beginPath();
            ctx.arc(cx, cy - 4, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx - 4, cy, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(cx + 4, cy, 5, 0, Math.PI * 2);
            ctx.fill();
        };
        tree(SOURCE_W / 2, SOURCE_H * 0.4);
        tree(SOURCE_W * 0.66, SOURCE_H * 0.42);
        tree(SOURCE_W * 0.36, SOURCE_H * 0.43);

        this.textures.addCanvas(SOURCE_TEXTURE_KEY, canvas);
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x0d2b3e);

        // Place the live terrain centered horizontally, taking up the
        // bottom 2/3 of the scene. The source preview will float in
        // the top-left.
        this.terrainOriginX = (this.scale.width - BITMAP_W) / 2;
        this.terrainOriginY = (this.scale.height - BITMAP_H) / 2 + 40;

        this.terrain = this.pixelPerfect.terrain({
            width: BITMAP_W,
            height: BITMAP_H,
            chunkSize: CHUNK_SIZE,
            x: this.terrainOriginX,
            y: this.terrainOriginY,
            materials: [SAND, DIRT],
        });
        this.stampSource();

        // Source-image preview at top-left so the user can see what
        // shape the bitmap was generated from.
        this.add.image(8, 8, SOURCE_TEXTURE_KEY).setOrigin(0, 0).setDepth(20);
        this.add
            .text(8, SOURCE_H + 14, 'source canvas (PNG-equivalent)', {
                fontSize: '11px',
                fontFamily: 'monospace',
                color: '#8b949e',
            })
            .setDepth(20);

        // Cursor preview.
        this.cursor = this.add.graphics().setDepth(9999);

        // Carve / deposit input.
        this.input.mouse?.disableContextMenu();
        const carveOrDeposit = (pointer: Phaser.Input.Pointer) => {
            if (pointer.leftButtonDown()) {
                this.terrain.carve.circle(pointer.worldX, pointer.worldY, this.brushRadius);
            } else if (pointer.rightButtonDown()) {
                this.terrain.deposit.circle(
                    pointer.worldX,
                    pointer.worldY,
                    this.brushRadius,
                    SAND.id,
                );
            }
        };
        this.input.on('pointerdown', carveOrDeposit);
        this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
            this.cursor.clear();
            this.cursor.lineStyle(1, 0xffffff, 0.6);
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
                    48,
                );
            },
        );

        this.input.keyboard?.on('keydown-R', () => {
            // Re-stamp the source image. Clear the bitmap first so
            // the deposit doesn't union with leftover material.
            const bm = this.terrain.bitmap;
            for (let y = 0; y < BITMAP_H; y++) {
                for (let x = 0; x < BITMAP_W; x++) bm.setPixel(x, y, 0);
            }
            this.stampSource();
        });

        this.stats = attachStats(this);
        showHint(
            this,
            'left/right click to carve / deposit · wheel resizes brush · R re-stamps the source',
            6000,
        );
    }

    override update(): void {
        this.stats.update({ brush: this.brushRadius });
    }

    // @snippet stamp-image-as-terrain
    // @title Stamp a PNG / canvas onto the bitmap
    // @desc One call bridges "image asset" to "destructible
    // @desc terrain": grab the source's \`ImageData\` (via
    // @desc \`getImageData\` for a canvas, or \`this.load.image\` +
    // @desc \`texture.getSourceImage()\` for a PNG) and pass it to
    // @desc \`terrain.deposit.fromAlphaTexture(src, dstX, dstY,
    // @desc materialId, alphaThreshold)\`. Multi-material terrains
    // @desc come for free: stamp the same source twice with
    // @desc different thresholds — lower threshold catches the
    // @desc soft outline, higher threshold catches only the dense
    // @desc core. Coordinates are scene-space; the deposit op
    // @desc subtracts the terrain's origin internally.
    private stampSource(): void {
        const tex = this.textures.get(SOURCE_TEXTURE_KEY);
        const src = tex.getSourceImage() as HTMLCanvasElement;
        const ctx = src.getContext('2d');
        if (ctx === null) return;
        const imageData = ctx.getImageData(0, 0, SOURCE_W, SOURCE_H);

        const dstSceneX = this.terrainOriginX + (BITMAP_W - SOURCE_W) / 2;
        const dstSceneY = this.terrainOriginY + (BITMAP_H - SOURCE_H);

        this.terrain.deposit.fromAlphaTexture(imageData, dstSceneX, dstSceneY, SAND.id, 64);
        this.terrain.deposit.fromAlphaTexture(imageData, dstSceneX, dstSceneY, DIRT.id, 220);
    }
    // @endsnippet
}

bootSandbox({
    width: 720,
    height: 360,
    scene: ImageTerrainScene,
});

mountCodePanel(demoSource);
`;export{e as d};
