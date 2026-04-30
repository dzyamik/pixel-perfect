/**
 * Demo 08 — sprite playground.
 *
 * Drag-and-test sandbox for `PixelPerfectSprite`. Two pre-rendered
 * pixel-art mini sprites by default (a dragger + a static target),
 * plus a small destructible terrain patch underneath. Drag the
 * left sprite onto the right sprite or onto the terrain; the demo
 * shows three things at all times:
 *
 *   - The dragged sprite's **alpha-mask outline** in cyan, traced
 *     via `AlphaOverlap.maskToContours(...)`. This is what the
 *     pixel-perfect collision actually sees, vs the bounding box
 *     that a naive Phaser overlap test would use.
 *   - Optional bounding-box outlines (AABBs) on both sprites + the
 *     terrain patch, color-coded:
 *
 *         gray   : no AABB intersection
 *         yellow : AABBs intersect, no pixel-perfect hit
 *         green  : pixel-perfect overlap
 *
 *   - A status overlay listing the four collision states
 *     (sprite/sprite bbox, sprite/sprite pixel, sprite/terrain
 *     bbox, sprite/terrain pixel).
 *
 * The "upload PNG" button in the page header lets you swap the
 * dragger's texture for any PNG you drop in. The library handles
 * arbitrary alpha masks; this demo lets you watch that in action.
 *
 * Limits (inherited from PixelPerfectSprite v1):
 *
 *   - The sprite must be unscaled (we keep `scaleX === scaleY === 1`).
 *     If you upload a giant image it'll show at native size; the
 *     overlap math will still be correct.
 *   - No rotation. The mask is sampled axis-aligned.
 *
 * Code-walkthrough notes:
 *
 *   - `this.pixelPerfect.sprite(x, y, key)` is the only entry point
 *     you need to make a sprite collision-aware.
 *   - `sprite.invalidateAlphaMask()` after mutating the texture
 *     forces a fresh extraction on the next overlap call.
 *   - `AlphaOverlap.maskToContours(mask, epsilon)` is the public
 *     primitive for visualizing a mask's outline.
 */

import * as Phaser from 'phaser';
import { AlphaOverlap } from '../../src/index.js';
import type {
    DestructibleTerrain,
    PixelPerfectSprite,
} from '../../src/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';

const DEFAULT_SPRITE_KEY = 'pp-default-sprite';
const TARGET_SPRITE_KEY = 'pp-target-sprite';
const USER_SPRITE_KEY = 'pp-user-sprite';

const TERRAIN_W = 256;
const TERRAIN_H = 64;
const TERRAIN_CHUNK = 64;

class SpritePlaygroundScene extends Phaser.Scene {
    private dragSprite!: PixelPerfectSprite;
    private targetSprite!: PixelPerfectSprite;
    private terrain!: DestructibleTerrain;
    private overlay!: Phaser.GameObjects.Graphics;
    private stats!: ReturnType<typeof attachStats>;
    private showOutline = true;
    private showAABB = false;
    private hasUserSprite = false;

    constructor() {
        super('sprite-playground');
    }

    preload(): void {
        // Two pre-rendered "alien" mini sprites at native pixel-art
        // size (32x32 each). Both have transparent regions so the
        // outline/AABB divergence is meaningful.
        this.makeAlienTexture(DEFAULT_SPRITE_KEY, 0xff8080, 0xa04040);
        this.makeAlienTexture(TARGET_SPRITE_KEY, 0x80c0ff, 0x4080c0);
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x14181f);

        // Static target sprite, upper-right.
        this.targetSprite = this.pixelPerfect.sprite(540, 100, TARGET_SPRITE_KEY);

        // Mini destructible-terrain patch, lower portion of scene.
        this.terrain = this.pixelPerfect.terrain({
            width: TERRAIN_W,
            height: TERRAIN_H,
            chunkSize: TERRAIN_CHUNK,
            x: (this.scale.width - TERRAIN_W) / 2,
            y: 250,
            materials: [
                {
                    id: 1,
                    name: 'rock',
                    color: 0x556070,
                    density: 1,
                    friction: 0.5,
                    restitution: 0.05,
                    destructible: true,
                    destructionResistance: 0,
                },
            ],
        });
        // Wavy surface for the sprite-vs-terrain test.
        const bm = this.terrain.bitmap;
        for (let x = 0; x < TERRAIN_W; x++) {
            const surfaceY = Math.floor(20 + Math.sin((x / TERRAIN_W) * Math.PI * 3) * 8);
            for (let y = surfaceY; y < TERRAIN_H; y++) bm.setPixel(x, y, 1);
        }

        // Draggable sprite, upper-left.
        this.dragSprite = this.pixelPerfect.sprite(160, 100, DEFAULT_SPRITE_KEY);
        this.dragSprite.setInteractive({ draggable: true });
        this.input.setDraggable(this.dragSprite);
        this.input.on(
            'drag',
            (
                _p: Phaser.Input.Pointer,
                obj: Phaser.GameObjects.GameObject,
                x: number,
                y: number,
            ) => {
                if (obj === this.dragSprite) this.dragSprite.setPosition(x, y);
            },
        );

        // Single graphics layer for outline + AABB indicators.
        this.overlay = this.add.graphics().setDepth(100);

        // Wire the toolbar (DOM, not Phaser).
        const outlineCheckbox = document.getElementById(
            'show-outline',
        ) as HTMLInputElement | null;
        const aabbCheckbox = document.getElementById('show-aabb') as HTMLInputElement | null;
        const upload = document.getElementById('sprite-upload') as HTMLInputElement | null;
        if (outlineCheckbox !== null) {
            outlineCheckbox.checked = this.showOutline;
            outlineCheckbox.addEventListener('change', () => {
                this.showOutline = outlineCheckbox.checked;
            });
        }
        if (aabbCheckbox !== null) {
            aabbCheckbox.checked = this.showAABB;
            aabbCheckbox.addEventListener('change', () => {
                this.showAABB = aabbCheckbox.checked;
            });
        }
        if (upload !== null) {
            upload.addEventListener('change', (event) => {
                const file = (event.target as HTMLInputElement).files?.[0];
                if (file) this.loadUserSprite(file);
            });
        }

        // Scale slider: setScale on the dragSprite directly. The
        // PixelPerfectSprite cache invalidates automatically when
        // scaleX/Y differs from the cached value, so the alpha-mask
        // outline + collision both track the visible footprint.
        const scaleSlider = document.getElementById('scale-slider') as HTMLInputElement | null;
        const scaleReadout = document.getElementById('scale-readout');
        if (scaleSlider !== null) {
            scaleSlider.value = '1';
            const apply = () => {
                const v = Number.parseFloat(scaleSlider.value);
                this.dragSprite.setScale(v);
                if (scaleReadout !== null) scaleReadout.textContent = `${v.toFixed(1)}×`;
            };
            scaleSlider.addEventListener('input', apply);
            apply();
        }

        // Drag-and-drop on the canvas as an alternative to the file
        // picker. Easier when the user is already focused on the demo.
        const root = this.game.canvas.parentElement ?? document.body;
        root.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        root.addEventListener('drop', (e) => {
            e.preventDefault();
            const file = e.dataTransfer?.files[0];
            if (file !== undefined) this.loadUserSprite(file);
        });

        this.stats = attachStats(this);
        showHint(
            this,
            'drag the red sprite · upload your own PNG · cyan outline = real pixel-perfect footprint',
            8000,
        );
    }

    override update(): void {
        const aabbHit = this.aabbOverlap(this.dragSprite, this.targetSprite);
        const pixelHit =
            aabbHit && this.dragSprite.overlapsPixelPerfect(this.targetSprite);
        const terrainAABBHit = this.aabbOverlapTerrain(this.dragSprite, this.terrain);
        const terrainPixelHit =
            terrainAABBHit && this.dragSprite.overlapsTerrain(this.terrain);

        this.overlay.clear();

        if (this.showAABB) {
            this.drawSpriteAABB(this.dragSprite, aabbHit, pixelHit);
            this.drawSpriteAABB(this.targetSprite, aabbHit, pixelHit);
            this.drawTerrainAABB(terrainAABBHit, terrainPixelHit);
        }

        if (this.showOutline) {
            this.drawAlphaOutline(this.dragSprite, 0x4ec9b0);
            this.drawAlphaOutline(this.targetSprite, 0x6e7785);
        }

        this.stats.update({
            sprite: this.hasUserSprite ? 'user' : 'default',
            'sprite/sprite bbox': aabbHit ? 'hit' : '-',
            'sprite/sprite pixel': pixelHit ? 'HIT' : '-',
            'sprite/terrain bbox': terrainAABBHit ? 'hit' : '-',
            'sprite/terrain pixel': terrainPixelHit ? 'HIT' : '-',
        });
    }

    /**
     * Reads the file as a data URL, decodes it as an Image, draws
     * to a canvas, registers the canvas with Phaser as a texture,
     * and swaps the drag-sprite's texture to the new key. Then
     * forces an alpha-mask cache invalidation so the next overlap
     * call re-extracts.
     */
    private loadUserSprite(file: File): void {
        const reader = new FileReader();
        reader.addEventListener('load', () => {
            const img = new Image();
            img.addEventListener('load', () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (ctx === null) return;
                ctx.drawImage(img, 0, 0);
                if (this.textures.exists(USER_SPRITE_KEY)) {
                    this.textures.remove(USER_SPRITE_KEY);
                }
                this.textures.addCanvas(USER_SPRITE_KEY, canvas);
                this.dragSprite.setTexture(USER_SPRITE_KEY);
                this.dragSprite.invalidateAlphaMask();
                this.hasUserSprite = true;
            });
            img.src = reader.result as string;
        });
        reader.readAsDataURL(file);
    }

    /**
     * Builds a 32x32 "pixel-art alien" texture: head, body, eyes,
     * with transparent background. Two colors so the body has
     * shading. Programmer art — the point is to have transparency.
     */
    private makeAlienTexture(key: string, body: number, accent: number): void {
        const SIZE = 32;
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        if (ctx === null) return;
        // Body: rounded rectangle.
        ctx.fillStyle = `#${body.toString(16).padStart(6, '0')}`;
        ctx.beginPath();
        ctx.roundRect(8, 8, 16, 18, 4);
        ctx.fill();
        // Head bulge on top.
        ctx.beginPath();
        ctx.arc(16, 8, 5, 0, Math.PI, true);
        ctx.fill();
        // Antennae.
        ctx.fillRect(11, 1, 2, 5);
        ctx.fillRect(19, 1, 2, 5);
        ctx.fillStyle = `#${accent.toString(16).padStart(6, '0')}`;
        ctx.fillRect(10, 0, 4, 2);
        ctx.fillRect(18, 0, 4, 2);
        // Eyes.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(12, 12, 3, 3);
        ctx.fillRect(17, 12, 3, 3);
        ctx.fillStyle = '#000000';
        ctx.fillRect(13, 13, 1, 1);
        ctx.fillRect(18, 13, 1, 1);
        // Two little legs on the bottom.
        ctx.fillStyle = `#${body.toString(16).padStart(6, '0')}`;
        ctx.fillRect(10, 26, 3, 5);
        ctx.fillRect(19, 26, 3, 5);

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

    private drawSpriteAABB(
        sprite: PixelPerfectSprite,
        aabbHit: boolean,
        pixelHit: boolean,
    ): void {
        const color = pixelHit ? 0x4ec9b0 : aabbHit ? 0xf2c94c : 0x6e7785;
        const x = sprite.x - sprite.displayWidth * sprite.originX;
        const y = sprite.y - sprite.displayHeight * sprite.originY;
        this.overlay.lineStyle(1, color, 0.85);
        this.overlay.strokeRect(x, y, sprite.displayWidth, sprite.displayHeight);
    }

    private drawTerrainAABB(aabbHit: boolean, pixelHit: boolean): void {
        const color = pixelHit ? 0x4ec9b0 : aabbHit ? 0xf2c94c : 0x6e7785;
        this.overlay.lineStyle(1, color, 0.85);
        this.overlay.strokeRect(
            this.terrain.originX,
            this.terrain.originY,
            this.terrain.bitmap.width,
            this.terrain.bitmap.height,
        );
    }

    /**
     * Traces the sprite's alpha mask via `AlphaOverlap.maskToContours`
     * and renders the contour lines in the supplied color. We use the
     * sprite's effective (post-flip, post-scale) mask so the outline
     * tracks whatever the overlap math actually sees — including
     * runtime `setScale` changes.
     */
    private drawAlphaOutline(sprite: PixelPerfectSprite, color: number): void {
        const mask = sprite.getEffectiveAlphaMask();
        const x0 = Math.round(sprite.x - sprite.displayWidth * sprite.originX);
        const y0 = Math.round(sprite.y - sprite.displayHeight * sprite.originY);
        const contours = AlphaOverlap.maskToContours(mask, 0.5);
        this.overlay.lineStyle(1.5, color, 0.95);
        for (const c of contours) {
            if (c.points.length < 2) continue;
            this.overlay.beginPath();
            const first = c.points[0]!;
            this.overlay.moveTo(x0 + first.x, y0 + first.y);
            for (let i = 1; i < c.points.length; i++) {
                const p = c.points[i]!;
                this.overlay.lineTo(x0 + p.x, y0 + p.y);
            }
            if (c.closed) this.overlay.closePath();
            this.overlay.strokePath();
        }
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: SpritePlaygroundScene,
});
