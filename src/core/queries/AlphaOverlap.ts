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
 * Placement of an {@link AlphaMask} in scene coordinates, with
 * optional rotation around a pivot point. Used by the
 * `*OverlapTransformed` variants when the masks may be rotated.
 *
 * The transform takes a mask-local point `(mx, my)` to a scene-space
 * point `(sx, sy)` via:
 *
 * ```text
 * dx = mx - pivotX
 * dy = my - pivotY
 * sx = x + cos(rotation) * dx - sin(rotation) * dy
 * sy = y + sin(rotation) * dx + cos(rotation) * dy
 * ```
 *
 * That means `(x, y)` is the **scene-space coordinate of the mask's
 * pivot point**, and the mask rotates around `(pivotX, pivotY)` in its
 * own coordinate system. With the defaults (`pivotX=0, pivotY=0,
 * rotation=0`), `(x, y)` is the scene-space coord of the mask's
 * top-left corner — matching the `(mx, my)` parameter convention of
 * the axis-aligned `maskMaskOverlap` / `maskBitmapOverlap`.
 */
export interface MaskTransform {
    /** Scene-space coordinate of the mask's pivot point. */
    x: number;
    y: number;
    /** Mask-local coordinate of the rotation pivot. Default `(0, 0)`. */
    pivotX?: number;
    pivotY?: number;
    /** Rotation in radians around the pivot. Default `0`. */
    rotation?: number;
}

/**
 * Computes the scene-space AABB of a mask under a transform.
 *
 * Helper for `*OverlapTransformed`. Exported for visualization /
 * debug overlays (e.g. drawing the rotated bounding box). For the
 * unrotated case the AABB is exactly `[x, y, x + width, y + height]`.
 */
export function transformedMaskBounds(
    mask: AlphaMask,
    t: MaskTransform,
): { minX: number; minY: number; maxX: number; maxY: number } {
    const px = t.pivotX ?? 0;
    const py = t.pivotY ?? 0;
    const r = t.rotation ?? 0;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    // 4 corners of the mask in mask-local coords.
    const corners: [number, number][] = [
        [0 - px, 0 - py],
        [mask.width - px, 0 - py],
        [mask.width - px, mask.height - py],
        [0 - px, mask.height - py],
    ];
    for (const [dx, dy] of corners) {
        const sx = t.x + cos * dx - sin * dy;
        const sy = t.y + sin * dx + cos * dy;
        if (sx < minX) minX = sx;
        if (sx > maxX) maxX = sx;
        if (sy < minY) minY = sy;
        if (sy > maxY) maxY = sy;
    }
    return { minX, minY, maxX, maxY };
}

/**
 * Returns `true` iff any pixel that is solid in mask `a` (under
 * `ta`) is also solid in mask `b` (under `tb`) anywhere their
 * scene-space AABBs intersect.
 *
 * For unrotated, unmoved masks (default transforms), this matches
 * {@link maskMaskOverlap} but with extra arithmetic per sample —
 * use the simpler axis-aligned function in that hot path. This
 * variant is called by {@link PixelPerfectSprite} when either
 * sprite has `rotation !== 0`.
 *
 * Per-pixel cost: 4 muls + 4 adds + 2 floors per mask sample, vs
 * one indexed read for the axis-aligned variant. AABB-cull bound
 * keeps the loop tight on small overlaps.
 */
export function maskMaskOverlapTransformed(
    a: AlphaMask,
    ta: MaskTransform,
    b: AlphaMask,
    tb: MaskTransform,
): boolean {
    const aabbA = transformedMaskBounds(a, ta);
    const aabbB = transformedMaskBounds(b, tb);
    const lx = Math.max(aabbA.minX, aabbB.minX);
    const ly = Math.max(aabbA.minY, aabbB.minY);
    const rx = Math.min(aabbA.maxX, aabbB.maxX);
    const ry = Math.min(aabbA.maxY, aabbB.maxY);
    if (lx >= rx || ly >= ry) return false;

    // Hoist the back-rotation constants out of the loop. Note the
    // sin/cos negation: the mapping from scene → mask-local needs to
    // rotate by `-rotation`.
    const apx = ta.pivotX ?? 0;
    const apy = ta.pivotY ?? 0;
    const aacos = Math.cos(-(ta.rotation ?? 0));
    const aasin = Math.sin(-(ta.rotation ?? 0));
    const aw = a.width;
    const ah = a.height;
    const adata = a.data;
    const ax = ta.x;
    const ay = ta.y;

    const bpx = tb.pivotX ?? 0;
    const bpy = tb.pivotY ?? 0;
    const bbcos = Math.cos(-(tb.rotation ?? 0));
    const bbsin = Math.sin(-(tb.rotation ?? 0));
    const bw = b.width;
    const bh = b.height;
    const bdata = b.data;
    const bx = tb.x;
    const by = tb.y;

    // Sample at each scene pixel's *center* (sx + 0.5, sy + 0.5) so
    // that the back-rotated mask coordinate lands inside the cell
    // that geometrically covers the pixel center, not on the
    // boundary between two mask cells. Without the +0.5, a 90°
    // rotation can land exactly on a cell edge and `floor()` rolls
    // into the wrong neighbor — e.g. mask coord (0, 1) when the
    // intent is (0, 0). Axis-aligned identity still gives the same
    // integer mask index because `floor(sx + 0.5 - tx)` is `sx - tx`
    // for integer `tx`.
    const x0 = Math.floor(lx);
    const y0 = Math.floor(ly);
    const x1 = Math.ceil(rx);
    const y1 = Math.ceil(ry);
    for (let sy = y0; sy < y1; sy++) {
        const cy = sy + 0.5;
        for (let sx = x0; sx < x1; sx++) {
            const cx = sx + 0.5;
            // Sample a's mask at the center of pixel (sx, sy).
            const adx = cx - ax;
            const ady = cy - ay;
            const amx = apx + aacos * adx - aasin * ady;
            const amy = apy + aasin * adx + aacos * ady;
            const aix = Math.floor(amx);
            const aiy = Math.floor(amy);
            if (aix < 0 || aiy < 0 || aix >= aw || aiy >= ah) continue;
            if (adata[aiy * aw + aix] === 0) continue;
            // Sample b's mask at the same scene pixel center.
            const bdx = cx - bx;
            const bdy = cy - by;
            const bmx = bpx + bbcos * bdx - bbsin * bdy;
            const bmy = bpy + bbsin * bdx + bbcos * bdy;
            const bix = Math.floor(bmx);
            const biy = Math.floor(bmy);
            if (bix < 0 || biy < 0 || bix >= bw || biy >= bh) continue;
            if (bdata[biy * bw + bix] !== 0) return true;
        }
    }
    return false;
}

/**
 * Returns `true` iff any solid pixel of `mask` (under `t`) overlaps
 * a solid cell of `bitmap`.
 *
 * Bitmap remains axis-aligned in its own coordinate space; only the
 * mask is allowed to be rotated. Counterpart to
 * {@link maskBitmapOverlap}; used by `PixelPerfectSprite` when the
 * sprite has `rotation !== 0`.
 */
export function maskBitmapOverlapTransformed(
    mask: AlphaMask,
    t: MaskTransform,
    bitmap: ChunkedBitmap,
): boolean {
    const aabb = transformedMaskBounds(mask, t);
    const lx = Math.max(aabb.minX, 0);
    const ly = Math.max(aabb.minY, 0);
    const rx = Math.min(aabb.maxX, bitmap.width);
    const ry = Math.min(aabb.maxY, bitmap.height);
    if (lx >= rx || ly >= ry) return false;

    const px = t.pivotX ?? 0;
    const py = t.pivotY ?? 0;
    const cos = Math.cos(-(t.rotation ?? 0));
    const sin = Math.sin(-(t.rotation ?? 0));
    const mw = mask.width;
    const mh = mask.height;
    const mdata = mask.data;
    const tx = t.x;
    const ty = t.y;

    // Pixel-center sampling — see {@link maskMaskOverlapTransformed}
    // for why integer-corner sampling lands on cell boundaries under
    // rotation and rolls into the wrong neighbor.
    const x0 = Math.floor(lx);
    const y0 = Math.floor(ly);
    const x1 = Math.ceil(rx);
    const y1 = Math.ceil(ry);
    for (let sy = y0; sy < y1; sy++) {
        const cy = sy + 0.5;
        for (let sx = x0; sx < x1; sx++) {
            const cx = sx + 0.5;
            const dx = cx - tx;
            const dy = cy - ty;
            const mx = px + cos * dx - sin * dy;
            const my = py + sin * dx + cos * dy;
            const ix = Math.floor(mx);
            const iy = Math.floor(my);
            if (ix < 0 || iy < 0 || ix >= mw || iy >= mh) continue;
            if (mdata[iy * mw + ix] === 0) continue;
            if (bitmap.getPixel(sx, sy) > 0) return true;
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
