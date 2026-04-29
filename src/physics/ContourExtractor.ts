import {
    ChunkedBitmap,
    DouglasPeucker,
    MarchingSquares,
} from '../core/index.js';
import type { Contour, Island } from '../core/index.js';

/**
 * Internal utility: extract one or more contours that bound a single
 * connected component, in the source bitmap's world coordinates.
 *
 * Implementation: build a temporary `ChunkedBitmap` sized to the
 * component's bounding box plus 1 pixel of padding, copy the component's
 * cells into it, run marching squares on every chunk of the temp bitmap,
 * translate the resulting contours back into source coordinates, and
 * simplify with Douglas-Peucker. The temp-bitmap approach is simple and
 * correct — MS sees the component surrounded by air, so contours close
 * locally regardless of how the component sits in the source bitmap's
 * chunk grid.
 *
 * This is shared by {@link DebrisDetector} (which extracts contours for
 * detached components only) and the {@link DeferredRebuildQueue} global
 * rebuild path (which extracts for *every* component to produce
 * cross-chunk-safe terrain colliders).
 *
 * @param component The connected component to extract.
 * @param sourceBitmap The bitmap the component was found in (used to
 *                     read material ids when copying cells).
 * @param epsilon Douglas-Peucker simplification epsilon in pixels.
 * @returns Closed contours first, then any open ones, each sorted by
 *          descending vertex count. For a simple blob this is a single
 *          closed outer contour; for a donut, it's the outer plus inner
 *          hole(s).
 */
export function componentToContours(
    component: Island,
    sourceBitmap: ChunkedBitmap,
    epsilon: number,
): Contour[] {
    const PADDING = 1;
    const minX = component.bounds.minX - PADDING;
    const minY = component.bounds.minY - PADDING;
    const widthPx = component.bounds.maxX - component.bounds.minX + 1 + 2 * PADDING;
    const heightPx = component.bounds.maxY - component.bounds.minY + 1 + 2 * PADDING;

    // Use a SINGLE chunk for the temp bitmap so marching squares sees the
    // entire component in one extraction pass. If we re-used the source
    // bitmap's chunk size we'd just push the cross-chunk-open-chain
    // problem one level down, since a component larger than chunkSize
    // would still produce open fragments per temp chunk.
    const tempChunkSize = Math.max(widthPx, heightPx);

    const temp = new ChunkedBitmap({
        width: tempChunkSize,
        height: tempChunkSize,
        chunkSize: tempChunkSize,
    });
    for (const cell of component.cells) {
        const lx = cell.x - minX;
        const ly = cell.y - minY;
        const m = sourceBitmap.getPixel(cell.x, cell.y);
        if (m > 0) temp.setPixel(lx, ly, m);
    }

    const contours: Contour[] = [];
    for (const chunk of temp.chunks) {
        if (!chunk.dirty) continue;
        for (const c of MarchingSquares.extract(chunk, temp)) {
            const translated: Contour = {
                points: c.points.map((p) => ({ x: p.x + minX, y: p.y + minY })),
                closed: c.closed,
            };
            contours.push(DouglasPeucker.simplify(translated, epsilon));
        }
    }

    contours.sort((a, b) => {
        if (a.closed !== b.closed) return a.closed ? -1 : 1;
        return b.points.length - a.points.length;
    });

    return contours;
}
