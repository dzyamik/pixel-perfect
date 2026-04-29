import type { ChunkedBitmap } from '../ChunkedBitmap.js';

/** Material id for empty space. Carving writes this value. */
const AIR = 0;

/**
 * Carves a filled disc into the bitmap, setting every cell within `radius`
 * of `(cx, cy)` to air (`0`).
 *
 * Rasterization uses the squared-distance test `dx² + dy² ≤ r²` against
 * integer cell centers; cells exactly on the radius are included. The
 * scanned bounding box is clipped to bitmap bounds, so the operation
 * never throws and circles that straddle or fall entirely outside the
 * world are handled silently.
 *
 * Non-positive or NaN radii are no-ops. Center coordinates may be
 * non-integer (useful for sub-pixel-aimed weapon impacts).
 */
export function circle(bitmap: ChunkedBitmap, cx: number, cy: number, radius: number): void {
    if (!(radius > 0)) return; // also rejects NaN

    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(bitmap.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(bitmap.height - 1, Math.ceil(cy + radius));

    if (minX > maxX || minY > maxY) return;

    const r2 = radius * radius;
    for (let y = minY; y <= maxY; y++) {
        const dy = y - cy;
        const dy2 = dy * dy;
        for (let x = minX; x <= maxX; x++) {
            const dx = x - cx;
            if (dx * dx + dy2 <= r2) {
                bitmap.setPixel(x, y, AIR);
            }
        }
    }
}
