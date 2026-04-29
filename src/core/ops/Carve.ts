import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { Point } from '../types.js';
import type { AlphaSource } from './raster.js';
import { paintCircle, paintFromAlphaTexture, paintPolygon } from './raster.js';

export type { AlphaSource } from './raster.js';

/** Material id for empty space. */
const AIR = 0;

/** Default alpha cutoff: pixels with alpha < 128 are treated as transparent. */
const DEFAULT_ALPHA_THRESHOLD = 128;

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

/**
 * Carves an alpha-mask "stamp" into the bitmap. The source is positioned
 * with its top-left at `(dstX, dstY)`; every source pixel whose alpha
 * channel is at or above `threshold` causes the corresponding bitmap
 * cell to be set to air.
 *
 * The Phaser integration layer extracts an `ImageData` from a texture
 * (via canvas / DynamicTexture) and forwards it here. Core never imports
 * a DOM type — `AlphaSource` is structural so any RGBA buffer works.
 *
 * @param threshold Alpha cutoff in `0..255`. Default `128`.
 */
export function fromAlphaTexture(
    bitmap: ChunkedBitmap,
    source: AlphaSource,
    dstX: number,
    dstY: number,
    threshold: number = DEFAULT_ALPHA_THRESHOLD,
): void {
    paintFromAlphaTexture(bitmap, source, dstX, dstY, threshold, AIR);
}
