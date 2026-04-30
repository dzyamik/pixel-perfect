/**
 * Pure pixel-perfect overlap helpers for sprite-vs-sprite and
 * sprite-vs-bitmap collision.
 *
 * The Phaser layer's {@link PixelPerfectSprite} extracts an alpha mask
 * once from its texture (via the browser canvas / `ImageData` path) and
 * then calls into the functions here. Keeping the math in `core/`
 * means the Phaser layer doesn't own the per-pixel loop, and the
 * algorithm is unit-testable without a `Phaser.Game` instance.
 *
 * v1 limitations:
 *
 *  - Masks are axis-aligned. Rotated sprites are not supported — the
 *    Phaser layer documents this and skips the rotation transform.
 *  - Scale must be 1. Scaled sprites would need either upscaling the
 *    mask or sampling at fractional coords, both punted to v1.x.
 */

import { ChunkedBitmap } from '../ChunkedBitmap.js';
import * as DouglasPeucker from '../algorithms/DouglasPeucker.js';
import * as MarchingSquares from '../algorithms/MarchingSquares.js';
import type { AlphaSource } from '../ops/raster.js';
import type { Contour } from '../types.js';

/**
 * One byte per pixel, row-major: `0` = transparent (air), non-zero =
 * solid. Distinct from {@link AlphaSource} (RGBA-shaped, 4 bytes per
 * pixel) — the mask is what {@link PixelPerfectSprite} keeps in memory
 * once the source has been thresholded, so per-pixel checks read one
 * byte instead of indexing into the alpha channel of an RGBA buffer.
 */
export interface AlphaMask {
    /** 1 byte per pixel. Length = `width * height`. */
    readonly data: Uint8Array;
    readonly width: number;
    readonly height: number;
}

/**
 * Builds a one-byte-per-pixel {@link AlphaMask} from an
 * {@link AlphaSource} (e.g. browser `ImageData`). Pixels whose alpha
 * byte is `>= threshold` become `1`; everything else becomes `0`.
 *
 * `threshold` defaults to 128, matching `Carve.fromAlphaTexture`'s
 * convention so that "non-transparent counts as solid" gives the same
 * result for both carving and collision.
 */
export function alphaSourceToMask(
    source: AlphaSource,
    threshold = 128,
): AlphaMask {
    const len = source.width * source.height;
    const data = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        // RGBA bytes, alpha at offset 3.
        if (source.data[i * 4 + 3]! >= threshold) data[i] = 1;
    }
    return { data, width: source.width, height: source.height };
}

/**
 * Returns `true` iff any pixel that is solid in mask `a` is also solid
 * in mask `b` after both are placed at their respective world
 * positions.
 *
 * Both positions are top-left corners; masks are axis-aligned.
 *
 * Complexity is `O(overlap_area)` — the early AABB cull means
 * non-overlapping sprites cost a constant. For two 64×64 sprites that
 * overlap fully this is ~4096 byte comparisons; cheap but not free, so
 * callers that need to test many pairs should AABB-cull externally
 * before invoking.
 */
export function maskMaskOverlap(
    a: AlphaMask,
    ax: number,
    ay: number,
    b: AlphaMask,
    bx: number,
    by: number,
): boolean {
    // Overlap rect in world coords.
    const lx = Math.max(ax, bx);
    const ly = Math.max(ay, by);
    const rx = Math.min(ax + a.width, bx + b.width);
    const ry = Math.min(ay + a.height, by + b.height);
    if (lx >= rx || ly >= ry) return false;

    for (let y = ly; y < ry; y++) {
        for (let x = lx; x < rx; x++) {
            const aIdx = (y - ay) * a.width + (x - ax);
            if (a.data[aIdx] === 0) continue;
            const bIdx = (y - by) * b.width + (x - bx);
            if (b.data[bIdx] !== 0) return true;
        }
    }
    return false;
}

/**
 * Returns `true` iff any solid pixel in `mask` overlaps a solid cell
 * of the bitmap when the mask's top-left is placed at `(mx, my)` in
 * the bitmap's coordinate space.
 *
 * Iterates only the mask's solid pixels and tests each against the
 * bitmap. Bitmap reads use {@link ChunkedBitmap.getPixel} which is
 * O(1) and treats out-of-bounds as air.
 */
export function maskBitmapOverlap(
    mask: AlphaMask,
    mx: number,
    my: number,
    bitmap: ChunkedBitmap,
): boolean {
    for (let y = 0; y < mask.height; y++) {
        for (let x = 0; x < mask.width; x++) {
            if (mask.data[y * mask.width + x] === 0) continue;
            if (bitmap.getPixel(mx + x, my + y) > 0) return true;
        }
    }
    return false;
}

/**
 * Extracts the polyline outline(s) of an {@link AlphaMask}'s solid
 * region(s) in mask-local coordinates.
 *
 * Useful for visualizing what a sprite's pixel-perfect collision
 * footprint actually looks like — a UI overlay that traces the
 * outline of solid pixels rather than the rectangular AABB. Demo 08
 * uses this to draw the sprite's "real" border.
 *
 * Implementation: builds a single-chunk temp bitmap whose interior
 * matches the mask (with 1 px of air padding so the contour closes
 * locally), runs marching squares on it, and applies Douglas-Peucker
 * with `epsilon`. Output coordinates are in mask-local space (`(0, 0)`
 * is the mask's top-left corner). Translate by the mask's scene
 * position to draw.
 *
 * @param epsilon Douglas-Peucker simplification distance in pixels.
 *                Default 1 — same as the destructible-terrain path.
 *                Pass 0 to keep every marching-squares vertex.
 */
export function maskToContours(mask: AlphaMask, epsilon = 1): Contour[] {
    const PADDING = 1;
    const size = Math.max(mask.width, mask.height) + 2 * PADDING;
    const temp = new ChunkedBitmap({
        width: size,
        height: size,
        chunkSize: size,
    });
    for (let y = 0; y < mask.height; y++) {
        for (let x = 0; x < mask.width; x++) {
            if (mask.data[y * mask.width + x] !== 0) {
                temp.setPixel(x + PADDING, y + PADDING, 1);
            }
        }
    }
    const tempChunk = temp.chunks[0];
    if (tempChunk === undefined) return [];

    const contours: Contour[] = [];
    for (const c of MarchingSquares.extract(tempChunk, temp)) {
        const translated: Contour = {
            points: c.points.map((p) => ({
                x: p.x - PADDING,
                y: p.y - PADDING,
            })),
            closed: c.closed,
        };
        contours.push(DouglasPeucker.simplify(translated, epsilon));
    }
    return contours;
}
