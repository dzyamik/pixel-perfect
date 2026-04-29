import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { Point } from '../types.js';
import { paintCircle, paintPolygon } from './raster.js';

/**
 * Deposits material in a filled disc, setting every cell within `radius`
 * of `(cx, cy)` to `materialId`. This is the deposit complement of
 * {@link Carve.circle}: identical rasterization, but writes the supplied
 * material id instead of air.
 *
 * Cells exactly on the radius boundary are included. The bounding box is
 * clipped to bitmap bounds. Non-positive and NaN radii are no-ops.
 *
 * @throws (via setPixel) If `materialId` is not an integer in `0..255`.
 *         The id is not validated against the bitmap's material registry;
 *         callers may use unregistered ids if they own their own
 *         renderer / lookup pipeline.
 */
export function circle(
    bitmap: ChunkedBitmap,
    cx: number,
    cy: number,
    radius: number,
    materialId: number,
): void {
    paintCircle(bitmap, cx, cy, radius, materialId);
}

/**
 * Deposits material inside a closed polygon, setting every interior cell
 * to `materialId`. The deposit complement of {@link Carve.polygon}.
 *
 * Polygons with fewer than 3 vertices are no-ops; even-odd fill applies.
 *
 * @throws (via setPixel) If `materialId` is not an integer in `0..255`.
 */
export function polygon(
    bitmap: ChunkedBitmap,
    points: readonly Point[],
    materialId: number,
): void {
    paintPolygon(bitmap, points, materialId);
}
