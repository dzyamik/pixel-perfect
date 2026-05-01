/**
 * Benchmarks for the cellular-automaton step. Run with
 *
 *     npm run bench
 *
 * These are informational, not regression assertions — thresholds
 * vary by hardware. Compare runs before/after a change to see
 * whether you helped or hurt step cost. Numbers below are from
 * the development laptop (i7, Node 22) for orientation.
 *
 * Canonical scenarios picked to exercise the v2.4 active-cell
 * tracking claims in `docs-dev/01-architecture.md` and
 * `docs-dev/05-simulation.md`:
 *
 *  - **Settled world**: every fluid cell has dropped from the
 *    active set. `step` does an empty-set check and returns. This
 *    should be ~0 µs; if it ever climbs into the µs+ range, the
 *    early-out got broken.
 *  - **Active pour**: a steady stream of falling fluid (≈ 100
 *    moving cells). Sub-ms per step.
 *  - **Full mixed bitmap**: every cell is a mobile fluid (worst
 *    case for the active set; nothing settles, everything moves).
 *    Bounded but bigger.
 *  - **First-call seed**: the very first step on a fresh bitmap
 *    triggers `enableActiveCellTracking`'s O(W×H) scan. Once-only
 *    cost; comparable to a v2.3 full-sweep tick.
 */
import { bench, describe } from 'vitest';
import { ChunkedBitmap } from '../../src/core/ChunkedBitmap.js';
import * as CellularAutomaton from '../../src/core/algorithms/CellularAutomaton.js';
import type { Material } from '../../src/core/types.js';

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
const sand: Material = {
    id: 3, name: 'sand', color: 0xd4b06a,
    density: 1, friction: 0.5, restitution: 0.05,
    destructible: true, destructionResistance: 0,
    simulation: 'sand',
};
const oil: Material = {
    id: 4, name: 'oil', color: 0x3a2a1a,
    density: 0.9, friction: 0.2, restitution: 0,
    destructible: true, destructionResistance: 0,
    simulation: 'oil',
};

const W = 256;
const H = 128;

function makeSettledBitmap(): ChunkedBitmap {
    // 256×128 with a half-floor of stone. No fluids. After one step
    // the active set is empty. We pre-warm with a single step so
    // the bitmap's `_activeCells` is initialized and empty.
    const bm = new ChunkedBitmap({
        width: W, height: H, chunkSize: 32,
        materials: [stone, water, sand, oil],
    });
    for (let y = H >> 1; y < H; y++) {
        for (let x = 0; x < W; x++) bm.setPixel(x, y, stone.id);
    }
    CellularAutomaton.step(bm, 0); // initialize active-cell tracking
    return bm;
}

function makeActivePourBitmap(): ChunkedBitmap {
    // Stone floor + a 100-cell water pour mid-air.
    const bm = new ChunkedBitmap({
        width: W, height: H, chunkSize: 32,
        materials: [stone, water],
    });
    for (let y = H - 8; y < H; y++) {
        for (let x = 0; x < W; x++) bm.setPixel(x, y, stone.id);
    }
    for (let y = 16; y < 26; y++) {
        for (let x = (W >> 1) - 5; x < (W >> 1) + 5; x++) {
            bm.setPixel(x, y, water.id);
        }
    }
    CellularAutomaton.step(bm, 0);
    return bm;
}

function makeFullMixedBitmap(): ChunkedBitmap {
    // Worst case: every cell is a mobile fluid (no static, no air).
    // The active set is the full bitmap; nothing settles.
    const bm = new ChunkedBitmap({
        width: W, height: H, chunkSize: 32,
        materials: [stone, water, sand, oil],
    });
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const m = (x + y) & 3;
            bm.setPixel(
                x, y,
                m === 0 ? water.id : m === 1 ? sand.id : m === 2 ? oil.id : water.id,
            );
        }
    }
    CellularAutomaton.step(bm, 0);
    return bm;
}

describe('CellularAutomaton.step', () => {
    bench('settled world (active set empty)', () => {
        const bm = makeSettledBitmap();
        for (let t = 0; t < 100; t++) CellularAutomaton.step(bm, t);
    });

    bench('active pour (~100 falling water cells)', () => {
        const bm = makeActivePourBitmap();
        for (let t = 0; t < 100; t++) CellularAutomaton.step(bm, t);
    });

    bench('full mixed bitmap (256×128 = 32k cells)', () => {
        const bm = makeFullMixedBitmap();
        for (let t = 0; t < 50; t++) CellularAutomaton.step(bm, t);
    });

    bench('big pour: 5000 active water cells, draining', () => {
        // Large pool of water draining through a hole — closer to
        // real demo-09 usage. Single step measured.
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 32,
            materials: [stone, water],
        });
        // Stone floor + walls.
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        // 5000 water cells in a 100x50 block.
        const px = (W >> 1) - 50;
        const py = 30;
        for (let y = py; y < py + 50; y++) {
            for (let x = px; x < px + 100; x++) bm.setPixel(x, y, water.id);
        }
        CellularAutomaton.step(bm, 0); // seed
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
    });

    bench('huge pour: 25000 active water cells, draining', () => {
        // Wider pool — closer to a "stress test" demo scenario.
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 32,
            materials: [stone, water],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        // 25000 water cells in a 250x100 block.
        const px = (W >> 1) - 125;
        const py = 10;
        for (let y = py; y < py + 100; y++) {
            for (let x = px; x < px + 250; x++) bm.setPixel(x, y, water.id);
        }
        CellularAutomaton.step(bm, 0);
        for (let t = 0; t < 10; t++) CellularAutomaton.step(bm, t);
    });

    bench('thin sheet: 12000 cells in a 240x50 puddle (mostly edges)', () => {
        // Edge-heavy scenario: long, shallow water spreading
        // across a wide floor. The lateral chain runs all the
        // way to the edges of the puddle most ticks, so the
        // adaptive `LATERAL_REACH` fork has more impact than
        // in a deep pool.
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 32,
            materials: [stone, water],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = H - 51; y < H - 1; y++) {
            for (let x = 8; x < 248; x++) bm.setPixel(x, y, water.id);
        }
        CellularAutomaton.step(bm, 0);
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
    });

    bench('first-call seed scan (256×128 cold bitmap)', () => {
        // Build, then call step once — measures the seed scan.
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 32,
            materials: [stone, water],
        });
        for (let y = H - 8; y < H; y++) {
            for (let x = 0; x < W; x++) bm.setPixel(x, y, stone.id);
        }
        for (let y = 16; y < 26; y++) {
            for (let x = (W >> 1) - 5; x < (W >> 1) + 5; x++) {
                bm.setPixel(x, y, water.id);
            }
        }
        CellularAutomaton.step(bm, 0);
    });
});
