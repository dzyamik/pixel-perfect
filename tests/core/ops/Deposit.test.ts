import { beforeEach, describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import * as Carve from '../../../src/core/ops/Carve.js';
import * as Deposit from '../../../src/core/ops/Deposit.js';
import type { Point } from '../../../src/core/types.js';

function countPixels(bitmap: ChunkedBitmap, materialId: number): number {
    let count = 0;
    for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
            if (bitmap.getPixel(x, y) === materialId) count++;
        }
    }
    return count;
}

describe('Deposit.circle', () => {
    let bitmap: ChunkedBitmap;

    beforeEach(() => {
        bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
    });

    it('writes the supplied material id to disc cells', () => {
        Deposit.circle(bitmap, 32, 32, 5, 1);
        expect(bitmap.getPixel(32, 32)).toBe(1);
        expect(bitmap.getPixel(37, 32)).toBe(1); // boundary
    });

    it('overwrites previously deposited material', () => {
        Deposit.circle(bitmap, 32, 32, 5, 1);
        Deposit.circle(bitmap, 32, 32, 3, 2); // smaller, different id, overlapping
        expect(bitmap.getPixel(32, 32)).toBe(2); // center now id 2
        expect(bitmap.getPixel(36, 32)).toBe(1); // outside the smaller disc, still id 1
    });

    it('produces an approximately circular pixel count (πr²)', () => {
        const radius = 10;
        Deposit.circle(bitmap, 32, 32, radius, 7);
        const filled = countPixels(bitmap, 7);
        const expected = Math.PI * radius * radius;
        expect(filled).toBeGreaterThan(expected * 0.9);
        expect(filled).toBeLessThan(expected * 1.1);
    });

    it('clips at world boundaries without throwing', () => {
        expect(() => Deposit.circle(bitmap, 0, 0, 10, 5)).not.toThrow();
        expect(bitmap.getPixel(0, 0)).toBe(5);
        // Out-of-world coords are silently clipped.
        expect(() => Deposit.circle(bitmap, 1000, 1000, 5, 5)).not.toThrow();
    });

    it('is a no-op for radius ≤ 0 and NaN', () => {
        Deposit.circle(bitmap, 32, 32, 0, 1);
        Deposit.circle(bitmap, 32, 32, -5, 1);
        Deposit.circle(bitmap, 32, 32, NaN, 1);
        expect(countPixels(bitmap, 1)).toBe(0);
    });

    it('rejects material ids outside 0..255 (via setPixel)', () => {
        expect(() => Deposit.circle(bitmap, 32, 32, 5, 256)).toThrow();
        expect(() => Deposit.circle(bitmap, 32, 32, 5, -1)).toThrow();
    });

    it('dirties only the chunks the disc touches', () => {
        Deposit.circle(bitmap, 16, 16, 4, 1);
        expect(bitmap.getChunk(0, 0).dirty).toBe(true);
        expect(bitmap.getChunk(1, 0).dirty).toBe(false);
        expect(bitmap.getChunk(0, 1).dirty).toBe(false);
        expect(bitmap.getChunk(1, 1).dirty).toBe(false);
    });
});

describe('Deposit.polygon', () => {
    let bitmap: ChunkedBitmap;

    beforeEach(() => {
        bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
    });

    it('fills a square interior with the supplied material id', () => {
        const square: Point[] = [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
        ];
        Deposit.polygon(bitmap, square, 3);
        expect(bitmap.getPixel(15, 15)).toBe(3);
        expect(bitmap.getPixel(9, 15)).toBe(0); // outside, untouched
    });

    it('respects even-odd fill for self-intersecting polygons', () => {
        const bowtie: Point[] = [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 10, y: 30 },
            { x: 30, y: 30 },
        ];
        Deposit.polygon(bitmap, bowtie, 9);
        // Top and bottom lobes filled.
        expect(bitmap.getPixel(20, 12)).toBe(9);
        expect(bitmap.getPixel(20, 28)).toBe(9);
        // Side triangles untouched.
        expect(bitmap.getPixel(12, 20)).toBe(0);
        expect(bitmap.getPixel(28, 20)).toBe(0);
    });

    it('is a no-op for polygons with fewer than 3 vertices', () => {
        Deposit.polygon(bitmap, [], 1);
        Deposit.polygon(bitmap, [{ x: 10, y: 10 }], 1);
        Deposit.polygon(
            bitmap,
            [
                { x: 10, y: 10 },
                { x: 20, y: 20 },
            ],
            1,
        );
        expect(countPixels(bitmap, 1)).toBe(0);
    });

    it('clips polygons that straddle the world boundary', () => {
        const partlyOutside: Point[] = [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 },
        ];
        expect(() => Deposit.polygon(bitmap, partlyOutside, 4)).not.toThrow();
        expect(bitmap.getPixel(5, 5)).toBe(4);
        expect(bitmap.getPixel(11, 5)).toBe(0);
    });

    it('rejects material ids outside 0..255 (via setPixel)', () => {
        const square: Point[] = [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
        ];
        expect(() => Deposit.polygon(bitmap, square, 999)).toThrow();
    });

    it('dirties chunks that the polygon spans', () => {
        const spanning: Point[] = [
            { x: 20, y: 20 },
            { x: 44, y: 20 },
            { x: 44, y: 44 },
            { x: 20, y: 44 },
        ];
        Deposit.polygon(bitmap, spanning, 1);
        expect(bitmap.getChunk(0, 0).dirty).toBe(true);
        expect(bitmap.getChunk(1, 0).dirty).toBe(true);
        expect(bitmap.getChunk(0, 1).dirty).toBe(true);
        expect(bitmap.getChunk(1, 1).dirty).toBe(true);
    });
});

describe('Carve and Deposit are complementary', () => {
    it('Deposit then Carve at the same location restores air', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        Deposit.circle(bitmap, 32, 32, 5, 1);
        expect(bitmap.getPixel(32, 32)).toBe(1);

        Carve.circle(bitmap, 32, 32, 5);
        expect(bitmap.getPixel(32, 32)).toBe(0);
    });
});
