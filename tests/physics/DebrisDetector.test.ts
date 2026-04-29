import { describe, expect, it } from 'vitest';
import { ChunkedBitmap, Deposit } from '../../src/core/index.js';
import { detect, detectAndRemove } from '../../src/physics/DebrisDetector.js';

function fillRect(bitmap: ChunkedBitmap, x: number, y: number, w: number, h: number, id: number) {
    for (let yy = y; yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
            bitmap.setPixel(xx, yy, id);
        }
    }
}

describe('DebrisDetector.detect', () => {
    it('returns no debris for an empty bitmap', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        expect(detect(bitmap)).toEqual([]);
    });

    it('returns no debris when all solids are anchored to the bottom row', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        // Vertical bar from bottom to mid-height — anchored.
        fillRect(bitmap, 16, 16, 1, 16, 1);
        expect(detect(bitmap)).toEqual([]);
    });

    it('detects a single floating block as one debris with a closed contour', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        fillRect(bitmap, 10, 10, 4, 4, 1);
        const debris = detect(bitmap);
        expect(debris.length).toBe(1);
        expect(debris[0]!.island.cells.length).toBe(16);
        expect(debris[0]!.contours.length).toBeGreaterThan(0);
        const outer = debris[0]!.contours.find((c) => c.closed);
        expect(outer).toBeDefined();
        expect(outer!.points.length).toBeGreaterThan(0);
    });

    it('detects two disjoint floating regions as two debris', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        fillRect(bitmap, 5, 5, 3, 3, 1);
        fillRect(bitmap, 20, 20, 3, 3, 2);
        const debris = detect(bitmap);
        expect(debris.length).toBe(2);
    });

    it('reports dominantMaterial as the most-common id in the island', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        // 3x3 block with a single different cell.
        fillRect(bitmap, 10, 10, 3, 3, 1);
        bitmap.setPixel(11, 11, 2);
        const debris = detect(bitmap);
        expect(debris.length).toBe(1);
        expect(debris[0]!.dominantMaterial).toBe(1); // 1 occurs 8 times, 2 once
    });

    it('honors a custom anchor strategy', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        fillRect(bitmap, 5, 5, 4, 4, 1);
        // With customPoints anchor pointing into the block, no debris.
        const debrisAnchored = detect(bitmap, {
            anchor: { kind: 'customPoints', points: [{ x: 6, y: 6 }] },
        });
        expect(debrisAnchored).toEqual([]);
        // With anchor on an air cell, the block is detached.
        const debrisFloating = detect(bitmap, {
            anchor: { kind: 'customPoints', points: [{ x: 0, y: 0 }] },
        });
        expect(debrisFloating.length).toBe(1);
    });

    it('produces a smaller-vertex contour when given a larger simplificationEpsilon', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 64 });
        // Place a circular floating island in the middle.
        Deposit.circle(bitmap, 32, 32, 12, 1);
        const tight = detect(bitmap, { simplificationEpsilon: 0 });
        const loose = detect(bitmap, { simplificationEpsilon: 5 });
        const tightOuter = tight[0]!.contours.find((c) => c.closed)!;
        const looseOuter = loose[0]!.contours.find((c) => c.closed)!;
        expect(looseOuter.points.length).toBeLessThan(tightOuter.points.length);
    });
});

describe('DebrisDetector.detectAndRemove', () => {
    it('removes detected island cells from the source bitmap', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        fillRect(bitmap, 10, 10, 4, 4, 1);
        // Sanity: cells are populated.
        expect(bitmap.getPixel(10, 10)).toBe(1);
        const debris = detectAndRemove(bitmap);
        expect(debris.length).toBe(1);
        // After removal: cells are 0.
        for (let y = 10; y < 14; y++) {
            for (let x = 10; x < 14; x++) {
                expect(bitmap.getPixel(x, y)).toBe(0);
            }
        }
    });

    it('does not touch anchored solids', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        // Anchored bar.
        fillRect(bitmap, 0, 28, 32, 4, 1);
        // Floating block.
        fillRect(bitmap, 10, 5, 3, 3, 2);
        const debris = detectAndRemove(bitmap);
        expect(debris.length).toBe(1);
        // Anchored bar still present.
        for (let x = 0; x < 32; x++) expect(bitmap.getPixel(x, 28)).toBe(1);
        // Floating block gone.
        expect(bitmap.getPixel(10, 5)).toBe(0);
    });

    it('preserves dominantMaterial even after the cells are removed', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        fillRect(bitmap, 10, 10, 3, 3, 7);
        const debris = detectAndRemove(bitmap);
        expect(debris[0]!.dominantMaterial).toBe(7);
    });

    it('marks affected chunks dirty after removal', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        fillRect(bitmap, 10, 10, 4, 4, 1);
        // Clear the dirty flag from the initial deposit so we measure
        // detectAndRemove's effect specifically.
        for (const chunk of bitmap.chunks) {
            bitmap.clearDirty(chunk);
            bitmap.clearVisualDirty(chunk);
        }
        detectAndRemove(bitmap);
        expect(bitmap.getChunk(0, 0).dirty).toBe(true);
    });
});
