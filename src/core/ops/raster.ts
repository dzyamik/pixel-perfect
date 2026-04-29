import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { Point } from '../types.js';

/**
 * Internal pixel-painting primitives shared by `Carve` and `Deposit`.
 *
 * These functions encapsulate the rasterization (which cells to touch);
 * the *value* written is parameterized so the two ops modules become thin
 * single-line wrappers. Consumers should not import this module directly;
 * the public surface is `Carve` and `Deposit`.
 */

/**
 * Writes `materialId` to every cell within `radius` of `(cx, cy)`.
 *
 * Inclusion test is `dx² + dy² ≤ r²` against integer cell centers, so
 * cells at exactly the radius are included. The bounding box is clipped
 * to bitmap bounds, so the operation never throws and circles that fall
 * outside the world are silent no-ops. Non-positive and NaN radii are
 * no-ops.
 *
 * @internal
 */
export function paintCircle(
    bitmap: ChunkedBitmap,
    cx: number,
    cy: number,
    radius: number,
    materialId: number,
): void {
    if (!(radius > 0)) return;

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
                bitmap.setPixel(x, y, materialId);
            }
        }
    }
}

/**
 * Writes `materialId` to every cell inside the closed polygon defined by
 * `points`. The polygon is implicitly closed (last point connects back to
 * first); fill follows the even-odd rule, so self-intersecting polygons
 * are handled deterministically. Polygons with fewer than 3 vertices are
 * no-ops; scanlines are clipped to bitmap bounds.
 *
 * @internal
 */
export function paintPolygon(
    bitmap: ChunkedBitmap,
    points: readonly Point[],
    materialId: number,
): void {
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
                bitmap.setPixel(x, y, materialId);
            }
        }
    }
}
