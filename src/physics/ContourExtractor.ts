import {
    ChunkedBitmap,
    DouglasPeucker,
    MarchingSquares,
} from '../core/index.js';
import type { Chunk, Contour, Island } from '../core/index.js';

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

/**
 * Extracts the contours of one chunk's solid pixels in isolation,
 * treating everything outside the chunk as air. Used by
 * `DeferredRebuildQueue` to maintain one static body per chunk —
 * carves on one chunk only invalidate that chunk's body, leaving
 * contacts on other chunks' bodies intact.
 *
 * Implementation: build a `(chunkSize + 2)²` single-chunk temp bitmap
 * with 1 pixel of air padding, copy the chunk's pixels into the
 * inner region, run marching squares on the temp, translate vertex
 * coordinates back to source-bitmap space, and Douglas-Peucker simplify.
 *
 * Why "treat outside as air" rather than reusing the source bitmap's
 * neighbors: with two-sided triangulated polygons (the
 * `contourToTriangles` path), each chunk's solid mass becomes its own
 * closed polygon. Two adjacent chunks each holding a polygon along
 * a shared boundary edge work correctly — a body resting on top of
 * the combined terrain doesn't penetrate either polygon, and a body
 * sliding across the seam transitions from one polygon's contact to
 * the other's. Cross-chunk stitching (Phase 2.5) is no longer required.
 *
 * @param chunk Chunk whose solid pixels to extract.
 * @param sourceBitmap The bitmap holding the chunk.
 * @param epsilon Douglas-Peucker simplification epsilon in pixels.
 */
export function chunkToContours(
    chunk: Chunk,
    sourceBitmap: ChunkedBitmap,
    epsilon: number,
): Contour[] {
    const PADDING = 1;
    const cs = sourceBitmap.chunkSize;
    const tempSize = cs + 2 * PADDING;

    const temp = new ChunkedBitmap({
        width: tempSize,
        height: tempSize,
        chunkSize: tempSize,
    });
    const cx0 = chunk.cx * cs;
    const cy0 = chunk.cy * cs;
    for (let y = 0; y < cs; y++) {
        for (let x = 0; x < cs; x++) {
            const m = sourceBitmap.getPixel(cx0 + x, cy0 + y);
            if (m > 0) temp.setPixel(x + PADDING, y + PADDING, m);
        }
    }

    const tempChunk = temp.chunks[0];
    if (tempChunk === undefined) return [];

    const contours: Contour[] = [];
    for (const c of MarchingSquares.extract(tempChunk, temp)) {
        const translated: Contour = {
            points: c.points.map((p) => ({
                x: p.x - PADDING + cx0,
                y: p.y - PADDING + cy0,
            })),
            closed: c.closed,
        };
        contours.push(DouglasPeucker.simplify(translated, epsilon));
    }

    contours.sort((a, b) => {
        if (a.closed !== b.closed) return a.closed ? -1 : 1;
        return b.points.length - a.points.length;
    });

    return contours;
}
