import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { Point } from '../types.js';
import { paintCircle, paintPolygon } from './raster.js';

/** Material id for empty space. */
const AIR = 0;

/**
 * Carves a filled disc into the bitmap, setting every cell within `radius`
 * of `(cx, cy)` to air (`0`).
 *
 * Cells exactly on the radius boundary are included (`dx² + dy² ≤ r²`).
 * The bounding box is clipped to bitmap bounds, so callers may pass any
 * world position; circles that fall fully outside the world are silent
 * no-ops. Non-positive and NaN radii are no-ops. Sub-pixel center
 * coordinates are allowed.
 */
export function circle(bitmap: ChunkedBitmap, cx: number, cy: number, radius: number): void {
    paintCircle(bitmap, cx, cy, radius, AIR);
}

/**
 * Carves a closed polygon into the bitmap, setting every interior cell to
 * air (`0`). The polygon is implicitly closed (last point connects to
 * first); filling uses the even-odd rule, so self-intersecting polygons
 * carve their lobes but leave central crossing regions untouched.
 *
 * Polygons with fewer than 3 vertices are no-ops. Scanlines are clipped
 * to bitmap bounds, so out-of-world polygons are silent.
 */
export function polygon(bitmap: ChunkedBitmap, points: readonly Point[]): void {
    paintPolygon(bitmap, points, AIR);
}
