import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { Island, Point } from '../types.js';

/**
 * Anchor-set strategy for {@link findIslands}.
 *
 * - `bottomRow` — every solid cell on `y = bitmap.height - 1` is treated
 *   as anchored to the static terrain. Useful for "ground-attached"
 *   destructible terrain games (Worms-style).
 * - `customPoints` — caller provides explicit anchor cells. Cells
 *   that are air or out-of-bounds are silently ignored, so callers can
 *   pass long candidate lists without pre-validating. Pass an empty
 *   list (or use {@link findAllComponents}) to get every connected
 *   solid component as an "island".
 */
export type AnchorStrategy =
    | { kind: 'bottomRow' }
    | { kind: 'customPoints'; points: readonly Point[] };

/** Neighbor offsets for 4-connected BFS (right, left, down, up). */
const DX = [1, -1, 0, 0] as const;
const DY = [0, 0, 1, -1] as const;

/**
 * Identifies all connected components of solid cells that are not
 * reachable from the supplied anchors.
 *
 * Algorithm
 * ---------
 * 1. Mark every cell reachable from an anchor via 4-connected BFS
 *    through solid (non-zero) cells; these are the "anchored" cells.
 * 2. Walk every cell of the bitmap. For each unvisited solid cell that
 *    is not anchored, run a second BFS to collect its connected
 *    component as one {@link Island}.
 *
 * Performance
 * -----------
 * O(width × height). The architecture doc § Flood fill targets ~5 ms
 * on a 4 MB world; this implementation is per-cell `getPixel` and
 * matches that ballpark. Optimization to iterate chunks directly is
 * possible later if profiling shows it's needed.
 *
 * The two BFS passes are intentional: it lets us treat "anchored" as a
 * boolean mask rather than a sentinel value, which makes the second
 * pass simpler and avoids accidentally claiming anchored cells as
 * islands.
 */
export function findIslands(bitmap: ChunkedBitmap, anchor: AnchorStrategy): Island[] {
    const W = bitmap.width;
    const H = bitmap.height;
    const cells = W * H;

    const anchored = new Uint8Array(cells);

    // --- Pass 1: BFS from anchors. ---
    const queue = new Int32Array(cells);
    let qHead = 0;
    let qTail = 0;

    const seed = (x: number, y: number): void => {
        if (x < 0 || x >= W || y < 0 || y >= H) return;
        const idx = y * W + x;
        if (anchored[idx]) return;
        if (bitmap.getPixel(x, y) === 0) return;
        anchored[idx] = 1;
        queue[qTail++] = idx;
    };

    if (anchor.kind === 'bottomRow') {
        for (let x = 0; x < W; x++) seed(x, H - 1);
    } else {
        for (const p of anchor.points) seed(p.x, p.y);
    }

    while (qHead < qTail) {
        const idx = queue[qHead++]!;
        const x = idx % W;
        const y = (idx - x) / W;
        for (let i = 0; i < 4; i++) {
            const nx = x + DX[i]!;
            const ny = y + DY[i]!;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const nIdx = ny * W + nx;
            if (anchored[nIdx]) continue;
            if (bitmap.getPixel(nx, ny) === 0) continue;
            anchored[nIdx] = 1;
            queue[qTail++] = nIdx;
        }
    }

    // --- Pass 2: collect every non-anchored solid component as an island. ---
    const visited = anchored; // reuse: anchored cells are already "visited"
    const islands: Island[] = [];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const idx = y * W + x;
            if (visited[idx]) continue;
            if (bitmap.getPixel(x, y) === 0) continue;

            // New island. BFS to collect.
            qHead = 0;
            qTail = 0;
            queue[qTail++] = idx;
            visited[idx] = 1;

            const islandCells: Point[] = [];
            let minX = x;
            let maxX = x;
            // Row-major iteration in this pass guarantees the BFS start is
            // the topmost cell of its connected component, so `minY` cannot
            // decrease during the BFS — fix it once.
            const minY = y;
            let maxY = y;

            while (qHead < qTail) {
                const cIdx = queue[qHead++]!;
                const cx = cIdx % W;
                const cy = (cIdx - cx) / W;
                islandCells.push({ x: cx, y: cy });
                if (cx < minX) minX = cx;
                if (cx > maxX) maxX = cx;
                if (cy > maxY) maxY = cy;

                for (let i = 0; i < 4; i++) {
                    const nx = cx + DX[i]!;
                    const ny = cy + DY[i]!;
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    const nIdx = ny * W + nx;
                    if (visited[nIdx]) continue;
                    if (bitmap.getPixel(nx, ny) === 0) continue;
                    visited[nIdx] = 1;
                    queue[qTail++] = nIdx;
                }
            }

            islands.push({ cells: islandCells, bounds: { minX, maxX, minY, maxY } });
        }
    }

    return islands;
}

/**
 * Returns every connected solid component of the bitmap, regardless of
 * whether it is anchored to anything.
 *
 * This is just `findIslands(bitmap, { kind: 'customPoints', points: [] })`
 * (no anchors → every solid cell is in some "island"), exposed under a
 * clearer name because the physics layer's terrain-rebuild path needs
 * the full component list, not just the detached subset.
 */
export function findAllComponents(bitmap: ChunkedBitmap): Island[] {
    return findIslands(bitmap, { kind: 'customPoints', points: [] });
}
