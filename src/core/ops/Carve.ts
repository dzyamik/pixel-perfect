import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { Point } from '../types.js';

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

/**
 * Carves a closed polygon into the bitmap, setting every interior cell to
 * air (`0`). The polygon is implicitly closed (the last point connects
 * back to the first). Polygons with fewer than 3 vertices are no-ops.
 *
 * Filling uses the even-odd rule, so self-intersecting polygons are
 * supported (a bowtie carves both lobes but leaves the central crossing
 * region alone). The scanline range is clipped to the bitmap, so polygons
 * that fall outside are silent no-ops and partially-outside polygons
 * carve only their in-bounds intersection.
 *
 * @param points Vertices in world coordinates. May contain non-integer
 *               values; intersections are computed exactly and rounded
 *               to cell boundaries on a per-scanline basis.
 */
export function polygon(bitmap: ChunkedBitmap, points: readonly Point[]): void {
    if (points.length < 3) return;

    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
    }

    const yStart = Math.max(0, Math.ceil(minY));
    const yEnd = Math.min(bitmap.height - 1, Math.floor(maxY));
    if (yStart > yEnd) return;

    const intersections: number[] = [];
    for (let y = yStart; y <= yEnd; y++) {
        intersections.length = 0;
        let j = points.length - 1;
        for (let i = 0; i < points.length; i++) {
            const p1 = points[j]!;
            const p2 = points[i]!;
            // Half-open edge: include the upper endpoint, exclude the lower.
            // This is the standard rule that prevents double-counting at
            // shared vertices and keeps even-odd fill robust.
            if (p1.y > y !== p2.y > y) {
                const t = (y - p1.y) / (p2.y - p1.y);
                intersections.push(p1.x + t * (p2.x - p1.x));
            }
            j = i;
        }
        if (intersections.length < 2) continue;
        intersections.sort((a, b) => a - b);

        for (let k = 0; k + 1 < intersections.length; k += 2) {
            const x1 = Math.max(0, Math.ceil(intersections[k]!));
            const x2 = Math.min(bitmap.width - 1, Math.floor(intersections[k + 1]!));
            for (let x = x1; x <= x2; x++) {
                bitmap.setPixel(x, y, AIR);
            }
        }
    }
}
