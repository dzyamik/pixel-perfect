import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import { findIslands } from '../../../src/core/algorithms/FloodFill.js';
import type { Point } from '../../../src/core/types.js';

function fillCells(bitmap: ChunkedBitmap, cells: Point[], materialId = 1): void {
    for (const c of cells) bitmap.setPixel(c.x, c.y, materialId);
}

describe('FloodFill.findIslands — bottomRow anchor', () => {
    it('returns no islands for an empty bitmap', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        expect(findIslands(bitmap, { kind: 'bottomRow' })).toEqual([]);
    });

    it('treats a column connected to the bottom row as anchored (no islands)', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        // Vertical bar from y=2 down to y=7.
        for (let y = 2; y < 8; y++) bitmap.setPixel(3, y, 1);
        expect(findIslands(bitmap, { kind: 'bottomRow' })).toEqual([]);
    });

    it('detects a single floating pixel as a one-cell island', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 1);
        const islands = findIslands(bitmap, { kind: 'bottomRow' });
        expect(islands.length).toBe(1);
        expect(islands[0]!.cells).toEqual([{ x: 3, y: 3 }]);
        expect(islands[0]!.bounds).toEqual({ minX: 3, maxX: 3, minY: 3, maxY: 3 });
    });

    it('detects two disjoint floating regions as two islands', () => {
        const bitmap = new ChunkedBitmap({ width: 16, height: 16, chunkSize: 16 });
        bitmap.setPixel(2, 2, 1);
        bitmap.setPixel(3, 2, 1);
        bitmap.setPixel(2, 3, 1);
        bitmap.setPixel(10, 10, 2);
        const islands = findIslands(bitmap, { kind: 'bottomRow' });
        expect(islands.length).toBe(2);
        const sorted = [...islands].sort((a, b) => a.cells.length - b.cells.length);
        expect(sorted[0]!.cells.length).toBe(1);
        expect(sorted[1]!.cells.length).toBe(3);
    });

    it('uses 4-connectivity (diagonals do not connect)', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        // Diagonal pair, not connected by 4-connectivity.
        bitmap.setPixel(2, 2, 1);
        bitmap.setPixel(3, 3, 1);
        const islands = findIslands(bitmap, { kind: 'bottomRow' });
        expect(islands.length).toBe(2);
    });

    it('reports correct bounds when the island extends left/up of its BFS start', () => {
        // BFS pass 2 iterates in row-major (y, x) order, so the start cell
        // is always the lexicographically-smallest. For minX / minY to be
        // updated DURING the BFS, the island must have cells with smaller
        // x than the start (reachable via a downward detour).
        //
        //   .##.
        //   .#..
        //   ##..
        //
        // Iteration finds (1, 0). BFS later reaches (0, 2), which has
        // cx < initial minX, exercising the "cx < minX" branch.
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(1, 0, 1);
        bitmap.setPixel(2, 0, 1);
        bitmap.setPixel(1, 1, 1);
        bitmap.setPixel(0, 2, 1);
        bitmap.setPixel(1, 2, 1);
        const islands = findIslands(bitmap, { kind: 'bottomRow' });
        expect(islands.length).toBe(1);
        expect(islands[0]!.bounds).toEqual({ minX: 0, maxX: 2, minY: 0, maxY: 2 });
    });

    it('reports correct bounds for an L-shaped island', () => {
        const bitmap = new ChunkedBitmap({ width: 16, height: 16, chunkSize: 16 });
        // L shape: (4,4)..(4,7) vertical, plus (4,7)..(7,7) horizontal.
        for (let y = 4; y <= 7; y++) bitmap.setPixel(4, y, 1);
        for (let x = 5; x <= 7; x++) bitmap.setPixel(x, 7, 1);
        const islands = findIslands(bitmap, { kind: 'bottomRow' });
        expect(islands.length).toBe(1);
        expect(islands[0]!.bounds).toEqual({ minX: 4, maxX: 7, minY: 4, maxY: 7 });
        expect(islands[0]!.cells.length).toBe(7);
    });
});

describe('FloodFill.findIslands — customPoints anchor', () => {
    it('treats only cells reachable from the supplied anchors as anchored', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        // Two horizontal bars, neither touching the bottom row.
        fillCells(bitmap, [
            { x: 0, y: 2 },
            { x: 1, y: 2 },
            { x: 2, y: 2 },
            { x: 5, y: 5 },
            { x: 6, y: 5 },
        ]);
        const islands = findIslands(bitmap, {
            kind: 'customPoints',
            points: [{ x: 0, y: 2 }],
        });
        // Anchor on the first bar makes it static; the second bar is an island.
        expect(islands.length).toBe(1);
        expect(islands[0]!.cells.length).toBe(2);
    });

    it('ignores anchors that point to air', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 1);
        const islands = findIslands(bitmap, {
            kind: 'customPoints',
            points: [{ x: 0, y: 0 }], // air
        });
        // No anchor takes effect; the solid pixel is therefore an island.
        expect(islands.length).toBe(1);
        expect(islands[0]!.cells).toEqual([{ x: 3, y: 3 }]);
    });

    it('treats out-of-bounds anchors as a silent no-op (all 4 axes)', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 1);
        const islands = findIslands(bitmap, {
            kind: 'customPoints',
            points: [
                { x: -1, y: 0 }, // x < 0
                { x: 8, y: 0 }, // x >= W
                { x: 0, y: -1 }, // y < 0
                { x: 0, y: 8 }, // y >= H
            ],
        });
        expect(islands.length).toBe(1);
    });

    it('handles duplicate anchor points', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 1);
        const islands = findIslands(bitmap, {
            kind: 'customPoints',
            points: [
                { x: 3, y: 3 }, // anchored
                { x: 3, y: 3 }, // duplicate — exercises the "already-anchored" early return in seed
            ],
        });
        expect(islands).toEqual([]);
    });

    it('multiple anchors correctly merge into one anchored region', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        // Two disconnected solid blocks.
        fillCells(bitmap, [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
        ]);
        const islands = findIslands(bitmap, {
            kind: 'customPoints',
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 },
            ],
        });
        // Both are anchored → no islands.
        expect(islands).toEqual([]);
    });
});

describe('FloodFill.findIslands — boundary BFS', () => {
    it('BFS terminates at all four world edges', () => {
        // Solid cells touching every edge: top-left, top-right, bottom-left,
        // bottom-right corners. Anchor at center makes none reachable, so
        // each becomes its own island. The BFS at corners exercises every
        // out-of-bounds branch in the neighbor loop.
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(0, 0, 1); // top-left
        bitmap.setPixel(7, 0, 1); // top-right
        bitmap.setPixel(0, 7, 1); // bottom-left
        bitmap.setPixel(7, 7, 1); // bottom-right
        const islands = findIslands(bitmap, {
            kind: 'customPoints',
            points: [{ x: 4, y: 4 }],
        });
        // None of the corners is reachable from the center anchor (and
        // anchor at (4,4) is air, so it's a no-op anchor). Each corner
        // becomes its own island.
        expect(islands.length).toBe(4);
        for (const island of islands) expect(island.cells.length).toBe(1);
    });
});

describe('FloodFill.findIslands — material handling', () => {
    it('treats any non-zero material as solid (mixed materials connect)', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        // 4-connected chain mixing two materials.
        bitmap.setPixel(3, 3, 1);
        bitmap.setPixel(4, 3, 2);
        bitmap.setPixel(4, 4, 1);
        const islands = findIslands(bitmap, { kind: 'bottomRow' });
        expect(islands.length).toBe(1);
        expect(islands[0]!.cells.length).toBe(3);
    });
});
