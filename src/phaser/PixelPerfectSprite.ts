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
 * Limitations:
 *
 *  - **No rotation.** The mask is sampled axis-aligned. A sprite with
 *    `rotation !== 0` produces overlap results computed against an
 *    unrotated bounding mask, which is wrong. Rotating the mask
 *    on-the-fly is a future feature.
 *  - **`flipX` / `flipY`** are honored — index lookup is mirrored when
 *    sampling the mask.
 *  - **Scaling** (`scaleX` / `scaleY`) is honored via nearest-neighbor
 *    stretch of the cached mask. The cache invalidates when the scale
 *    changes, so `setScale(...)` at runtime works without manual
 *    `invalidateAlphaMask()` calls. Memory cost is `O(scaleX × scaleY)`
 *    per cached mask — fine up to 8× for typical sprite sizes; beyond
 *    that consider rendering at native size and scaling the visual
 *    GameObject in some other way.
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
     * Cached alpha mask, post-flip + post-scale. `null` until the
     * first overlap call. Invalidated when the cache key changes
     * (frame name, flipX/Y, scaleX/Y).
     */
    private cachedMask: AlphaMask | null = null;
    /** Composite key for the cached mask: frame name + flip + scale. */
    private cachedMaskKey: string | null = null;

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
     * call will re-extract. Frame, flip, and scale changes invalidate
     * the cache automatically — this method is only needed when the
     * texture's pixel data itself changed.
     */
    invalidateAlphaMask(): void {
        this.cachedMask = null;
        this.cachedMaskKey = null;
    }

    /**
     * Returns the alpha mask the overlap math actually uses for the
     * sprite's current frame, flip, and scale state. Lazily extracted
     * on first call (cost: one canvas read + thresholding pass) and
     * cached for subsequent calls until any of the cache-key inputs
     * change.
     *
     * Useful for visualization (drawing the outline, debug overlays)
     * — see demo 08's outline path. Hot-loop callers should still go
     * through `overlapsPixelPerfect` / `overlapsTerrain` which avoid
     * an unnecessary extra access.
     *
     * Mutating the returned mask's `data` is allowed but pointless;
     * the cache holds the same reference, so any change is visible
     * to the next overlap call. The library does not mutate it.
     */
    getEffectiveAlphaMask(): AlphaMask {
        return this.getAlphaMask();
    }

    private getAlphaMask(): AlphaMask {
        const sx = Math.abs(this.scaleX);
        const sy = Math.abs(this.scaleY);
        const key = `${this.frame.name}|${this.flipX ? 1 : 0}${this.flipY ? 1 : 0}|${sx}x${sy}`;
        if (this.cachedMask !== null && this.cachedMaskKey === key) {
            return this.cachedMask;
        }
        const mask = this.extractAlphaMask();
        this.cachedMask = mask;
        this.cachedMaskKey = key;
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
        const flipped =
            this.flipX || this.flipY
                ? mirrorMask(baseMask, this.flipX, this.flipY)
                : baseMask;

        // Honor scaleX / scaleY by nearest-neighbor stretching the
        // mask to displayWidth × displayHeight so overlap math sees
        // the same footprint Phaser draws. `Math.abs` because flipping
        // is already handled above; a negative scale would be a
        // double-flip we don't want.
        const sx = Math.abs(this.scaleX);
        const sy = Math.abs(this.scaleY);
        if (sx === 1 && sy === 1) return flipped;
        return scaleMask(flipped, sx, sy);
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

/**
 * Returns a new mask stretched by `(sx, sy)` via nearest-neighbor.
 * Output dimensions are `round(width * sx)` × `round(height * sy)`,
 * matching Phaser's `displayWidth` / `displayHeight` convention.
 *
 * Nearest-neighbor (rather than bilinear) keeps the alpha mask binary
 * — every output cell is either fully solid or fully transparent —
 * and preserves the pixel-art aesthetic. Sub-pixel positioning during
 * overlap rounds to the nearest scene pixel anyway, so bilinear
 * sampling would just blur the mask edges without buying anything.
 *
 * Memory cost: `O(sx × sy)` per cached mask. For the typical 32×32
 * sprite at 4× scale that's a 128×128 = 16 KB Uint8Array, allocated
 * once per cache miss.
 */
function scaleMask(mask: AlphaMask, sx: number, sy: number): AlphaMask {
    const dw = Math.max(1, Math.round(mask.width * sx));
    const dh = Math.max(1, Math.round(mask.height * sy));
    const out = new Uint8Array(dw * dh);
    const srcW = mask.width;
    const srcH = mask.height;
    for (let y = 0; y < dh; y++) {
        const srcY = Math.min(srcH - 1, Math.floor(y / sy));
        const rowBase = srcY * srcW;
        const outBase = y * dw;
        for (let x = 0; x < dw; x++) {
            const srcX = Math.min(srcW - 1, Math.floor(x / sx));
            out[outBase + x] = mask.data[rowBase + srcX]!;
        }
    }
    return { data: out, width: dw, height: dh };
}
