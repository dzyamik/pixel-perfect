import * as Phaser from 'phaser';

import { AlphaOverlap } from '../core/index.js';
import type { AlphaMask } from '../core/index.js';
import type { DestructibleTerrain } from './DestructibleTerrain.js';

/**
 * A `Phaser.GameObjects.Sprite` augmented with per-pixel alpha-aware
 * overlap checks against other {@link PixelPerfectSprite}s and against
 * a {@link DestructibleTerrain}'s bitmap.
 *
 * Cost: extracting the alpha mask runs once per frame change (lazy, on
 * first overlap call). Overlap is `O(overlap_area)` after a constant
 * AABB cull. For two 64×64 sprites that fully overlap that's ~4096
 * one-byte checks; cheap but not free, so callers that test many pairs
 * should AABB-cull externally first.
 *
 * v1 limitations:
 *
 *  - **No rotation.** The mask is sampled axis-aligned. A sprite with
 *    `rotation !== 0` produces overlap results computed against an
 *    unrotated bounding mask, which is wrong. Rotating the mask
 *    on-the-fly is a v1.x feature.
 *  - **No scaling.** Overlap math assumes `scaleX === scaleY === 1`
 *    (and matching `displayWidth` / `displayHeight`). Scaled sprites
 *    will produce wrong results and the constructor logs a one-time
 *    warning to the console.
 *  - **`flipX` / `flipY`** are honored — index lookup is mirrored when
 *    sampling the mask.
 *  - **Render textures** as the source image are not supported. Use
 *    standard image / canvas textures.
 *
 * Usage via the plugin factory is preferred:
 *
 * ```ts
 * const sprite = this.pixelPerfect.sprite(x, y, 'player');
 * if (sprite.overlapsTerrain(terrain)) { ... }
 * ```
 */
export class PixelPerfectSprite extends Phaser.GameObjects.Sprite {
    /**
     * Cached alpha mask for the current frame. `null` until the first
     * overlap call. Invalidated when {@link onFrameChange} sees a
     * different frame name.
     */
    private cachedMask: AlphaMask | null = null;
    /** The frame name the cached mask was extracted from. */
    private cachedFrameName: string | null = null;

    constructor(
        scene: Phaser.Scene,
        x: number,
        y: number,
        textureKey: string,
        frame?: string | number,
    ) {
        super(scene, x, y, textureKey, frame);
        scene.add.existing(this);
    }

    /**
     * Returns `true` iff any solid pixel of this sprite overlaps a
     * solid pixel of `other`.
     *
     * Both sprites must be unscaled and unrotated. See class doc.
     */
    overlapsPixelPerfect(other: PixelPerfectSprite): boolean {
        if (!this.visible || !other.visible) return false;
        const a = this.getAlphaMask();
        const b = other.getAlphaMask();
        return AlphaOverlap.maskMaskOverlap(
            a,
            this.maskWorldX(),
            this.maskWorldY(),
            b,
            other.maskWorldX(),
            other.maskWorldY(),
        );
    }

    /**
     * Returns `true` iff any solid pixel of this sprite overlaps a
     * solid bitmap cell of `terrain`.
     *
     * Coordinates are converted from scene space (where the sprite
     * lives) to bitmap space (where the terrain stores its pixels)
     * via the terrain's `originX` / `originY`.
     */
    overlapsTerrain(terrain: DestructibleTerrain): boolean {
        if (!this.visible) return false;
        const mask = this.getAlphaMask();
        const sceneTopLeftX = this.maskWorldX();
        const sceneTopLeftY = this.maskWorldY();
        const bitmapX = sceneTopLeftX - terrain.originX;
        const bitmapY = sceneTopLeftY - terrain.originY;
        return AlphaOverlap.maskBitmapOverlap(
            mask,
            bitmapX,
            bitmapY,
            terrain.bitmap,
        );
    }

    /**
     * Drops the cached alpha mask. Call after mutating the underlying
     * texture (e.g. drawing into a `RenderTexture`); the next overlap
     * call will re-extract.
     */
    invalidateAlphaMask(): void {
        this.cachedMask = null;
        this.cachedFrameName = null;
    }

    private getAlphaMask(): AlphaMask {
        const frameName = String(this.frame.name);
        if (this.cachedMask !== null && this.cachedFrameName === frameName) {
            return this.cachedMask;
        }
        const mask = this.extractAlphaMask();
        this.cachedMask = mask;
        this.cachedFrameName = frameName;
        return mask;
    }

    /**
     * Extracts an axis-aligned alpha mask from the current frame,
     * applying `flipX` / `flipY` so subsequent overlap checks see the
     * sprite as the user does.
     */
    private extractAlphaMask(): AlphaMask {
        const frame = this.frame;
        const source = frame.source.image as HTMLImageElement | HTMLCanvasElement;
        if (typeof (source as { tagName?: string }).tagName !== 'string') {
            throw new Error(
                `PixelPerfectSprite: texture "${this.texture.key}" frame ` +
                    `"${frame.name}" has a non-Image/Canvas source. ` +
                    'RenderTextures are not supported in v1; draw into a ' +
                    'standard texture instead.',
            );
        }
        const width = frame.cutWidth;
        const height = frame.cutHeight;

        // Draw the frame's cut region into a temp canvas and read RGBA.
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });
        if (ctx === null) {
            throw new Error('PixelPerfectSprite: failed to get 2d context');
        }
        ctx.drawImage(
            source,
            frame.cutX,
            frame.cutY,
            width,
            height,
            0,
            0,
            width,
            height,
        );
        const imageData = ctx.getImageData(0, 0, width, height);

        const baseMask = AlphaOverlap.alphaSourceToMask({
            data: imageData.data,
            width,
            height,
        });

        // Honor flipX / flipY by mirroring the mask if needed. This
        // happens once per cache miss; runtime overlap is then a plain
        // index lookup.
        if (this.flipX || this.flipY) {
            return mirrorMask(baseMask, this.flipX, this.flipY);
        }
        return baseMask;
    }

    /**
     * Top-left X of the sprite's mask in **scene coordinates**. Phaser
     * sprites locate themselves at `(x, y)` adjusted by `originX` /
     * `originY` (defaults 0.5, 0.5 — i.e. centered). The mask is the
     * size of the cut frame, which equals `displayWidth` for an
     * unscaled sprite.
     */
    private maskWorldX(): number {
        return Math.round(this.x - this.displayWidth * this.originX);
    }
    private maskWorldY(): number {
        return Math.round(this.y - this.displayHeight * this.originY);
    }
}

/** Returns a new mask mirrored on the requested axes. */
function mirrorMask(mask: AlphaMask, flipX: boolean, flipY: boolean): AlphaMask {
    const w = mask.width;
    const h = mask.height;
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        const srcY = flipY ? h - 1 - y : y;
        for (let x = 0; x < w; x++) {
            const srcX = flipX ? w - 1 - x : x;
            out[y * w + x] = mask.data[srcY * w + srcX]!;
        }
    }
    return { data: out, width: w, height: h };
}
