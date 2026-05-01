import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../src/core/ChunkedBitmap.js';
import { MaterialRegistry } from '../../src/core/Materials.js';
import type { Material } from '../../src/core/types.js';

const dirt: Material = {
    id: 1,
    name: 'dirt',
    color: 0x8b5a3c,
    density: 1,
    friction: 0.7,
    restitution: 0.1,
    destructible: true,
    destructionResistance: 0,
};

const stone: Material = {
    id: 2,
    name: 'stone',
    color: 0x666666,
    density: 2.5,
    friction: 0.9,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0.5,
};

describe('ChunkedBitmap construction', () => {
    it('builds the chunk grid with the correct dimensions', () => {
        const bitmap = new ChunkedBitmap({ width: 256, height: 128, chunkSize: 64 });
        expect(bitmap.width).toBe(256);
        expect(bitmap.height).toBe(128);
        expect(bitmap.chunkSize).toBe(64);
        expect(bitmap.chunksX).toBe(4);
        expect(bitmap.chunksY).toBe(2);
        expect(bitmap.chunks.length).toBe(8);
    });

    it('allocates each chunk with chunkSize*chunkSize bytes', () => {
        const bitmap = new ChunkedBitmap({ width: 128, height: 128, chunkSize: 32 });
        for (const chunk of bitmap.chunks) {
            expect(chunk.bitmap.length).toBe(32 * 32);
        }
    });

    it('initializes every byte to 0 (air)', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        for (const chunk of bitmap.chunks) {
            for (const byte of chunk.bitmap) {
                expect(byte).toBe(0);
            }
        }
    });

    it('starts every chunk with dirty=false and visualDirty=false', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        for (const chunk of bitmap.chunks) {
            expect(chunk.dirty).toBe(false);
            expect(chunk.visualDirty).toBe(false);
            expect(chunk.contours).toBeNull();
        }
    });

    it('exposes a materials registry (empty by default)', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        expect(bitmap.materials).toBeInstanceOf(MaterialRegistry);
        expect(bitmap.materials.get(1)).toBeUndefined();
    });

    it('builds a materials registry from a Material[] when supplied', () => {
        const bitmap = new ChunkedBitmap({
            width: 64,
            height: 64,
            chunkSize: 32,
            materials: [dirt, stone],
        });
        expect(bitmap.materials.get(1)).toEqual(dirt);
        expect(bitmap.materials.get(2)).toEqual(stone);
    });

    it('rejects non-positive width or height', () => {
        expect(() => new ChunkedBitmap({ width: 0, height: 64, chunkSize: 32 })).toThrow();
        expect(() => new ChunkedBitmap({ width: 64, height: -1, chunkSize: 32 })).toThrow();
    });

    it('rejects non-positive chunkSize', () => {
        expect(() => new ChunkedBitmap({ width: 64, height: 64, chunkSize: 0 })).toThrow();
    });

    it('rejects non-integer dimensions', () => {
        expect(() => new ChunkedBitmap({ width: 64.5, height: 64, chunkSize: 32 })).toThrow();
        expect(() => new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32.1 })).toThrow();
    });

    it('rejects chunkSize that does not divide width or height', () => {
        expect(() => new ChunkedBitmap({ width: 100, height: 64, chunkSize: 32 })).toThrow(
            /chunkSize|divide/i,
        );
        expect(() => new ChunkedBitmap({ width: 64, height: 100, chunkSize: 32 })).toThrow(
            /chunkSize|divide/i,
        );
    });
});

describe('ChunkedBitmap pixel I/O', () => {
    it('round-trips setPixel/getPixel within a single chunk', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(5, 7, 1);
        expect(bitmap.getPixel(5, 7)).toBe(1);
    });

    it('round-trips setPixel/getPixel across chunk boundaries', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(31, 31, 1); // last cell of chunk (0,0)
        bitmap.setPixel(32, 32, 2); // first cell of chunk (1,1)
        bitmap.setPixel(63, 63, 3); // last cell of chunk (1,1)
        expect(bitmap.getPixel(31, 31)).toBe(1);
        expect(bitmap.getPixel(32, 32)).toBe(2);
        expect(bitmap.getPixel(63, 63)).toBe(3);
    });

    it('getPixel returns 0 for out-of-bounds coordinates (treat-as-air)', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1);
        expect(bitmap.getPixel(-1, 0)).toBe(0);
        expect(bitmap.getPixel(0, -1)).toBe(0);
        expect(bitmap.getPixel(64, 0)).toBe(0);
        expect(bitmap.getPixel(0, 64)).toBe(0);
        expect(bitmap.getPixel(1000, 1000)).toBe(0);
    });

    it('setPixel throws on out-of-bounds coordinates', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        expect(() => bitmap.setPixel(-1, 0, 1)).toThrow();
        expect(() => bitmap.setPixel(0, -1, 1)).toThrow();
        expect(() => bitmap.setPixel(64, 0, 1)).toThrow();
        expect(() => bitmap.setPixel(0, 64, 1)).toThrow();
    });

    it('setPixel throws on non-integer coordinates', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        expect(() => bitmap.setPixel(1.5, 0, 1)).toThrow();
        expect(() => bitmap.setPixel(0, 1.5, 1)).toThrow();
    });

    it('setPixel rejects material ids outside 0..255', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        expect(() => bitmap.setPixel(0, 0, -1)).toThrow();
        expect(() => bitmap.setPixel(0, 0, 256)).toThrow();
        expect(() => bitmap.setPixel(0, 0, 1.5)).toThrow();
    });

    it('setPixel(x, y, 0) carves a previously solid cell to air', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1);
        expect(bitmap.getPixel(10, 10)).toBe(1);
        bitmap.setPixel(10, 10, 0);
        expect(bitmap.getPixel(10, 10)).toBe(0);
    });
});

describe('ChunkedBitmap dirty tracking', () => {
    it('marks the owning chunk dirty after setPixel changes a cell', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        const chunk = bitmap.getChunk(0, 0);
        expect(chunk.dirty).toBe(false);
        expect(chunk.visualDirty).toBe(false);

        bitmap.setPixel(10, 10, 1);

        expect(chunk.dirty).toBe(true);
        expect(chunk.visualDirty).toBe(true);
    });

    it('does not dirty other chunks for a single-chunk write', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1); // chunk (0,0)
        expect(bitmap.getChunk(0, 0).dirty).toBe(true);
        expect(bitmap.getChunk(1, 0).dirty).toBe(false);
        expect(bitmap.getChunk(0, 1).dirty).toBe(false);
        expect(bitmap.getChunk(1, 1).dirty).toBe(false);
    });

    it('skips the dirty mark when the new value equals the current value', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1);
        const chunk = bitmap.getChunk(0, 0);
        bitmap.clearDirty(chunk);
        bitmap.clearVisualDirty(chunk);

        // Re-write the same value: should be a no-op.
        bitmap.setPixel(10, 10, 1);
        expect(chunk.dirty).toBe(false);
        expect(chunk.visualDirty).toBe(false);
    });

    it('clearDirty clears only the collider flag', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1);
        const chunk = bitmap.getChunk(0, 0);
        bitmap.clearDirty(chunk);
        expect(chunk.dirty).toBe(false);
        expect(chunk.visualDirty).toBe(true); // unchanged
    });

    it('clearVisualDirty clears only the visual flag', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1);
        const chunk = bitmap.getChunk(0, 0);
        bitmap.clearVisualDirty(chunk);
        expect(chunk.dirty).toBe(true); // unchanged
        expect(chunk.visualDirty).toBe(false);
    });

    it('forEachDirtyChunk visits only chunks that are currently dirty', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1); // chunk (0,0)
        bitmap.setPixel(40, 40, 2); // chunk (1,1)

        const visited: [number, number][] = [];
        bitmap.forEachDirtyChunk((chunk) => {
            visited.push([chunk.cx, chunk.cy]);
        });
        expect(visited).toContainEqual([0, 0]);
        expect(visited).toContainEqual([1, 1]);
        expect(visited.length).toBe(2);
    });

    it('forEachDirtyChunk visits chunks in a stable (cy, cx) row-major order', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        // Dirty in reverse order; iteration must still come back row-major.
        bitmap.setPixel(40, 40, 1); // (1,1)
        bitmap.setPixel(40, 0, 1); // (1,0)
        bitmap.setPixel(0, 40, 1); // (0,1)
        bitmap.setPixel(0, 0, 1); // (0,0)

        const visited: [number, number][] = [];
        bitmap.forEachDirtyChunk((chunk) => {
            visited.push([chunk.cx, chunk.cy]);
        });
        expect(visited).toEqual([
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ]);
    });
});

describe('ChunkedBitmap coordinate conversion', () => {
    it('worldToChunk maps world coords to chunk-grid coords', () => {
        const bitmap = new ChunkedBitmap({ width: 256, height: 128, chunkSize: 64 });
        expect(bitmap.worldToChunk(0, 0)).toEqual({ cx: 0, cy: 0 });
        expect(bitmap.worldToChunk(63, 63)).toEqual({ cx: 0, cy: 0 });
        expect(bitmap.worldToChunk(64, 64)).toEqual({ cx: 1, cy: 1 });
        expect(bitmap.worldToChunk(255, 127)).toEqual({ cx: 3, cy: 1 });
    });

    it('worldToChunkLocal maps world coords to chunk-local coords', () => {
        const bitmap = new ChunkedBitmap({ width: 256, height: 128, chunkSize: 64 });
        expect(bitmap.worldToChunkLocal(0, 0)).toEqual({ x: 0, y: 0 });
        expect(bitmap.worldToChunkLocal(63, 63)).toEqual({ x: 63, y: 63 });
        expect(bitmap.worldToChunkLocal(64, 64)).toEqual({ x: 0, y: 0 });
        expect(bitmap.worldToChunkLocal(70, 80)).toEqual({ x: 6, y: 16 });
    });

    it('getChunk throws for out-of-range chunk coords', () => {
        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
        expect(() => bitmap.getChunk(-1, 0)).toThrow();
        expect(() => bitmap.getChunk(0, -1)).toThrow();
        expect(() => bitmap.getChunk(2, 0)).toThrow();
        expect(() => bitmap.getChunk(0, 2)).toThrow();
    });
});

describe('ChunkedBitmap active-cell tracking', () => {
    const sand: Material = {
        id: 3,
        name: 'sand',
        color: 0xd4b06a,
        density: 1,
        friction: 0.5,
        restitution: 0.05,
        destructible: true,
        destructionResistance: 0,
        simulation: 'sand',
    };

    it('hasActiveCellTracking is false until enabled or accessed', () => {
        const bm = new ChunkedBitmap({ width: 4, height: 4, chunkSize: 2 });
        expect(bm.hasActiveCellTracking).toBe(false);
    });

    it('setPixel does not auto-mark before tracking is enabled', () => {
        const bm = new ChunkedBitmap({
            width: 4, height: 4, chunkSize: 2, materials: [sand],
        });
        bm.setPixel(1, 1, sand.id);
        // No tracking initialized → no neighbor activation, no set
        // allocation. Confirms the zero-overhead path for non-fluid
        // users.
        expect(bm.hasActiveCellTracking).toBe(false);
    });

    it('enableActiveCellTracking seeds with non-air, non-static cells', () => {
        const bm = new ChunkedBitmap({
            width: 4, height: 4, chunkSize: 2, materials: [sand, dirt],
        });
        bm.setPixel(0, 0, sand.id); // mobile
        bm.setPixel(1, 0, dirt.id); // static (no simulation kind)
        bm.setPixel(2, 2, sand.id); // mobile
        bm.enableActiveCellTracking();
        expect(bm.activeCells.has(0 * 4 + 0)).toBe(true);
        expect(bm.activeCells.has(2 * 4 + 2)).toBe(true);
        expect(bm.activeCells.has(0 * 4 + 1)).toBe(false); // dirt is static
        expect(bm.activeCells.size).toBe(2);
    });

    it('enableActiveCellTracking is idempotent', () => {
        const bm = new ChunkedBitmap({
            width: 4, height: 4, chunkSize: 2, materials: [sand],
        });
        bm.setPixel(0, 0, sand.id);
        bm.enableActiveCellTracking();
        const set1 = bm.activeCells;
        bm.enableActiveCellTracking();
        const set2 = bm.activeCells;
        // Same instance — second call didn't reseed.
        expect(set1).toBe(set2);
    });

    it('setPixel auto-marks the changed cell + 8 neighbors once tracking is on', () => {
        const bm = new ChunkedBitmap({
            width: 5, height: 5, chunkSize: 5, materials: [sand],
        });
        bm.enableActiveCellTracking();
        bm.activeCells.clear();
        bm.setPixel(2, 2, sand.id);
        // Center + Moore neighborhood = 9 indices.
        const expected = [
            1 * 5 + 1, 1 * 5 + 2, 1 * 5 + 3,
            2 * 5 + 1, 2 * 5 + 2, 2 * 5 + 3,
            3 * 5 + 1, 3 * 5 + 2, 3 * 5 + 3,
        ];
        for (const idx of expected) expect(bm.activeCells.has(idx)).toBe(true);
        expect(bm.activeCells.size).toBe(9);
    });

    it('setPixel auto-mark clips at world bounds (corner cell)', () => {
        const bm = new ChunkedBitmap({
            width: 4, height: 4, chunkSize: 2, materials: [sand],
        });
        bm.enableActiveCellTracking();
        bm.activeCells.clear();
        bm.setPixel(0, 0, sand.id);
        // Corner — only (0,0), (1,0), (0,1), (1,1) should be marked.
        expect(bm.activeCells.size).toBe(4);
        expect(bm.activeCells.has(0)).toBe(true);
        expect(bm.activeCells.has(1)).toBe(true);
        expect(bm.activeCells.has(4)).toBe(true);
        expect(bm.activeCells.has(5)).toBe(true);
    });

    it('markActive ignores out-of-bounds coordinates and uninitialized state', () => {
        const bm = new ChunkedBitmap({ width: 4, height: 4, chunkSize: 2 });
        // No-op when tracking isn't initialized.
        bm.markActive(1, 1);
        expect(bm.hasActiveCellTracking).toBe(false);
        bm.enableActiveCellTracking();
        bm.activeCells.clear();
        bm.markActive(-1, 0);
        bm.markActive(4, 0);
        bm.markActive(0, -1);
        bm.markActive(0, 4);
        expect(bm.activeCells.size).toBe(0);
        bm.markActive(2, 2);
        expect(bm.activeCells.size).toBe(1);
    });

    it('setPixel that doesn\'t change the cell does not mark', () => {
        const bm = new ChunkedBitmap({
            width: 4, height: 4, chunkSize: 2, materials: [sand],
        });
        bm.enableActiveCellTracking();
        bm.setPixel(1, 1, sand.id);
        bm.activeCells.clear();
        // Same id again — early-out, no auto-mark.
        bm.setPixel(1, 1, sand.id);
        expect(bm.activeCells.size).toBe(0);
    });
});
