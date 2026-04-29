import { beforeEach, describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import * as Carve from '../../../src/core/ops/Carve.js';
import type { Point } from '../../../src/core/types.js';

/** Fills the entire bitmap with a single material id (used as a setup helper). */
function fillSolid(bitmap: ChunkedBitmap, materialId: number): void {
    for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
            bitmap.setPixel(x, y, materialId);
        }
    }
}

/** Counts pixels with the given material id across the whole bitmap. */
function countPixels(bitmap: ChunkedBitmap, materialId: number): number {
    let count = 0;
    for (let y = 0; y < bitmap.height; y++) {
        for (let x = 0; x < bitmap.width; x++) {
            if (bitmap.getPixel(x, y) === materialId) count++;
        }
    }
    return count;
}

describe('Carve.circle', () => {
    let bitmap: ChunkedBitmap;

    beforeEach(() => {
        bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
    });

    describe('basic shape', () => {
        it('writes 0 to the center cell', () => {
            fillSolid(bitmap, 1);
            Carve.circle(bitmap, 32, 32, 5);
            expect(bitmap.getPixel(32, 32)).toBe(0);
        });

        it('writes 0 to cells at exactly the radius distance', () => {
            fillSolid(bitmap, 1);
            Carve.circle(bitmap, 32, 32, 5);
            // (32+5, 32) is at distance 5 from center → included.
            expect(bitmap.getPixel(37, 32)).toBe(0);
            expect(bitmap.getPixel(32, 37)).toBe(0);
            expect(bitmap.getPixel(27, 32)).toBe(0);
            expect(bitmap.getPixel(32, 27)).toBe(0);
        });

        it('does not touch cells just outside the radius', () => {
            fillSolid(bitmap, 1);
            Carve.circle(bitmap, 32, 32, 5);
            // (32+6, 32) is at distance 6 — outside radius 5.
            expect(bitmap.getPixel(38, 32)).toBe(1);
            expect(bitmap.getPixel(32, 38)).toBe(1);
            expect(bitmap.getPixel(26, 32)).toBe(1);
            expect(bitmap.getPixel(32, 26)).toBe(1);
        });

        it('produces an approximately circular pixel count (πr²)', () => {
            fillSolid(bitmap, 1);
            const radius = 10;
            Carve.circle(bitmap, 32, 32, radius);
            const carved = countPixels(bitmap, 0);
            const expected = Math.PI * radius * radius;
            // Allow ±10% for rasterization quantization at this radius.
            expect(carved).toBeGreaterThan(expected * 0.9);
            expect(carved).toBeLessThan(expected * 1.1);
        });
    });

    describe('edge clipping', () => {
        it('does not throw when the circle straddles the world boundary', () => {
            fillSolid(bitmap, 1);
            expect(() => Carve.circle(bitmap, 0, 0, 10)).not.toThrow();
            expect(() => Carve.circle(bitmap, 63, 63, 10)).not.toThrow();
        });

        it('carves only in-bounds pixels when straddling the world boundary', () => {
            fillSolid(bitmap, 1);
            Carve.circle(bitmap, 0, 0, 5);
            // Top-left corner cell is in the disc.
            expect(bitmap.getPixel(0, 0)).toBe(0);
            // A cell at (3, 3) — distance ~4.24, inside radius 5 — should be carved.
            expect(bitmap.getPixel(3, 3)).toBe(0);
            // A cell at (10, 10) is outside the radius regardless of clipping.
            expect(bitmap.getPixel(10, 10)).toBe(1);
        });

        it('is a no-op for circles entirely outside the bitmap', () => {
            fillSolid(bitmap, 1);
            const before = countPixels(bitmap, 1);
            Carve.circle(bitmap, -100, -100, 5);
            Carve.circle(bitmap, 1000, 1000, 5);
            expect(countPixels(bitmap, 1)).toBe(before);
        });
    });

    describe('degenerate inputs', () => {
        it('is a no-op for radius 0', () => {
            fillSolid(bitmap, 1);
            Carve.circle(bitmap, 32, 32, 0);
            expect(bitmap.getPixel(32, 32)).toBe(1);
        });

        it('is a no-op for negative radius', () => {
            fillSolid(bitmap, 1);
            Carve.circle(bitmap, 32, 32, -5);
            expect(bitmap.getPixel(32, 32)).toBe(1);
        });

        it('is a no-op for NaN radius', () => {
            fillSolid(bitmap, 1);
            Carve.circle(bitmap, 32, 32, NaN);
            expect(bitmap.getPixel(32, 32)).toBe(1);
        });

        it('handles non-integer center coordinates', () => {
            fillSolid(bitmap, 1);
            // Center at (32.5, 32.5), radius 1 — covers 4 cells around the center
            // but rasterization is integer. Expect the closest cells to be carved.
            expect(() => Carve.circle(bitmap, 32.5, 32.5, 1)).not.toThrow();
        });
    });

    describe('dirty tracking', () => {
        it('marks dirty exactly the chunks the disc touches', () => {
            fillSolid(bitmap, 1);
            // After fillSolid, every chunk is dirty. Clear them to reset.
            for (const chunk of bitmap.chunks) {
                bitmap.clearDirty(chunk);
                bitmap.clearVisualDirty(chunk);
            }

            // Carve a small disc inside chunk (0, 0) only.
            Carve.circle(bitmap, 16, 16, 4);
            expect(bitmap.getChunk(0, 0).dirty).toBe(true);
            expect(bitmap.getChunk(1, 0).dirty).toBe(false);
            expect(bitmap.getChunk(0, 1).dirty).toBe(false);
            expect(bitmap.getChunk(1, 1).dirty).toBe(false);
        });

        it('dirties multiple chunks when the disc straddles a boundary', () => {
            fillSolid(bitmap, 1);
            for (const chunk of bitmap.chunks) {
                bitmap.clearDirty(chunk);
                bitmap.clearVisualDirty(chunk);
            }

            // Disc centered on the (0,0)/(1,0)/(0,1)/(1,1) corner.
            Carve.circle(bitmap, 32, 32, 4);
            expect(bitmap.getChunk(0, 0).dirty).toBe(true);
            expect(bitmap.getChunk(1, 0).dirty).toBe(true);
            expect(bitmap.getChunk(0, 1).dirty).toBe(true);
            expect(bitmap.getChunk(1, 1).dirty).toBe(true);
        });

        it('does not dirty chunks when carving an already-air region', () => {
            // Bitmap is all air by default.
            Carve.circle(bitmap, 16, 16, 4);
            for (const chunk of bitmap.chunks) {
                expect(chunk.dirty).toBe(false);
                expect(chunk.visualDirty).toBe(false);
            }
        });
    });
});

describe('Carve.polygon', () => {
    let bitmap: ChunkedBitmap;

    beforeEach(() => {
        bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
    });

    describe('basic shape', () => {
        it('carves a square interior', () => {
            fillSolid(bitmap, 1);
            const square: Point[] = [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
                { x: 20, y: 20 },
                { x: 10, y: 20 },
            ];
            Carve.polygon(bitmap, square);

            // Cells well inside the square are carved.
            expect(bitmap.getPixel(15, 15)).toBe(0);
            expect(bitmap.getPixel(11, 11)).toBe(0);
            // Cells outside are untouched.
            expect(bitmap.getPixel(9, 15)).toBe(1);
            expect(bitmap.getPixel(21, 15)).toBe(1);
            expect(bitmap.getPixel(15, 9)).toBe(1);
            expect(bitmap.getPixel(15, 21)).toBe(1);
        });

        it('carves a triangle', () => {
            fillSolid(bitmap, 1);
            const triangle: Point[] = [
                { x: 10, y: 10 },
                { x: 30, y: 10 },
                { x: 20, y: 30 },
            ];
            Carve.polygon(bitmap, triangle);

            // Centroid-ish cell is carved.
            expect(bitmap.getPixel(20, 15)).toBe(0);
            // Cell outside the triangle on the far side is intact.
            expect(bitmap.getPixel(20, 31)).toBe(1);
            expect(bitmap.getPixel(5, 15)).toBe(1);
        });

        it('carves a concave (L-shape) polygon correctly', () => {
            fillSolid(bitmap, 1);
            const L: Point[] = [
                { x: 10, y: 10 },
                { x: 30, y: 10 },
                { x: 30, y: 20 },
                { x: 20, y: 20 },
                { x: 20, y: 30 },
                { x: 10, y: 30 },
            ];
            Carve.polygon(bitmap, L);

            // Inside the L's interior.
            expect(bitmap.getPixel(15, 15)).toBe(0);
            expect(bitmap.getPixel(15, 25)).toBe(0);
            expect(bitmap.getPixel(25, 15)).toBe(0);
            // The "notch" of the L (top-right of the missing square) is air-untouched.
            expect(bitmap.getPixel(25, 25)).toBe(1);
        });

        it('handles self-intersecting polygons via even-odd fill', () => {
            fillSolid(bitmap, 1);
            // Horizontal bowtie: vertex order TL, TR, BL, BR. The top and
            // bottom edges + two crossing diagonals split the bounding box
            // into a top triangle (carved), bottom triangle (carved), and
            // left/right triangles (untouched, even-odd outside).
            const bowtie: Point[] = [
                { x: 10, y: 10 }, // TL
                { x: 30, y: 10 }, // TR
                { x: 10, y: 30 }, // BL
                { x: 30, y: 30 }, // BR
            ];
            Carve.polygon(bitmap, bowtie);

            // Top lobe interior (above the diagonal crossing at (20,20)).
            expect(bitmap.getPixel(20, 12)).toBe(0);
            // Bottom lobe interior.
            expect(bitmap.getPixel(20, 28)).toBe(0);
            // Left-side triangle (between the diagonals, near the left edge)
            // is OUTSIDE under even-odd — untouched.
            expect(bitmap.getPixel(12, 20)).toBe(1);
            // Right-side triangle is also outside.
            expect(bitmap.getPixel(28, 20)).toBe(1);
        });
    });

    describe('edge clipping', () => {
        it('clips polygons that straddle the world boundary', () => {
            fillSolid(bitmap, 1);
            const partlyOutside: Point[] = [
                { x: -10, y: -10 },
                { x: 10, y: -10 },
                { x: 10, y: 10 },
                { x: -10, y: 10 },
            ];
            expect(() => Carve.polygon(bitmap, partlyOutside)).not.toThrow();
            // (5, 5) is inside the polygon AND inside the bitmap — carved.
            expect(bitmap.getPixel(5, 5)).toBe(0);
            // (11, 5) is outside the polygon — untouched.
            expect(bitmap.getPixel(11, 5)).toBe(1);
        });

        it('is a no-op for polygons entirely outside the bitmap', () => {
            fillSolid(bitmap, 1);
            const outside: Point[] = [
                { x: -100, y: -100 },
                { x: -50, y: -100 },
                { x: -50, y: -50 },
            ];
            const before = countPixels(bitmap, 1);
            Carve.polygon(bitmap, outside);
            expect(countPixels(bitmap, 1)).toBe(before);
        });
    });

    describe('degenerate inputs', () => {
        it('is a no-op for empty point list', () => {
            fillSolid(bitmap, 1);
            Carve.polygon(bitmap, []);
            expect(countPixels(bitmap, 0)).toBe(0);
        });

        it('is a no-op for fewer than 3 points', () => {
            fillSolid(bitmap, 1);
            Carve.polygon(bitmap, [{ x: 10, y: 10 }]);
            Carve.polygon(bitmap, [
                { x: 10, y: 10 },
                { x: 20, y: 20 },
            ]);
            expect(countPixels(bitmap, 0)).toBe(0);
        });
    });

    describe('dirty tracking', () => {
        it('dirties only the chunks the polygon touches', () => {
            fillSolid(bitmap, 1);
            for (const chunk of bitmap.chunks) {
                bitmap.clearDirty(chunk);
                bitmap.clearVisualDirty(chunk);
            }

            // Square fully within chunk (0, 0).
            const inside00: Point[] = [
                { x: 5, y: 5 },
                { x: 15, y: 5 },
                { x: 15, y: 15 },
                { x: 5, y: 15 },
            ];
            Carve.polygon(bitmap, inside00);
            expect(bitmap.getChunk(0, 0).dirty).toBe(true);
            expect(bitmap.getChunk(1, 0).dirty).toBe(false);
            expect(bitmap.getChunk(0, 1).dirty).toBe(false);
            expect(bitmap.getChunk(1, 1).dirty).toBe(false);
        });

        it('dirties multiple chunks for a polygon spanning chunks', () => {
            fillSolid(bitmap, 1);
            for (const chunk of bitmap.chunks) {
                bitmap.clearDirty(chunk);
                bitmap.clearVisualDirty(chunk);
            }

            const spanning: Point[] = [
                { x: 20, y: 20 },
                { x: 44, y: 20 },
                { x: 44, y: 44 },
                { x: 20, y: 44 },
            ];
            Carve.polygon(bitmap, spanning);
            expect(bitmap.getChunk(0, 0).dirty).toBe(true);
            expect(bitmap.getChunk(1, 0).dirty).toBe(true);
            expect(bitmap.getChunk(0, 1).dirty).toBe(true);
            expect(bitmap.getChunk(1, 1).dirty).toBe(true);
        });
    });
});
