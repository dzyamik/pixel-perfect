import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import {
    findGroundBelow,
    isSolid,
    raycast,
    sampleMaterial,
    surfaceY,
} from '../../../src/core/queries/Spatial.js';

describe('Spatial.isSolid / Spatial.sampleMaterial', () => {
    it('returns false / 0 for air cells', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        expect(isSolid(bitmap, 3, 3)).toBe(false);
        expect(sampleMaterial(bitmap, 3, 3)).toBe(0);
    });

    it('returns true / id for solid cells', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 7);
        expect(isSolid(bitmap, 3, 3)).toBe(true);
        expect(sampleMaterial(bitmap, 3, 3)).toBe(7);
    });

    it('treats out-of-bounds as air (consistent with getPixel)', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        expect(isSolid(bitmap, -1, 0)).toBe(false);
        expect(isSolid(bitmap, 0, 100)).toBe(false);
        expect(sampleMaterial(bitmap, -1, 0)).toBe(0);
    });
});

describe('Spatial.surfaceY', () => {
    it('returns bitmap.height when the column is empty', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        expect(surfaceY(bitmap, 3)).toBe(8);
    });

    it('returns the y of the first solid cell scanning from y=0', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 5, 1);
        expect(surfaceY(bitmap, 3)).toBe(5);
    });

    it('returns 0 when the very top of the column is solid', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 0, 1);
        expect(surfaceY(bitmap, 3)).toBe(0);
    });

    it('returns bitmap.height for out-of-bounds x', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        expect(surfaceY(bitmap, -1)).toBe(8);
        expect(surfaceY(bitmap, 100)).toBe(8);
    });
});

describe('Spatial.findGroundBelow', () => {
    it('returns the first solid y below the start position', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 6, 1);
        expect(findGroundBelow(bitmap, 3, 0, 10)).toBe(6);
    });

    it('returns the start y when the start cell itself is solid', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 4, 1);
        expect(findGroundBelow(bitmap, 3, 4, 10)).toBe(4);
    });

    it('returns null when no solid cell is within maxDist', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 7, 1);
        expect(findGroundBelow(bitmap, 3, 0, 5)).toBeNull();
    });

    it('returns null for non-positive maxDist', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 4, 1);
        expect(findGroundBelow(bitmap, 3, 0, 0)).toBeNull();
        expect(findGroundBelow(bitmap, 3, 0, -5)).toBeNull();
    });

    it('clips at the world bottom edge', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        // Start at y=6, maxDist=100 — should not throw / overscan.
        expect(findGroundBelow(bitmap, 3, 6, 100)).toBeNull();
    });
});

describe('Spatial.raycast', () => {
    it('returns null for a ray entirely through air', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        expect(raycast(bitmap, 0, 0, 7, 7)).toBeNull();
    });

    it('returns the start cell when the start is already solid', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(0, 0, 5);
        const hit = raycast(bitmap, 0, 0, 7, 7);
        expect(hit).not.toBeNull();
        expect(hit!.x).toBe(0);
        expect(hit!.y).toBe(0);
        expect(hit!.materialId).toBe(5);
        expect(hit!.distance).toBe(0);
    });

    it('returns the first solid cell on a horizontal ray', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(5, 3, 1);
        const hit = raycast(bitmap, 0, 3, 7, 3);
        expect(hit).not.toBeNull();
        expect(hit!.x).toBe(5);
        expect(hit!.y).toBe(3);
        expect(hit!.materialId).toBe(1);
        expect(hit!.distance).toBe(5);
    });

    it('returns the first solid cell on a vertical ray', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(2, 6, 3);
        const hit = raycast(bitmap, 2, 0, 2, 7);
        expect(hit).not.toBeNull();
        expect(hit!.x).toBe(2);
        expect(hit!.y).toBe(6);
        expect(hit!.materialId).toBe(3);
        expect(hit!.distance).toBe(6);
    });

    it('returns the first solid cell on a diagonal ray', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 9);
        const hit = raycast(bitmap, 0, 0, 7, 7);
        expect(hit).not.toBeNull();
        expect(hit!.x).toBe(3);
        expect(hit!.y).toBe(3);
        expect(hit!.materialId).toBe(9);
        // Distance ≈ √(3² + 3²) ≈ 4.24
        expect(hit!.distance).toBeCloseTo(Math.hypot(3, 3));
    });

    it('handles rays going up-and-left (negative steps in both axes)', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(2, 2, 1);
        const hit = raycast(bitmap, 7, 7, 0, 0);
        expect(hit).not.toBeNull();
        expect(hit!.x).toBe(2);
        expect(hit!.y).toBe(2);
    });

    it('returns null for a ray of length zero through air', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        expect(raycast(bitmap, 3, 3, 3, 3)).toBeNull();
    });

    it('returns the cell for a ray of length zero starting on solid', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 1);
        const hit = raycast(bitmap, 3, 3, 3, 3);
        expect(hit).not.toBeNull();
        expect(hit!.x).toBe(3);
        expect(hit!.y).toBe(3);
    });

    it('floors non-integer endpoint coordinates', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        bitmap.setPixel(3, 3, 1);
        const hit = raycast(bitmap, 0.5, 0.7, 6.9, 6.2);
        expect(hit).not.toBeNull();
        // Walks the integer cells; should hit (3, 3) at some point.
        expect(hit!.materialId).toBe(1);
    });
});
