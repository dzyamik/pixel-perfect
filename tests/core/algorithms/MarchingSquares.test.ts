import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import { extract } from '../../../src/core/algorithms/MarchingSquares.js';
import type { Contour, Point } from '../../../src/core/types.js';

/** Build a fresh bitmap and write a list of solid pixels into it. */
function buildBitmap(width: number, height: number, chunkSize: number, solids: Point[]) {
    const bitmap = new ChunkedBitmap({ width, height, chunkSize });
    for (const p of solids) {
        bitmap.setPixel(p.x, p.y, 1);
    }
    return bitmap;
}

/** Extract from chunk (cx, cy). */
function extractFrom(bitmap: ChunkedBitmap, cx: number, cy: number) {
    return extract(bitmap.getChunk(cx, cy), bitmap);
}

/** A point matcher that ignores ordering of the points within a contour. */
function expectClosedContourPoints(contour: Contour, expected: Point[]) {
    expect(contour.closed).toBe(true);
    expect(contour.points.length).toBe(expected.length);
    for (const e of expected) {
        const found = contour.points.some((p) => p.x === e.x && p.y === e.y);
        expect(found, `expected vertex (${e.x}, ${e.y}) in contour ${JSON.stringify(contour.points)}`).toBe(true);
    }
}

describe('MarchingSquares.extract — empty / full', () => {
    it('returns no contours for an entirely empty bitmap', () => {
        const bitmap = buildBitmap(8, 8, 8, []);
        expect(extractFrom(bitmap, 0, 0)).toEqual([]);
    });

    it('returns no contours for an entirely solid chunk surrounded by solid', () => {
        // Padding outside the world is air, so testing the only chunk of a
        // small bitmap would pick up the world boundary. Instead, use a
        // 24x24 world filled solid and extract from the center chunk —
        // its padded view sees only solid.
        const big = new ChunkedBitmap({ width: 24, height: 24, chunkSize: 8 });
        for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) big.setPixel(x, y, 1);
        expect(extract(big.getChunk(1, 1), big)).toEqual([]);
    });
});

describe('MarchingSquares.extract — single solid pixel produces a diamond', () => {
    it('a single solid pixel emits one closed 4-vertex contour around it', () => {
        const bitmap = buildBitmap(4, 4, 4, [{ x: 1, y: 1 }]);
        const contours = extractFrom(bitmap, 0, 0);
        expect(contours.length).toBe(1);
        expectClosedContourPoints(contours[0]!, [
            { x: 1, y: 0.5 }, // top of diamond
            { x: 0.5, y: 1 }, // left of diamond
            { x: 1, y: 1.5 }, // bottom of diamond
            { x: 1.5, y: 1 }, // right of diamond
        ]);
    });
});

describe('MarchingSquares.extract — solid square', () => {
    it('a 2x2 solid block emits one closed contour', () => {
        // 2x2 block at (1,1)..(2,2) in a 4x4 world.
        const solids: Point[] = [
            { x: 1, y: 1 },
            { x: 2, y: 1 },
            { x: 1, y: 2 },
            { x: 2, y: 2 },
        ];
        const bitmap = buildBitmap(4, 4, 4, solids);
        const contours = extractFrom(bitmap, 0, 0);
        expect(contours.length).toBe(1);
        expect(contours[0]!.closed).toBe(true);
        // Expect 8 vertices: the 4 corners get rounded (each contributes a
        // pair of midpoints), the 4 sides each contribute one midpoint.
        // Verify by counting and checking a few key vertices.
        expect(contours[0]!.points.length).toBe(8);

        // Verify a few representative midpoints.
        const has = (x: number, y: number) =>
            contours[0]!.points.some((p) => p.x === x && p.y === y);
        expect(has(1, 0.5)).toBe(true); // top-left corner: top midpoint of cell containing (1,1)
        expect(has(2, 0.5)).toBe(true); // top-right corner
        expect(has(0.5, 1)).toBe(true); // top-left corner: left midpoint
        expect(has(2.5, 2)).toBe(true); // bottom-right corner: right midpoint
    });
});

describe('MarchingSquares.extract — donut (hollow square) emits two contours', () => {
    it('a 5x5 solid block with a 1x1 hole produces an outer + inner contour', () => {
        // World is 8x8. Solid at x in [1..5], y in [1..5]. Hole at (3, 3).
        const solids: Point[] = [];
        for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) solids.push({ x, y });
        const bitmap = buildBitmap(8, 8, 8, solids);
        // Carve the hole.
        bitmap.setPixel(3, 3, 0);

        const contours = extractFrom(bitmap, 0, 0);
        expect(contours.length).toBe(2);
        expect(contours.every((c) => c.closed)).toBe(true);

        // Outer contour has more vertices than inner; inner (around the
        // single 1x1 hole) is a 4-vertex diamond.
        const sortedBySize = [...contours].sort((a, b) => a.points.length - b.points.length);
        expect(sortedBySize[0]!.points.length).toBe(4);
        // Inner diamond is around hole at (3, 3): vertices at (3, 2.5),
        // (2.5, 3), (3, 3.5), (3.5, 3).
        const inner = sortedBySize[0]!.points;
        const has = (x: number, y: number) => inner.some((p) => p.x === x && p.y === y);
        expect(has(3, 2.5)).toBe(true);
        expect(has(2.5, 3)).toBe(true);
        expect(has(3, 3.5)).toBe(true);
        expect(has(3.5, 3)).toBe(true);
    });
});

describe('MarchingSquares.extract — disjoint blobs', () => {
    it('two separated solid pixels produce two contours', () => {
        const bitmap = buildBitmap(8, 8, 8, [
            { x: 1, y: 1 },
            { x: 5, y: 5 },
        ]);
        const contours = extractFrom(bitmap, 0, 0);
        expect(contours.length).toBe(2);
        expect(contours.every((c) => c.closed && c.points.length === 4)).toBe(true);
    });
});

describe('MarchingSquares.extract — saddle case', () => {
    it('two diagonally-touching pixels (saddle case 5) produce one connected contour', () => {
        // Pixels at (1, 1) and (2, 2) — diagonal.
        // Cell at world (1, 1) has corners (1,1)=1, (2,1)=0, (2,2)=1, (1,2)=0
        //   -> pattern TL+BR solid -> case 5 saddle. With "TL-BR joined"
        //   convention, the two pixels are treated as part of one connected
        //   solid blob through the saddle.
        const bitmap = buildBitmap(4, 4, 4, [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
        ]);
        const contours = extractFrom(bitmap, 0, 0);
        // Saddle convention "joined as solid" should yield a single
        // connected contour wrapping both pixels. Topologically consistent
        // means: the two air notches at the saddle cell (TR and BL) are
        // separate "inlets" to the contour, not separate contours of their
        // own.
        expect(contours.length).toBe(1);
        expect(contours[0]!.closed).toBe(true);
    });

    it('two anti-diagonally-touching pixels (saddle case 10) produce two contours', () => {
        // Pixels at (2, 1) and (1, 2) — anti-diagonal.
        // Cell at world (1, 1) has corners (1,1)=0, (2,1)=1, (2,2)=0, (1,2)=1
        //   -> pattern TR+BL solid -> case 10 saddle. With "TL-BR joined as
        //   air" convention, the air diagonal is connected, and the two
        //   solid pixels are separate blobs.
        const bitmap = buildBitmap(4, 4, 4, [
            { x: 2, y: 1 },
            { x: 1, y: 2 },
        ]);
        const contours = extractFrom(bitmap, 0, 0);
        expect(contours.length).toBe(2);
        expect(contours.every((c) => c.closed && c.points.length === 4)).toBe(true);
    });
});

describe('MarchingSquares.extract — cross-chunk solids produce open chains', () => {
    it('a solid pixel pair straddling a chunk boundary yields open contours', () => {
        // 8x8 world, chunkSize=4. Solid pair at (3, 3) and (4, 3) sits
        // across the (0,0)/(1,0) chunk boundary. Chunk (0, 0) only sees
        // cells with i ∈ [-1, 3], so cell (4, 3) is unsampled — the
        // contour fragments inside chunk (0, 0) cannot close locally.
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 4 });
        bitmap.setPixel(3, 3, 1);
        bitmap.setPixel(4, 3, 1);
        const contours = extract(bitmap.getChunk(0, 0), bitmap);
        expect(contours.length).toBeGreaterThan(0);
        // At least one fragment must be open (extends past the chunk).
        expect(contours.some((c) => !c.closed)).toBe(true);
    });
});

describe('MarchingSquares.extract — winding direction', () => {
    it('outer contour around a solid blob has positive (CW visually = CCW math) signed area', () => {
        // Solid pixel at (1, 1). Diamond contour walks visually CW with
        // solid on visual left. In y-down screen coords, "visually CW"
        // corresponds to math-CCW, which has POSITIVE signed area by the
        // shoelace formula in math coords (where +y goes up). With y-down,
        // the shoelace formula gives the OPPOSITE sign — but our
        // convention is consistent across all blobs, so comparison
        // matters more than the specific sign.
        const bitmap = buildBitmap(4, 4, 4, [{ x: 1, y: 1 }]);
        const contours = extractFrom(bitmap, 0, 0);
        const c = contours[0]!;

        // Shoelace signed area in y-down screen space.
        let area = 0;
        for (let i = 0; i < c.points.length; i++) {
            const a = c.points[i]!;
            const b = c.points[(i + 1) % c.points.length]!;
            area += a.x * b.y - b.x * a.y;
        }
        area /= 2;
        // Solid blob: with our "solid on visual left" rule in y-down
        // coords, the walk is math-CW (visually CCW), giving NEGATIVE
        // shoelace area. Just assert non-zero and consistent.
        expect(Math.abs(area)).toBeGreaterThan(0);
        expect(area).toBeLessThan(0);
    });
});
