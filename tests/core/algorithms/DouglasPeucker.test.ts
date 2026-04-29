import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import { simplify } from '../../../src/core/algorithms/DouglasPeucker.js';
import { extract } from '../../../src/core/algorithms/MarchingSquares.js';
import * as Deposit from '../../../src/core/ops/Deposit.js';
import type { Contour, Point } from '../../../src/core/types.js';

describe('DouglasPeucker.simplify — open polylines', () => {
    it('returns the input unchanged for fewer than 3 points', () => {
        const a: Contour = { points: [], closed: false };
        const b: Contour = { points: [{ x: 0, y: 0 }], closed: false };
        const c: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
            ],
            closed: false,
        };
        expect(simplify(a, 1).points).toEqual([]);
        expect(simplify(b, 1).points).toEqual([{ x: 0, y: 0 }]);
        expect(simplify(c, 1).points).toEqual([
            { x: 0, y: 0 },
            { x: 10, y: 10 },
        ]);
    });

    it('drops collinear interior points (within ε)', () => {
        const polyline: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
                { x: 10, y: 0 },
                { x: 15, y: 0 },
            ],
            closed: false,
        };
        const result = simplify(polyline, 0.5);
        expect(result.points).toEqual([
            { x: 0, y: 0 },
            { x: 15, y: 0 },
        ]);
        expect(result.closed).toBe(false);
    });

    it('keeps a vertex that is farther than ε from the chord', () => {
        const polyline: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 5 }, // 5 units away from the x-axis chord
                { x: 10, y: 0 },
            ],
            closed: false,
        };
        const result = simplify(polyline, 1);
        expect(result.points).toEqual(polyline.points);
    });

    it('preserves endpoints exactly', () => {
        const polyline: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 50, y: 0.1 },
                { x: 100, y: 0.2 },
                { x: 200, y: 0 },
            ],
            closed: false,
        };
        const result = simplify(polyline, 1); // far above 0.2
        expect(result.points[0]).toEqual({ x: 0, y: 0 });
        expect(result.points[result.points.length - 1]).toEqual({ x: 200, y: 0 });
    });
});

describe('DouglasPeucker.simplify — closed contours', () => {
    it('returns < 3-vertex closed input unchanged', () => {
        const tri: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
            ],
            closed: true,
        };
        expect(simplify(tri, 1).points).toEqual(tri.points);
    });

    it('preserves a non-degenerate triangle', () => {
        const tri: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 5, y: 10 },
            ],
            closed: true,
        };
        const result = simplify(tri, 0.1);
        expect(result.closed).toBe(true);
        expect(result.points.length).toBe(3);
    });

    it('refuses to degenerate a closed contour below 3 vertices', () => {
        // All-collinear "closed contour" — would simplify to 2 points
        // under naive DP. Implementation must keep ≥ 3.
        const collinear: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 5, y: 0 },
                { x: 10, y: 0 },
                { x: 15, y: 0 },
            ],
            closed: true,
        };
        const result = simplify(collinear, 0.5);
        expect(result.closed).toBe(true);
        expect(result.points.length).toBeGreaterThanOrEqual(3);
    });

    it('reduces a marching-squares circle contour by ≥ 80% with ε = 1', () => {
        // Build a Deposit.circle on a fresh bitmap, then extract its
        // contour and simplify.
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 64 });
        Deposit.circle(bitmap, 32, 32, 20, 1);
        const contours = extract(bitmap.getChunk(0, 0), bitmap);
        expect(contours.length).toBe(1);
        const original = contours[0]!;
        expect(original.closed).toBe(true);

        const simplified = simplify(original, 1);
        expect(simplified.closed).toBe(true);

        const reductionPct = 1 - simplified.points.length / original.points.length;
        expect(reductionPct).toBeGreaterThanOrEqual(0.8);

        // Verify the simplified polygon roughly matches the original
        // bounding box (otherwise we may have lost shape entirely).
        const xs = simplified.points.map((p) => p.x);
        const ys = simplified.points.map((p) => p.y);
        expect(Math.min(...xs)).toBeLessThan(15);
        expect(Math.max(...xs)).toBeGreaterThan(49);
        expect(Math.min(...ys)).toBeLessThan(15);
        expect(Math.max(...ys)).toBeGreaterThan(49);
    });
});

describe('DouglasPeucker.simplify — edge cases', () => {
    it('handles ε = 0 (drops only exactly-collinear interior points)', () => {
        const collinearOpen: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
            ],
            closed: false,
        };
        const result = simplify(collinearOpen, 0);
        expect(result.points).toEqual([
            { x: 0, y: 0 },
            { x: 2, y: 0 },
        ]);
    });

    it('handles a degenerate chord (coincident endpoints) by using point-to-point distance', () => {
        // Open polyline whose endpoints are the same point. The chord has
        // zero length; standard perp-distance is undefined, so the
        // implementation must fall back to point-to-point distance.
        const loop: Point[] = [
            { x: 0, y: 0 },
            { x: 5, y: 5 },
            { x: 0, y: 10 },
            { x: 0, y: 0 },
        ];
        const result = simplify({ points: loop, closed: false }, 1);
        // The middle vertices are far from the (0,0)-(0,0) "chord" so
        // they should be retained.
        expect(result.points.length).toBeGreaterThan(2);
    });
});
