import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { Chunk, Contour, Point } from '../types.js';

/**
 * Marching squares contour extraction for one chunk.
 *
 * The algorithm samples the chunk plus a one-pixel border into the
 * neighboring chunks (per `01-architecture.md`: "Pad each chunk by 1 pixel
 * on all sides during sampling"). Outside the world is treated as air so
 * the contour closes at world edges.
 *
 * Coordinate system
 * -----------------
 * Each cell is defined by 4 corner samples (pixel centers at integer
 * coords). Within a cell at world position `(cellX, cellY)` the 4 corners
 * are at `(cellX, cellY)` (TL), `(cellX+1, cellY)` (TR), `(cellX+1,
 * cellY+1)` (BR), `(cellX, cellY+1)` (BL).
 *
 * Output vertices lie on the midpoints of cell edges (half-integer world
 * coords): T = `(cellX+0.5, cellY)`, R = `(cellX+1, cellY+0.5)`,
 * B = `(cellX+0.5, cellY+1)`, L = `(cellX, cellY+0.5)`.
 *
 * Winding convention
 * ------------------
 * Each segment is emitted so that solid is on the visually-LEFT side of
 * the walker (in screen y-down coords). After stitching, closed contours
 * walk visually clockwise around solid blobs, and visually
 * counter-clockwise around air pockets — this is consistent with the
 * Box2D chain-shape orientation that the physics adapter will consume.
 *
 * Saddle-point convention
 * -----------------------
 * Per `01-architecture.md`: "we use 'connect upper-left to lower-right
 * always'." The TL-BR diagonal is treated as joined. Concretely:
 *
 *   - Case 5 (TL+BR solid, TR+BL air): TL-BR are joined as solid; the
 *     two air corners (TR, BL) are isolated as separate notches.
 *   - Case 10 (TR+BL solid, TL+BR air): TL-BR are joined as air; the
 *     two solid corners (TR, BL) are isolated as separate blobs.
 *
 * This rule is applied uniformly for every saddle in the chunk so
 * iterating multiple chunks yields topologically consistent stitching.
 */

/** Edge labels for cell-edge midpoints. */
const TOP = 0;
const RIGHT = 1;
const BOTTOM = 2;
const LEFT = 3;

type EdgeLabel = typeof TOP | typeof RIGHT | typeof BOTTOM | typeof LEFT;
type CaseSegments = readonly (readonly [EdgeLabel, EdgeLabel])[];

/**
 * 16-case lookup: index = `TL | TR<<1 | BR<<2 | BL<<3` of the corner
 * solid bits. Each entry is the list of segments to emit (0, 1, or 2).
 * Each segment is `[from, to]` edge labels, walked so solid is on the
 * walker's visual left.
 */
const LOOKUP: readonly CaseSegments[] = [
    /* 0  0000 */ [],
    /* 1  0001 TL */ [[LEFT, TOP]],
    /* 2  0010 TR */ [[TOP, RIGHT]],
    /* 3  0011 TL+TR */ [[LEFT, RIGHT]],
    /* 4  0100 BR */ [[RIGHT, BOTTOM]],
    /* 5  0101 saddle (TL+BR) */ [
        [RIGHT, TOP],
        [LEFT, BOTTOM],
    ],
    /* 6  0110 TR+BR */ [[TOP, BOTTOM]],
    /* 7  0111 TL+TR+BR (BL air) */ [[LEFT, BOTTOM]],
    /* 8  1000 BL */ [[BOTTOM, LEFT]],
    /* 9  1001 TL+BL */ [[BOTTOM, TOP]],
    /* 10 1010 saddle (TR+BL) */ [
        [TOP, RIGHT],
        [BOTTOM, LEFT],
    ],
    /* 11 1011 TL+TR+BL (BR air) */ [[BOTTOM, RIGHT]],
    /* 12 1100 BR+BL */ [[RIGHT, LEFT]],
    /* 13 1101 TL+BR+BL (TR air) */ [[RIGHT, TOP]],
    /* 14 1110 TR+BR+BL (TL air) */ [[TOP, LEFT]],
    /* 15 1111 */ [],
];

/** Compute the world-space midpoint of one edge of cell at `(cellX, cellY)`. */
function edgeMidpoint(label: EdgeLabel, cellX: number, cellY: number): Point {
    switch (label) {
        case TOP:
            return { x: cellX + 0.5, y: cellY };
        case RIGHT:
            return { x: cellX + 1, y: cellY + 0.5 };
        case BOTTOM:
            return { x: cellX + 0.5, y: cellY + 1 };
        case LEFT:
            return { x: cellX, y: cellY + 0.5 };
    }
}

/**
 * Stable string key for a half-integer Point. Multiplying by 2 lifts
 * vertex coordinates to integers, so equality checks are exact and don't
 * suffer floating-point drift across cells.
 */
function pointKey(p: Point): string {
    return `${p.x * 2}|${p.y * 2}`;
}

/**
 * Walks the emitted segments into closed (and, when truncated by an
 * unsampled boundary, open) contour polygons.
 *
 * In a topologically valid marching-squares output every edge midpoint
 * is the start of at most one segment (the contour is a 1-manifold;
 * saddle cells emit two segments with disjoint endpoints), so a single
 * `Map<key, segmentIndex>` suffices for the chain-follow lookup.
 */
function stitchSegments(segments: readonly (readonly [Point, Point])[]): Contour[] {
    if (segments.length === 0) return [];

    const startMap = new Map<string, number>();
    for (let i = 0; i < segments.length; i++) {
        startMap.set(pointKey(segments[i]![0]), i);
    }

    const visited = new Array<boolean>(segments.length).fill(false);
    const contours: Contour[] = [];

    for (let i = 0; i < segments.length; i++) {
        if (visited[i]) continue;
        const points: Point[] = [];
        let current = i;

        while (true) {
            visited[current] = true;
            points.push(segments[current]![0]);

            const endP = segments[current]![1];
            if (pointKey(endP) === pointKey(segments[i]![0])) {
                contours.push({ points, closed: true });
                break;
            }

            const next = startMap.get(pointKey(endP));
            if (next === undefined || visited[next]) {
                // Open chain: the contour exits the sampled region (the
                // chunk's 1-pixel padding) without closing. Phase 2 will
                // stitch these across chunks.
                points.push(endP);
                contours.push({ points, closed: false });
                break;
            }
            current = next;
        }
    }

    return contours;
}

/**
 * Extracts contour polygons from the bitmap region around `chunk`.
 *
 * The returned contours use world coordinates (per CLAUDE.md hard rule
 * #4). Each contour's `closed` flag indicates whether the polyline closes
 * within the sampled region; contours that pass through a chunk boundary
 * may be reported as `closed: false` from a single chunk's perspective
 * and will be stitched across chunks by the physics adapter (Phase 2).
 *
 * @param chunk  The chunk whose contours to extract.
 * @param bitmap The owning bitmap. Used to sample the 1-pixel padding
 *               from neighboring chunks.
 */
export function extract(chunk: Chunk, bitmap: ChunkedBitmap): Contour[] {
    const S = bitmap.chunkSize;
    const wx0 = chunk.cx * S;
    const wy0 = chunk.cy * S;

    const segments: [Point, Point][] = [];

    // Iterate cells. With 1-pixel padding, cells span i,j ∈ [-1, S-1]:
    // the cell at (i, j) has corners at world (wx0+i, wy0+j) through
    // (wx0+i+1, wy0+j+1).
    for (let j = -1; j < S; j++) {
        for (let i = -1; i < S; i++) {
            const cellX = wx0 + i;
            const cellY = wy0 + j;
            const tl = bitmap.getPixel(cellX, cellY);
            const tr = bitmap.getPixel(cellX + 1, cellY);
            const br = bitmap.getPixel(cellX + 1, cellY + 1);
            const bl = bitmap.getPixel(cellX, cellY + 1);
            const caseIndex =
                (tl > 0 ? 1 : 0) | (tr > 0 ? 2 : 0) | (br > 0 ? 4 : 0) | (bl > 0 ? 8 : 0);
            const segs = LOOKUP[caseIndex]!;
            for (const [from, to] of segs) {
                segments.push([edgeMidpoint(from, cellX, cellY), edgeMidpoint(to, cellX, cellY)]);
            }
        }
    }

    return stitchSegments(segments);
}
