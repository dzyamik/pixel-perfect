/**
 * v3.1 phase 1 — pool-detection unit tests. Verifies that
 * `detectPools` correctly identifies connected components of
 * same-material fluid cells and computes their aggregate mass.
 */
import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import {
    detectPools,
    distributePoolMass,
    isPoolInterior,
    NO_POOL,
} from '../../../src/core/algorithms/FluidPools.js';
import type { Material } from '../../../src/core/types.js';

const stone: Material = {
    id: 1, name: 'stone', color: 0x556070,
    density: 2.5, friction: 0.9, restitution: 0.05,
    destructible: true, destructionResistance: 0.5,
    simulation: 'static',
};
const water: Material = {
    id: 2, name: 'water', color: 0x4080c0,
    density: 1, friction: 0, restitution: 0,
    destructible: true, destructionResistance: 0,
    simulation: 'water',
};
const oil: Material = {
    id: 3, name: 'oil', color: 0x3a2a1a,
    density: 0.9, friction: 0.2, restitution: 0,
    destructible: true, destructionResistance: 0,
    simulation: 'oil',
};
const sand: Material = {
    id: 4, name: 'sand', color: 0xd4b06a,
    density: 1, friction: 0.5, restitution: 0.05,
    destructible: true, destructionResistance: 0,
    simulation: 'sand',
};

function buildBitmap(rows: string[], extra: Material[] = []): ChunkedBitmap {
    const W = rows[0]!.length;
    const H = rows.length;
    const bm = new ChunkedBitmap({
        width: W, height: H, chunkSize: 1,
        materials: [stone, water, oil, sand, ...extra],
    });
    for (let y = 0; y < H; y++) {
        const row = rows[y]!;
        for (let x = 0; x < W; x++) {
            const ch = row[x];
            if (ch === '#') bm.setPixel(x, y, stone.id);
            else if (ch === 'w') bm.setPixel(x, y, water.id);
            else if (ch === 'o') bm.setPixel(x, y, oil.id);
            else if (ch === 's') bm.setPixel(x, y, sand.id);
        }
    }
    return bm;
}

describe('FluidPools.detectPools', () => {
    it('returns an empty registry for an air-only bitmap', () => {
        const bm = new ChunkedBitmap({ width: 4, height: 4, chunkSize: 2 });
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(0);
    });

    it('skips static, sand, and fire materials', () => {
        const bm = buildBitmap([
            '##s.',
            '....',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(0);
        // Pool ids on those cells should be NO_POOL.
        const ids = bm._getPoolIdsUnchecked();
        for (const v of ids) {
            expect(v).toBe(NO_POOL);
        }
    });

    it('groups a single contiguous water blob into one pool', () => {
        const bm = buildBitmap([
            '....',
            '.www',
            '.ww.',
            '....',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(1);
        const pool = [...pools.values()][0]!;
        expect(pool.materialMass.size).toBe(1);
        expect(pool.materialMass.get(water.id)).toBeCloseTo(5.0);
        expect(pool.cells.size).toBe(5);
        expect(pool.totalMass).toBeCloseTo(5.0);
    });

    it('separates two non-touching water blobs into different pools', () => {
        const bm = buildBitmap([
            'ww..ww',
            'ww..ww',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(2);
        const sizes = [...pools.values()].map((p) => p.cells.size).sort();
        expect(sizes).toEqual([4, 4]);
    });

    it('merges water and oil into one pool when adjacent (v3.1.17)', () => {
        // v3.1.17: pools are multi-material so density stratification
        // can heal cross-density chimneys via the fast path. Two
        // touching fluids form ONE pool with per-id mass tracked
        // separately.
        const bm = buildBitmap([
            'wwoo',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(1);
        const pool = [...pools.values()][0]!;
        expect(pool.cells.size).toBe(4);
        expect(pool.materialMass.get(water.id)).toBeCloseTo(2.0);
        expect(pool.materialMass.get(oil.id)).toBeCloseTo(2.0);
    });

    it('isolated water and oil blobs stay separate pools', () => {
        const bm = buildBitmap([
            'ww..oo',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(2);
    });

    it('uses 4-connectivity (diagonals do NOT join)', () => {
        // Two diagonally-adjacent water cells. With 4-connectivity
        // they form separate pools.
        const bm = buildBitmap([
            'w.',
            '.w',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(2);
    });

    it('skips cells separated by stone walls', () => {
        const bm = buildBitmap([
            'w#w',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(2);
    });

    it('writes the assigned pool id into the cell sidecar', () => {
        const bm = buildBitmap([
            'ww',
        ]);
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(1);
        const pool = [...pools.values()][0]!;
        const ids = bm._getPoolIdsUnchecked();
        expect(ids[0]).toBe(pool.id);
        expect(ids[1]).toBe(pool.id);
    });

    it('air cells stay at NO_POOL', () => {
        const bm = buildBitmap([
            '.w.',
            '...',
        ]);
        detectPools(bm, bm.materials);
        const ids = bm._getPoolIdsUnchecked();
        expect(ids[0]).toBe(NO_POOL);
        expect(ids[2]).toBe(NO_POOL);
        expect(ids[1]).not.toBe(NO_POOL);
    });

    it('sums total mass across the pool, accounting for partial cells', () => {
        const bm = buildBitmap([
            'wwww',
        ]);
        // Make one cell partial mass to verify the totalMass sum
        // uses the actual stored values, not just the cell count.
        bm.setMass(2, 0, 0.4);
        const pools = detectPools(bm, bm.materials);
        const pool = [...pools.values()][0]!;
        expect(pool.cells.size).toBe(4);
        expect(pool.totalMass).toBeCloseTo(1.0 + 1.0 + 0.4 + 1.0, 3);
    });

    it('distributePoolMass fills bottom-up and conserves total', () => {
        const bm = buildBitmap([
            'wwww',
            'wwww',
        ]);
        // Make masses uneven to start. Total = 1.0 + 1.0 + 1.0 + 1.0
        // (row 0) - 0.6 (cell 0 → 0.4) + 1.0*4 (row 1) + 0.5 (cell
        // (3,1) bumped 1.0 → 1.5) = 7.9 mass total.
        bm.setMass(0, 0, 0.4);
        bm.setMass(3, 1, 1.5);
        const pools = detectPools(bm, bm.materials);
        const pool = [...pools.values()][0]!;
        const initialTotal = pool.totalMass;
        distributePoolMass(bm, pool, bm.materials);
        // Bottom row (y = 1) should be fully saturated at MAX_MASS;
        // top row (y = 0) carries the remainder (initialTotal - 4.0)
        // distributed uniformly.
        for (let x = 0; x < 4; x++) {
            expect(bm.getMass(x, 1)).toBeCloseTo(1.0, 5);
        }
        const expectedTopPerCell = (initialTotal - 4.0) / 4;
        for (let x = 0; x < 4; x++) {
            expect(bm.getMass(x, 0)).toBeCloseTo(expectedTopPerCell, 5);
        }
        // Total mass conserved.
        let post = 0;
        for (const idx of pool.cells) post += bm.getMass(idx % bm.width, (idx / bm.width) | 0);
        expect(post).toBeCloseTo(initialTotal, 5);
    });

    it('isPoolInterior returns true only when all 4 neighbors share the pool', () => {
        const bm = buildBitmap([
            '.....',
            '.www.',
            '.www.',
            '.www.',
            '.....',
        ]);
        const pools = detectPools(bm, bm.materials);
        const pool = [...pools.values()][0]!;
        const ids = bm._getPoolIdsUnchecked();
        // Center cell (2,2) — all 4 neighbors are pool members.
        expect(isPoolInterior(ids, 2, 2, bm.width, bm.height, pool.id)).toBe(true);
        // Edge cells of the 3x3 block — at least one neighbor is air.
        expect(isPoolInterior(ids, 1, 1, bm.width, bm.height, pool.id)).toBe(false);
        expect(isPoolInterior(ids, 3, 1, bm.width, bm.height, pool.id)).toBe(false);
        expect(isPoolInterior(ids, 1, 3, bm.width, bm.height, pool.id)).toBe(false);
        expect(isPoolInterior(ids, 3, 3, bm.width, bm.height, pool.id)).toBe(false);
    });

    it('isPoolInterior returns false at world edges', () => {
        const bm = buildBitmap([
            'www',
            'www',
        ]);
        const pools = detectPools(bm, bm.materials);
        const pool = [...pools.values()][0]!;
        const ids = bm._getPoolIdsUnchecked();
        // No cell can be interior — they're all on the world edge.
        for (let y = 0; y < bm.height; y++) {
            for (let x = 0; x < bm.width; x++) {
                expect(isPoolInterior(ids, x, y, bm.width, bm.height, pool.id)).toBe(false);
            }
        }
    });

    it('handles a large connected region without stack overflow', () => {
        // 64x64 fully water-filled bitmap. The flood fill uses an
        // explicit stack, so this should complete without recursion
        // limit issues.
        const W = 64;
        const H = 64;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 16,
            materials: [stone, water],
        });
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) bm.setPixel(x, y, water.id);
        }
        const pools = detectPools(bm, bm.materials);
        expect(pools.size).toBe(1);
        const pool = [...pools.values()][0]!;
        expect(pool.cells.size).toBe(W * H);
        expect(pool.totalMass).toBeCloseTo(W * H);
    });
});
