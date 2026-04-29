import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { HitResult } from '../types.js';

/**
 * Microsecond-cost spatial queries that read directly from a
 * {@link ChunkedBitmap}. Game logic that would otherwise issue dozens
 * of Box2D queries per frame can use these instead.
 *
 * All queries treat out-of-world coordinates as air (consistent with
 * `bitmap.getPixel`'s lenient behavior). Coordinate inputs need not be
 * integers; non-integer values are floored or used directly per the
 * function's documented contract.
 */

/**
 * `true` when the cell at integer-floor of `(x, y)` holds a non-zero
 * material id. Out-of-bounds returns `false`.
 */
export function isSolid(bitmap: ChunkedBitmap, x: number, y: number): boolean {
    return bitmap.getPixel(x, y) > 0;
}

/**
 * Material id at integer-floor of `(x, y)`, or `0` for air / out-of-bounds.
 */
export function sampleMaterial(bitmap: ChunkedBitmap, x: number, y: number): number {
    return bitmap.getPixel(x, y);
}

/**
 * Walks down column `x` from `y = 0` and returns the y of the first
 * solid cell. Returns `bitmap.height` (one past the bottom row) if the
 * column is entirely air or `x` is out of bounds — this lets callers
 * compute spawn positions like `surfaceY(x) - entityHeight` without
 * special-casing the "no surface" return.
 *
 * Cost: O(height) on the worst case. For repeated queries on the same
 * column, callers should cache the result.
 */
export function surfaceY(bitmap: ChunkedBitmap, x: number): number {
    const H = bitmap.height;
    for (let y = 0; y < H; y++) {
        if (bitmap.getPixel(x, y) > 0) return y;
    }
    return H;
}

/**
 * Walks down column `x` starting at `y` for at most `maxDist` rows
 * (inclusive of the start). Returns the first solid y in range, or
 * `null` when the range is exhausted with no hit.
 *
 * Returns `null` if `maxDist` is non-positive.
 */
export function findGroundBelow(
    bitmap: ChunkedBitmap,
    x: number,
    y: number,
    maxDist: number,
): number | null {
    if (maxDist <= 0) return null;
    const endY = Math.min(bitmap.height - 1, y + maxDist - 1);
    for (let cy = y; cy <= endY; cy++) {
        if (bitmap.getPixel(x, cy) > 0) return cy;
    }
    return null;
}

/**
 * Casts a ray from `(x1, y1)` to `(x2, y2)` and returns the first
 * solid cell encountered, or `null` if the ray passes through air for
 * its entire length.
 *
 * Coordinates are floored to integers; the walk uses Bresenham's line
 * algorithm. The hit cell is the cell containing the first solid
 * sample, and `distance` is the Euclidean distance from `(x1, y1)` to
 * that cell's integer coordinate.
 *
 * Cost: O(line length) — proportional to the longer of `|dx|` and `|dy|`.
 */
export function raycast(
    bitmap: ChunkedBitmap,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
): HitResult | null {
    let x = Math.floor(x1);
    let y = Math.floor(y1);
    const ex = Math.floor(x2);
    const ey = Math.floor(y2);

    const dx = Math.abs(ex - x);
    const dy = Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx - dy;

    // Standard Bresenham: emit (x, y), step, repeat until we're past
    // the endpoint. The `while (true)` + sentinel `if (x === ex && y === ey)`
    // pattern correctly handles both degenerate (length-0) rays and rays
    // ending exactly on a solid cell.
    while (true) {
        const material = bitmap.getPixel(x, y);
        if (material > 0) {
            const dxFromStart = x - x1;
            const dyFromStart = y - y1;
            return {
                x,
                y,
                materialId: material,
                distance: Math.hypot(dxFromStart, dyFromStart),
            };
        }
        if (x === ex && y === ey) return null;
        const e2 = 2 * err;
        if (e2 > -dy) {
            err -= dy;
            x += sx;
        }
        if (e2 < dx) {
            err += dx;
            y += sy;
        }
    }
}
