/**
 * Demo 05 — pixel-perfect sprite collision.
 *
 * Two sprites with the same square footprint but transparent corners
 * (a circular alpha mask in a square texture). The user drags one
 * sprite around with the mouse.
 *
 * Three overlay rectangles around the dragged sprite show three
 * collision states:
 *   - GRAY: AABBs do not intersect.
 *   - YELLOW: AABBs overlap (the cheap bounding-box test fires) but the
 *     two solid masks do NOT — the cheap test is a false positive.
 *   - GREEN: pixel-perfect overlap — solid pixels of both sprites
 *     coincide somewhere.
 *
 * The dragged sprite also tests against a small destructible-terrain
 * patch in the bottom-left of the scene; the same color logic
 * (gray / yellow / green) shows the sprite-vs-terrain result.
 *
 * What this demonstrates:
 *
 *   - The library's `PixelPerfectSprite` extends `Phaser.GameObjects.Sprite`,
 *     so anything you can do with a regular sprite (depth, tint, scale-1
 *     drag, etc.) keeps working.
 *   - `overlapsPixelPerfect(other)` does an AABB cull + per-pixel alpha
 *     AND. Cost is `O(overlap_area)` only.
 *   - `overlapsTerrain(terrain)` checks the sprite's solid pixels
 *     against the terrain's bitmap directly — no precomputation.
 */

import * as Phaser from 'phaser';
import type { DestructibleTerrain, PixelPerfectSprite } from '../../src/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';

const TEX_SIZE = 64;

class PixelSpriteScene extends Phaser.Scene {
    private dragSprite!: PixelPerfectSprite;
    private targetSprite!: PixelPerfectSprite;
    private terrain!: DestructibleTerrain;
    private bboxRect!: Phaser.GameObjects.Graphics;
    private terrainBboxRect!: Phaser.GameObjects.Graphics;
    private stats!: ReturnType<typeof attachStats>;

    constructor() {
        super('pixel-sprite');
    }

    preload(): void {
        // Two textures: same outer square footprint, different alpha
        // masks inside. Both have the same (TEX_SIZE × TEX_SIZE) box,
        // so AABB tests will fire well before pixel-perfect ones.
        this.makeCircleTexture('mask-circle', 0x6cc4ff);
        this.makeRingTexture('mask-ring', 0xffd56c);
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        // Static target sprite in the upper-right region.
        this.targetSprite = this.pixelPerfect.sprite(540, 160, 'mask-ring');

        // Build a small destructible-terrain patch in the bottom area
        // so we can show sprite-vs-terrain collision too. Width and
        // height must both be multiples of chunkSize.
        const TERRAIN_W = 256;
        const TERRAIN_H = 128;
        const TERRAIN_CHUNK = 64;
        this.terrain = this.pixelPerfect.terrain({
            width: TERRAIN_W,
            height: TERRAIN_H,
            chunkSize: TERRAIN_CHUNK,
            x: 32,
            y: 220,
            materials: [
                {
                    id: 1,
                    name: 'rock',
                    color: 0x556070,
                    density: 1,
                    friction: 0.5,
                    restitution: 0.1,
                    destructible: true,
                    destructionResistance: 0,
                },
            ],
        });
        // Wavy top surface; everything below the surface line is solid
        // rock. The sprite-vs-terrain overlap fires when the dragged
        // sprite's solid pixels cross the surface.
        const bm = this.terrain.bitmap;
        for (let x = 0; x < TERRAIN_W; x++) {
            const surfaceY = Math.floor(60 + Math.sin((x / TERRAIN_W) * Math.PI * 3) * 16);
            for (let y = surfaceY; y < TERRAIN_H; y++) bm.setPixel(x, y, 1);
        }

        // Draggable sprite — the user moves this one.
        this.dragSprite = this.pixelPerfect.sprite(160, 160, 'mask-circle');
        this.dragSprite.setInteractive({ draggable: true });
        this.input.setDraggable(this.dragSprite);
        this.input.on(
            'drag',
            (
                _pointer: Phaser.Input.Pointer,
                obj: Phaser.GameObjects.GameObject,
                x: number,
                y: number,
            ) => {
                if (obj === this.dragSprite) {
                    this.dragSprite.setPosition(x, y);
                }
            },
        );

        // Outline graphics: a rectangle around the dragged sprite that
        // shows the AABB; another around the target to show its AABB,
        // and the third around the terrain region.
        this.bboxRect = this.add.graphics().setDepth(100);
        this.terrainBboxRect = this.add.graphics().setDepth(100);

        this.stats = attachStats(this);
        showHint(
            this,
            'drag the blue circle. yellow = bbox-only overlap, green = pixel-perfect overlap',
            6000,
        );
    }

    override update(): void {
        // sprite-vs-sprite indicator.
        const aabbHit = this.aabbOverlap(this.dragSprite, this.targetSprite);
        const pixelHit = aabbHit && this.dragSprite.overlapsPixelPerfect(this.targetSprite);
        this.drawIndicator(this.bboxRect, this.dragSprite, this.targetSprite, aabbHit, pixelHit);

        // sprite-vs-terrain indicator (only the AABB of the terrain
        // patch and the sprite — drawn around the terrain region).
        const terrainAABBHit = this.aabbOverlapTerrain(this.dragSprite, this.terrain);
        const terrainPixelHit =
            terrainAABBHit && this.dragSprite.overlapsTerrain(this.terrain);
        this.drawTerrainIndicator(terrainAABBHit, terrainPixelHit);

        this.stats.update({
            'sprite/sprite bbox': aabbHit ? 'hit' : '-',
            'sprite/sprite pixel': pixelHit ? 'HIT' : '-',
            'sprite/terrain bbox': terrainAABBHit ? 'hit' : '-',
            'sprite/terrain pixel': terrainPixelHit ? 'HIT' : '-',
        });
    }

    private makeCircleTexture(key: string, fill: number): void {
        // Filled circle of radius (TEX_SIZE / 2 - 1), inscribed in a
        // (TEX_SIZE × TEX_SIZE) square — corners are transparent so
        // bbox vs pixel-perfect divergence is visible at the corners.
        const g = this.make.graphics({}, false);
        g.fillStyle(fill, 1);
        g.fillCircle(TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE / 2 - 1);
        g.lineStyle(2, 0xffffff, 0.6);
        g.strokeCircle(TEX_SIZE / 2, TEX_SIZE / 2, TEX_SIZE / 2 - 1);
        g.generateTexture(key, TEX_SIZE, TEX_SIZE);
        g.destroy();
    }

    private makeRingTexture(key: string, fill: number): void {
        // Filled ring (annulus). Phaser's Graphics doesn't expose a
        // composite/erase path API, so build the ring on a raw canvas
        // and register it as a Phaser texture via `textures.addCanvas`.
        // Inner area is transparent — the dragged sprite can sit
        // inside the target's AABB with no pixel-perfect hit by
        // ending up in the center.
        const canvas = document.createElement('canvas');
        canvas.width = TEX_SIZE;
        canvas.height = TEX_SIZE;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        const cx = TEX_SIZE / 2;
        const cy = TEX_SIZE / 2;
        const outer = TEX_SIZE / 2 - 1;
        const inner = TEX_SIZE / 4;
        // Fill outer disk with the body color.
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.fillStyle = `#${fill.toString(16).padStart(6, '0')}`;
        ctx.fill();
        // Erase the inner hole via destination-out.
        ctx.globalCompositeOperation = 'destination-out';
        ctx.beginPath();
        ctx.arc(cx, cy, inner, 0, Math.PI * 2);
        ctx.fill();
        // Restore default composite for the outline strokes.
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, outer, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, inner, 0, Math.PI * 2);
        ctx.stroke();

        this.textures.addCanvas(key, canvas);
    }

    private aabbOverlap(a: PixelPerfectSprite, b: PixelPerfectSprite): boolean {
        const ax = a.x - a.displayWidth * a.originX;
        const ay = a.y - a.displayHeight * a.originY;
        const bx = b.x - b.displayWidth * b.originX;
        const by = b.y - b.displayHeight * b.originY;
        return (
            ax < bx + b.displayWidth &&
            ax + a.displayWidth > bx &&
            ay < by + b.displayHeight &&
            ay + a.displayHeight > by
        );
    }

    private aabbOverlapTerrain(s: PixelPerfectSprite, t: DestructibleTerrain): boolean {
        const sx = s.x - s.displayWidth * s.originX;
        const sy = s.y - s.displayHeight * s.originY;
        return (
            sx < t.originX + t.bitmap.width &&
            sx + s.displayWidth > t.originX &&
            sy < t.originY + t.bitmap.height &&
            sy + s.displayHeight > t.originY
        );
    }

    private drawIndicator(
        g: Phaser.GameObjects.Graphics,
        a: PixelPerfectSprite,
        b: PixelPerfectSprite,
        aabbHit: boolean,
        pixelHit: boolean,
    ): void {
        const color = pixelHit ? 0x4ec9b0 : aabbHit ? 0xf2c94c : 0x6e7785;
        g.clear();
        g.lineStyle(2, color, 0.95);
        for (const sprite of [a, b]) {
            const x = sprite.x - sprite.displayWidth * sprite.originX;
            const y = sprite.y - sprite.displayHeight * sprite.originY;
            g.strokeRect(x, y, sprite.displayWidth, sprite.displayHeight);
        }
    }

    private drawTerrainIndicator(aabbHit: boolean, pixelHit: boolean): void {
        const color = pixelHit ? 0x4ec9b0 : aabbHit ? 0xf2c94c : 0x6e7785;
        this.terrainBboxRect.clear();
        this.terrainBboxRect.lineStyle(2, color, 0.95);
        this.terrainBboxRect.strokeRect(
            this.terrain.originX,
            this.terrain.originY,
            this.terrain.bitmap.width,
            this.terrain.bitmap.height,
        );
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: PixelSpriteScene,
});
