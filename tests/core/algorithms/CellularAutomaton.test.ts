import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import * as CellularAutomaton from '../../../src/core/algorithms/CellularAutomaton.js';
import type { Material } from '../../../src/core/types.js';

const sand: Material = {
    id: 1,
    name: 'sand',
    color: 0xd4b06a,
    density: 1,
    friction: 0.5,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'sand',
};

const stone: Material = {
    id: 2,
    name: 'stone',
    color: 0x556070,
    density: 2.5,
    friction: 0.9,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0.5,
    simulation: 'static',
};

const water: Material = {
    id: 3,
    name: 'water',
    color: 0x4080c0,
    density: 1,
    friction: 0,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'water',
};

/** Build a small bitmap from a row-major grid of single-character cells. */
function gridBitmap(rows: string[]): ChunkedBitmap {
    const w = rows[0]!.length;
    const h = rows.length;
    // chunkSize must divide both width and height — using 1 is valid
    // for any grid shape and avoids GCD computation in test plumbing.
    const bm = new ChunkedBitmap({
        width: w,
        height: h,
        chunkSize: 1,
        materials: [sand, stone, water],
    });
    for (let y = 0; y < h; y++) {
        const row = rows[y]!;
        for (let x = 0; x < w; x++) {
            const ch = row[x];
            if (ch === 's') bm.setPixel(x, y, sand.id);
            else if (ch === '#') bm.setPixel(x, y, stone.id);
            else if (ch === 'w') bm.setPixel(x, y, water.id);
            // '.' and any other char → air (id 0)
        }
    }
    return bm;
}

/** Render the bitmap back to a grid of characters for assertion. */
function renderGrid(bm: ChunkedBitmap): string[] {
    const out: string[] = [];
    for (let y = 0; y < bm.height; y++) {
        let row = '';
        for (let x = 0; x < bm.width; x++) {
            const id = bm.getPixel(x, y);
            row +=
                id === sand.id
                    ? 's'
                    : id === stone.id
                      ? '#'
                      : id === water.id
                        ? 'w'
                        : '.';
        }
        out.push(row);
    }
    return out;
}

describe('CellularAutomaton.step', () => {
    it('a single sand grain falls one row per tick', () => {
        const bm = gridBitmap([
            's....',
            '.....',
            '.....',
            '#####',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual([
            '.....',
            's....',
            '.....',
            '#####',
        ]);
        CellularAutomaton.step(bm, 1);
        expect(renderGrid(bm)).toEqual([
            '.....',
            '.....',
            's....',
            '#####',
        ]);
    });

    it('sand at the bottom row stays put (no row below)', () => {
        const bm = gridBitmap(['s....']);
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual(['s....']);
    });

    it('sand resting on static rock does not move', () => {
        const bm = gridBitmap([
            's',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual(['s', '#']);
    });

    it('stone never moves regardless of air below', () => {
        const bm = gridBitmap([
            '#',
            '.',
            '.',
        ]);
        CellularAutomaton.step(bm, 0);
        CellularAutomaton.step(bm, 1);
        CellularAutomaton.step(bm, 2);
        expect(renderGrid(bm)).toEqual(['#', '.', '.']);
    });

    it('sand slides diagonally over a single static block', () => {
        const bm = gridBitmap([
            '.s.',
            '.#.',
            '...',
            '###',
        ]);
        CellularAutomaton.step(bm, 0);
        // tick=0 → goRight=true → side preference (-1, +1).
        // Sand at (1, 0) tries (1, 1)=#, blocked. Slides to (0, 1)=.
        expect(renderGrid(bm)).toEqual([
            '...',
            's#.',
            '...',
            '###',
        ]);
    });

    it('sand cannot tunnel through a wall to slide diagonally', () => {
        // (1, 1) is sand resting on (1, 2)=stone. Diagonals are
        // (0, 2)=. but (0, 1)=# — wall blocks the slide. (2, 2)=. and
        // (2, 1)=. — clear, slide allowed.
        const bm = gridBitmap([
            '...',
            '#s.',
            '.#.',
            '###',
        ]);
        CellularAutomaton.step(bm, 0);
        // Sand should slide to (2, 2), NOT to (0, 2) (wall in the way).
        expect(renderGrid(bm)).toEqual([
            '...',
            '#..',
            '.#s',
            '###',
        ]);
    });

    it('alternation: even tick prefers left, odd tick prefers right', () => {
        // Sand resting on a peak; both diagonals open. With even
        // tick, side-preference order is [-1, +1] — sand slides left.
        // With odd tick, [+1, -1] — sand slides right.
        const setupRows = [
            '.s.',
            '.#.',
            '...',
            '###',
        ];
        const bmEven = gridBitmap(setupRows);
        CellularAutomaton.step(bmEven, 0);
        expect(renderGrid(bmEven)).toEqual([
            '...',
            's#.',
            '...',
            '###',
        ]);

        const bmOdd = gridBitmap(setupRows);
        CellularAutomaton.step(bmOdd, 1);
        expect(renderGrid(bmOdd)).toEqual([
            '...',
            '.#s',
            '...',
            '###',
        ]);
    });

    it('a stack of sand collapses into a pyramid over time', () => {
        // Tall column of sand on a 5-wide floor. After enough ticks
        // it should spread into a pyramid (or close).
        const bm = gridBitmap([
            '..s..',
            '..s..',
            '..s..',
            '..s..',
            '#####',
        ]);
        for (let t = 0; t < 8; t++) {
            CellularAutomaton.step(bm, t);
        }
        // We don't pin the exact shape — implementation details of
        // alternation can swap left/right slides — but the total sand
        // count should be preserved and no sand should remain in
        // mid-air with empty cells below it.
        let sandCount = 0;
        for (let y = 0; y < bm.height; y++) {
            for (let x = 0; x < bm.width; x++) {
                if (bm.getPixel(x, y) === sand.id) {
                    sandCount++;
                    // No sand should have empty space directly below.
                    if (y + 1 < bm.height) {
                        const below = bm.getPixel(x, y + 1);
                        const belowLeft = x > 0 ? bm.getPixel(x - 1, y + 1) : sand.id;
                        const belowRight =
                            x + 1 < bm.width ? bm.getPixel(x + 1, y + 1) : sand.id;
                        // At least one of {below, below-left, below-right}
                        // must be non-air (otherwise the sand should
                        // have fallen further).
                        expect(below !== 0 || belowLeft !== 0 || belowRight !== 0).toBe(true);
                    }
                }
            }
        }
        expect(sandCount).toBe(4);
    });

    it('sand does not displace other sand (only air)', () => {
        // Two sand cells stacked; the lower one is on a stone floor.
        // Top sand should NOT swap with bottom sand.
        const bm = gridBitmap([
            's',
            's',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        // Top sand stays put (no air below or to either side at this
        // grid edge).
        expect(renderGrid(bm)).toEqual(['s', 's', '#']);
    });

    it('processing is bottom-up: a falling chain shifts down by one each tick', () => {
        const bm = gridBitmap([
            's',
            '.',
            '.',
            '.',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual(['.', 's', '.', '.']);
        CellularAutomaton.step(bm, 1);
        expect(renderGrid(bm)).toEqual(['.', '.', 's', '.']);
        CellularAutomaton.step(bm, 2);
        expect(renderGrid(bm)).toEqual(['.', '.', '.', 's']);
    });

    it('respects world boundaries — sand at x=0 with no left side just falls down', () => {
        const bm = gridBitmap([
            's..',
            '.#.',
            '...',
        ]);
        // Sand at (0, 0). Below at (0, 1)=. → falls straight.
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual([
            '...',
            's#.',
            '...',
        ]);
    });

    it('water falls straight down when the cell below is air', () => {
        const bm = gridBitmap([
            'w....',
            '.....',
            '.....',
            '#####',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual([
            '.....',
            'w....',
            '.....',
            '#####',
        ]);
    });

    it('water spreads horizontally on a flat floor over many ticks', () => {
        // Five-wide flat floor, water column dropped at the center.
        // v3 mass-based: water spreads via mass (cells may be partially
        // filled). Assert mass conservation + column drained.
        const bm = gridBitmap([
            '..w..',
            '..w..',
            '..w..',
            '#####',
        ]);
        const initialMass = (() => {
            let m = 0;
            for (let y = 0; y < bm.height; y++) {
                for (let x = 0; x < bm.width; x++) {
                    if (bm.getPixel(x, y) === water.id) m += bm.getMass(x, y);
                }
            }
            return m;
        })();
        for (let t = 0; t < 32; t++) CellularAutomaton.step(bm, t);
        let finalMass = 0;
        for (let y = 0; y < bm.height; y++) {
            for (let x = 0; x < bm.width; x++) {
                if (bm.getPixel(x, y) === water.id) finalMass += bm.getMass(x, y);
            }
        }
        expect(finalMass).toBeCloseTo(initialMass, 1);
        // Column drained — no water at row 0.
        for (let x = 0; x < bm.width; x++) {
            expect(bm.getPixel(x, 0)).toBe(0);
        }
    });

    it('a tall water column poured onto a flat floor levels into a single row', () => {
        // Regression for the "water behaves like sand" bug. With
        // per-tick uniform L/R preference, a contiguous water column
        // shifts as a block instead of spreading. Per-cell preference
        // (x parity XOR tick parity) makes adjacent cells try opposite
        // directions, so the column flattens into a single horizontal
        // row over enough ticks.
        //
        // 9-wide bitmap, 6-tall column poured into the center, stone
        // floor at the bottom row. After ~50 ticks the column should
        // have entirely flattened — every water cell on the floor row,
        // no taller-than-1 stack anywhere.
        const W = 9;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W,
            height: H,
            chunkSize: 1,
            materials: [sand, stone, water],
        });
        // Stone floor at y=H-1.
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        // 6-tall water column centered at x=4.
        for (let y = 0; y < 6; y++) bm.setPixel(4, y, water.id);

        const initialMass = 6.0;
        for (let t = 0; t < 100; t++) CellularAutomaton.step(bm, t);

        // v3: assert mass conservation + column drained (no water
        // above the floor row).
        let totalMass = 0;
        let aboveFloorMass = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (bm.getPixel(x, y) === water.id) {
                    const m = bm.getMass(x, y);
                    totalMass += m;
                    if (y < H - 2) aboveFloorMass += m;
                }
            }
        }
        expect(totalMass).toBeCloseTo(initialMass, 1);
        expect(aboveFloorMass).toBeCloseTo(0, 0);
    });

    it('water fills a U-shaped container from the bottom up', () => {
        const bm = gridBitmap([
            'w....',
            '#...#',
            '#...#',
            '#####',
        ]);
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // v3: assert mass conservation + all water reached the
        // bottom of the U (row 2). 1.0 mass spread or concentrated
        // there.
        let totalMass = 0;
        let bottomMass = 0;
        for (let y = 0; y < bm.height; y++) {
            for (let x = 0; x < bm.width; x++) {
                if (bm.getPixel(x, y) === water.id) {
                    const m = bm.getMass(x, y);
                    totalMass += m;
                    if (y === 2) bottomMass += m;
                }
            }
        }
        expect(totalMass).toBeCloseTo(1.0, 1);
        expect(bottomMass).toBeCloseTo(1.0, 1);
    });

    it('sand sinks through a water column on straight-down moves', () => {
        const bm = gridBitmap([
            's',
            'w',
            'w',
            '#',
        ]);
        // After one tick: sand swaps with water below (straight-down).
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual([
            'w',
            's',
            'w',
            '#',
        ]);
        // Second tick: sand swaps with water again.
        CellularAutomaton.step(bm, 1);
        expect(renderGrid(bm)).toEqual([
            'w',
            'w',
            's',
            '#',
        ]);
    });

    it('water does not displace sand (less dense)', () => {
        // Water above sand on a stone floor. Water can't fall into
        // the sand cell; it stays put.
        const bm = gridBitmap([
            'w',
            's',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGrid(bm)).toEqual([
            'w',
            's',
            '#',
        ]);
    });

    it('mixed pile: sand sinks to bottom, water rises to top', () => {
        // Vertical column alternating sand and water. After enough
        // ticks, all sand should be at the bottom and water above.
        const bm = gridBitmap([
            's',
            'w',
            's',
            'w',
            '#',
        ]);
        // Several ticks for sand to settle past water.
        for (let t = 0; t < 8; t++) CellularAutomaton.step(bm, t);
        // Counts preserved.
        let sandCount = 0;
        let waterCount = 0;
        for (let y = 0; y < bm.height; y++) {
            for (let x = 0; x < bm.width; x++) {
                const id = bm.getPixel(x, y);
                if (id === sand.id) sandCount++;
                else if (id === water.id) waterCount++;
            }
        }
        expect(sandCount).toBe(2);
        expect(waterCount).toBe(2);
        // Sand should be at rows 2 and 3 (above the stone floor at
        // row 4); water should be at rows 0 and 1.
        expect(bm.getPixel(0, 0)).toBe(water.id);
        expect(bm.getPixel(0, 1)).toBe(water.id);
        expect(bm.getPixel(0, 2)).toBe(sand.id);
        expect(bm.getPixel(0, 3)).toBe(sand.id);
    });

    it('a sand cell at rest accumulates timer and promotes at threshold', () => {
        // Sand on stone floor, settles to settled-sand after 3 ticks.
        const SETTLED = 4;
        const settledSand: Material = {
            id: SETTLED,
            name: 'settled-sand',
            color: 0xa08050,
            density: 1,
            friction: 0.7,
            restitution: 0.05,
            destructible: true,
            destructionResistance: 0,
            simulation: 'static',
        };
        const settlingSand: Material = {
            ...sand,
            settlesTo: SETTLED,
            settleAfterTicks: 3,
        };
        const bm = new ChunkedBitmap({
            width: 1,
            height: 2,
            chunkSize: 1,
            materials: [settlingSand, stone, settledSand],
        });
        bm.setPixel(0, 0, settlingSand.id);
        bm.setPixel(0, 1, stone.id);

        // Tick 1: can't move (stone below), timer 0→1.
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(settlingSand.id);
        expect(bm.cellTimers[0]).toBe(1);

        // Tick 2: timer 1→2.
        CellularAutomaton.step(bm, 1);
        expect(bm.getPixel(0, 0)).toBe(settlingSand.id);
        expect(bm.cellTimers[0]).toBe(2);

        // Tick 3: timer 2→3, threshold reached (3 ≥ 3) → promote.
        CellularAutomaton.step(bm, 2);
        expect(bm.getPixel(0, 0)).toBe(SETTLED);
        // setPixel auto-reset the timer.
        expect(bm.cellTimers[0]).toBe(0);
    });

    it('a moving sand cell does not accumulate timer (resets on every move)', () => {
        // Tall column of air with a single sand grain at the top.
        // Sand falls one row per tick; never has a chance to settle.
        const settlingSand: Material = {
            ...sand,
            settlesTo: 99, // would never fire
            settleAfterTicks: 1,
        };
        const bm = new ChunkedBitmap({
            width: 1,
            height: 6,
            chunkSize: 1,
            materials: [settlingSand],
        });
        bm.setPixel(0, 0, settlingSand.id);
        for (let t = 0; t < 5; t++) {
            CellularAutomaton.step(bm, t);
        }
        // Sand falls to the bottom row, still its original id.
        expect(bm.getPixel(0, 5)).toBe(settlingSand.id);
        // Timer at the resting cell — depends on whether the bottom
        // row has been hit yet. After 5 ticks from row 0, sand is at
        // row 5 and has been there for 0 ticks. We'd need one more
        // tick at the bottom for the timer to start incrementing.
        expect(bm.cellTimers[5 * bm.width]).toBe(0);
    });

    it('sand without settlesTo configured never promotes', () => {
        // Vanilla sand (no settling fields), parked on stone.
        const bm = gridBitmap(['s', '#']);
        for (let t = 0; t < 100; t++) CellularAutomaton.step(bm, t);
        // Still sand.
        expect(bm.getPixel(0, 0)).toBe(sand.id);
    });

    it('promoted material is static and does not move on subsequent ticks', () => {
        const SETTLED = 4;
        const settledSand: Material = {
            id: SETTLED,
            name: 'settled-sand',
            color: 0xa08050,
            density: 1,
            friction: 0.7,
            restitution: 0.05,
            destructible: true,
            destructionResistance: 0,
            simulation: 'static',
        };
        const settlingSand: Material = {
            ...sand,
            settlesTo: SETTLED,
            settleAfterTicks: 1,
        };
        const bm = new ChunkedBitmap({
            width: 1,
            height: 3,
            chunkSize: 1,
            materials: [settlingSand, settledSand, stone],
        });
        bm.setPixel(0, 0, settlingSand.id);
        bm.setPixel(0, 2, stone.id);

        // Tick 1: sand at row 0 can fall to row 1 (air below). It
        // moves; timer at the new position is 0 because setPixel
        // resets it.
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 1)).toBe(settlingSand.id);
        expect(bm.cellTimers[1]).toBe(0);

        // Tick 2: sand at row 1 has stone below; can't move. Timer 0→1,
        // threshold (1) reached → promote.
        CellularAutomaton.step(bm, 1);
        expect(bm.getPixel(0, 1)).toBe(SETTLED);

        // Tick 3+: settled-sand is static, never moves again.
        for (let t = 2; t < 10; t++) CellularAutomaton.step(bm, t);
        expect(bm.getPixel(0, 1)).toBe(SETTLED);
    });

    it('carving a settled cell removes it cleanly (no leftover state)', () => {
        const SETTLED = 4;
        const settledSand: Material = {
            id: SETTLED,
            name: 'settled-sand',
            color: 0xa08050,
            density: 1,
            friction: 0.7,
            restitution: 0.05,
            destructible: true,
            destructionResistance: 0,
            simulation: 'static',
        };
        const bm = new ChunkedBitmap({
            width: 1,
            height: 1,
            chunkSize: 1,
            materials: [settledSand],
        });
        bm.setPixel(0, 0, SETTLED);
        // Carve via setPixel(0).
        bm.setPixel(0, 0, 0);
        expect(bm.getPixel(0, 0)).toBe(0);
        // Timer is reset by setPixel automatically.
        expect(bm.cellTimers[0]).toBe(0);
    });

    it('unknown / unset simulation kind defaults to static (back-compat)', () => {
        // A material whose `simulation` is undefined behaves like static.
        const dirt: Material = {
            id: 3,
            name: 'dirt',
            color: 0x8b5a3c,
            density: 1,
            friction: 0.7,
            restitution: 0.1,
            destructible: true,
            destructionResistance: 0,
            // simulation: undefined  ← intentionally omitted
        };
        const bm = new ChunkedBitmap({
            width: 1,
            height: 3,
            chunkSize: 1,
            materials: [dirt],
        });
        bm.setPixel(0, 0, dirt.id);
        CellularAutomaton.step(bm, 0);
        // Dirt should not move.
        expect(bm.getPixel(0, 0)).toBe(dirt.id);
        expect(bm.getPixel(0, 1)).toBe(0);
    });
});

// ──────────────────────────────────────────────────────────────────────
// v2.3 — oil, gas, fire, multi-cell flow
// ──────────────────────────────────────────────────────────────────────

const oil: Material = {
    id: 5,
    name: 'oil',
    color: 0x3a2a1a,
    density: 0.9,
    friction: 0.2,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'oil',
};

const gas: Material = {
    id: 6,
    name: 'gas',
    color: 0x8090a0,
    density: 0.1,
    friction: 0,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'gas',
};

const fire: Material = {
    id: 7,
    name: 'fire',
    color: 0xff7030,
    density: 0,
    friction: 0,
    restitution: 0,
    destructible: true,
    destructionResistance: 0,
    simulation: 'fire',
    burnDuration: 20,
};

const wood: Material = {
    id: 8,
    name: 'wood',
    color: 0x80502c,
    density: 1,
    friction: 0.6,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
    simulation: 'static',
    flammable: true,
};

/**
 * Extended grid helper that registers the v2.3 materials so test
 * scenes can mix sand / water / oil / gas / fire / wood / stone.
 *
 *  - 's' sand · 'w' water · 'o' oil · 'g' gas · 'f' fire
 *  - '#' stone · 'W' wood (flammable static)
 *  - '.' air
 */
function gridBitmapV23(rows: string[]): ChunkedBitmap {
    const w = rows[0]!.length;
    const h = rows.length;
    const bm = new ChunkedBitmap({
        width: w,
        height: h,
        chunkSize: 1,
        materials: [sand, stone, water, oil, gas, fire, wood],
    });
    for (let y = 0; y < h; y++) {
        const row = rows[y]!;
        for (let x = 0; x < w; x++) {
            const ch = row[x];
            if (ch === 's') bm.setPixel(x, y, sand.id);
            else if (ch === '#') bm.setPixel(x, y, stone.id);
            else if (ch === 'w') bm.setPixel(x, y, water.id);
            else if (ch === 'o') bm.setPixel(x, y, oil.id);
            else if (ch === 'g') bm.setPixel(x, y, gas.id);
            else if (ch === 'f') bm.setPixel(x, y, fire.id);
            else if (ch === 'W') bm.setPixel(x, y, wood.id);
        }
    }
    return bm;
}

function renderGridV23(bm: ChunkedBitmap): string[] {
    const out: string[] = [];
    for (let y = 0; y < bm.height; y++) {
        let row = '';
        for (let x = 0; x < bm.width; x++) {
            const id = bm.getPixel(x, y);
            row +=
                id === sand.id ? 's'
                : id === stone.id ? '#'
                : id === water.id ? 'w'
                : id === oil.id ? 'o'
                : id === gas.id ? 'g'
                : id === fire.id ? 'f'
                : id === wood.id ? 'W'
                : '.';
        }
        out.push(row);
    }
    return out;
}

function runTicks(bm: ChunkedBitmap, n: number): void {
    for (let t = 0; t < n; t++) CellularAutomaton.step(bm, t);
}

describe('CellularAutomaton.step — oil', () => {
    it('oil falls one row per tick into pure air', () => {
        const bm = gridBitmapV23([
            'o',
            '.',
            '.',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGridV23(bm)).toEqual(['.', 'o', '.', '#']);
        CellularAutomaton.step(bm, 1);
        expect(renderGridV23(bm)).toEqual(['.', '.', 'o', '#']);
    });

    it('oil does not displace water on a fall — oil floats', () => {
        const bm = gridBitmapV23([
            'o',
            'w',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        // Oil's rank (3) is below water's (4); fall blocked. Oil
        // stays put — and there's no horizontal slot, so it's stuck.
        expect(renderGridV23(bm)).toEqual(['o', 'w', '#']);
    });

    it('water sinks through oil — heavier on bottom after one tick', () => {
        const bm = gridBitmapV23([
            'w',
            'o',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        // Density swap: water (4) > oil (3) downward.
        expect(renderGridV23(bm)).toEqual(['o', 'w', '#']);
    });

    it('sand sinks through oil — sand rank > oil rank', () => {
        const bm = gridBitmapV23([
            's',
            'o',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGridV23(bm)).toEqual(['o', 's', '#']);
    });

    it('oil spreads horizontally with multi-cell flow', () => {
        // 11-wide; pour a single oil cell at the center on a flat
        // floor. After a few ticks it should have moved several
        // cells from x=5 thanks to FLUID_FLOW_DIST=4.
        const bm = gridBitmapV23([
            '.....o.....',
            '###########',
        ]);
        CellularAutomaton.step(bm, 0);
        const after = renderGridV23(bm);
        // Single oil cell moved at least 1 cell away from x=5.
        const top = after[0]!;
        expect(top.indexOf('o')).not.toBe(5);
        expect(top.indexOf('o')).toBeGreaterThanOrEqual(0);
    });
});

describe('CellularAutomaton.step — gas', () => {
    it('gas rises through air toward the top', () => {
        // v3 mass-based: gas mass transfers up via stable-split.
        // After enough ticks the gas reaches row 0.
        const bm = gridBitmapV23([
            '.',
            '.',
            '.',
            'g',
        ]);
        for (let t = 0; t < 10; t++) CellularAutomaton.step(bm, t);
        // Gas mass should be at the top.
        expect(bm.getPixel(0, 0)).toBe(gas.id);
        expect(bm.getPixel(0, 3)).toBe(0);
    });

    it('gas bubbles up through water (gas rank 0 < water rank 4)', () => {
        const bm = gridBitmapV23([
            'w',
            'g',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(renderGridV23(bm)).toEqual(['g', 'w']);
    });

    it('gas does not pass through static stone above', () => {
        const bm = gridBitmapV23([
            '#',
            'g',
        ]);
        CellularAutomaton.step(bm, 0);
        // Stone is static — gas can't displace it regardless of
        // density. Without horizontal options gas stays put.
        expect(renderGridV23(bm)).toEqual(['#', 'g']);
    });

    it('gas at the top row stays put (no row above)', () => {
        const bm = gridBitmapV23(['g....']);
        CellularAutomaton.step(bm, 0);
        // Top row, no rise possible. Free horizontal cells exist
        // though — gas spreads sideways via the flow rule.
        const after = renderGridV23(bm);
        // The 'g' moved into row 0 somewhere; not necessarily at x=0.
        expect(after[0]!.includes('g')).toBe(true);
    });

    it('gas pocket trapped under stone with side opening rises out', () => {
        // A gas cell trapped at (1, 1) under stone with an air
        // column at x=2. Should diagonal-up out and rise.
        const bm = gridBitmapV23([
            '#.#',
            '#g.',
            '###',
        ]);
        runTicks(bm, 4);
        // Gas should have escaped to the top row (any non-# slot).
        const after = renderGridV23(bm);
        expect(after.join('').includes('g')).toBe(true);
        // It shouldn't be stuck back at (1, 1).
        expect(after[1]![1]).not.toBe('g');
    });
});

describe('CellularAutomaton.step — fire', () => {
    it('a lone fire cell burns out after burnDuration ticks → air', () => {
        const bm = gridBitmapV23([
            'f',
        ]);
        // burnDuration is 20 — 20 ticks: ages 0..19, dies on the
        // 20th step (when current+1 reaches threshold).
        runTicks(bm, 20);
        expect(renderGridV23(bm)).toEqual(['.']);
    });

    it('fire ignites an adjacent flammable wood cell', () => {
        const bm = gridBitmapV23([
            'fW',
        ]);
        CellularAutomaton.step(bm, 0);
        // Wood at (1, 0) becomes fire. Original fire still burning
        // (only 1 tick of burnDuration=20 elapsed).
        expect(bm.getPixel(1, 0)).toBe(fire.id);
        expect(bm.getPixel(0, 0)).toBe(fire.id);
    });

    it('fire spreads through a wood line and consumes it', () => {
        const bm = gridBitmapV23([
            'fWWWW',
        ]);
        // burnDuration = 20. Fire ignites one neighbor per tick.
        // After enough ticks, all wood should be gone (burned to air).
        runTicks(bm, 60);
        const after = renderGridV23(bm);
        // No wood remains.
        expect(after[0]!.includes('W')).toBe(false);
    });

    it('fire does not ignite non-flammable static (stone)', () => {
        const bm = gridBitmapV23([
            'f#',
        ]);
        // Stone is static but NOT flammable. Fire just ages and dies.
        runTicks(bm, 20);
        expect(renderGridV23(bm)).toEqual(['.#']);
    });
});

// ──────────────────────────────────────────────────────────────────────
// v2.4 — sparse active-cell tracking
// ──────────────────────────────────────────────────────────────────────

describe('CellularAutomaton.step — active-cell tracking', () => {
    it('first step seeds the active set from existing mobile cells', () => {
        const bm = gridBitmap([
            's....',
            '.....',
            '#####',
        ]);
        // Bitmap built before any step ran. setPixel didn't auto-mark
        // because tracking wasn't initialized yet. The first step
        // must scan and seed the set itself.
        expect(bm.hasActiveCellTracking).toBe(false);
        CellularAutomaton.step(bm, 0);
        // Sand fell from (0,0) to (0,1).
        expect(bm.getPixel(0, 1)).toBe(sand.id);
        expect(bm.hasActiveCellTracking).toBe(true);
    });

    it('a settled world drops the active set to empty', () => {
        // Sand on stone with no air around it — nothing moves, nothing
        // settles (vanilla sand has no settlesTo). After one tick the
        // active set should be empty.
        const bm = gridBitmap([
            's',
            '#',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.activeCells.size).toBe(0);
        // Subsequent steps are no-ops — bitmap unchanged.
        CellularAutomaton.step(bm, 1);
        CellularAutomaton.step(bm, 2);
        expect(renderGrid(bm)).toEqual(['s', '#']);
        expect(bm.activeCells.size).toBe(0);
    });

    it('settling sand keeps itself active until it promotes', () => {
        // Sand resting on stone with settling configured. Each tick
        // the rest-timer ticks; the cell must stay in the active set
        // so the next call processes it again.
        const SETTLED = 4;
        const settledSand: Material = {
            id: SETTLED,
            name: 'settled-sand',
            color: 0xa08050,
            density: 1,
            friction: 0.7,
            restitution: 0.05,
            destructible: true,
            destructionResistance: 0,
            simulation: 'static',
        };
        const settlingSand: Material = {
            ...sand,
            settlesTo: SETTLED,
            settleAfterTicks: 3,
        };
        const bm = new ChunkedBitmap({
            width: 1, height: 2, chunkSize: 1,
            materials: [settlingSand, stone, settledSand],
        });
        bm.setPixel(0, 0, settlingSand.id);
        bm.setPixel(0, 1, stone.id);

        CellularAutomaton.step(bm, 0);
        expect(bm.activeCells.has(0)).toBe(true); // still ticking
        CellularAutomaton.step(bm, 1);
        expect(bm.activeCells.has(0)).toBe(true);
        CellularAutomaton.step(bm, 2);
        // Promoted to SETTLED (static); active set drops it next tick.
        expect(bm.getPixel(0, 0)).toBe(SETTLED);
        CellularAutomaton.step(bm, 3);
        expect(bm.activeCells.size).toBe(0);
    });

    it('a stuck non-settling fluid drops from the active set', () => {
        // Water surrounded by stone has nowhere to go and no settling
        // config. After one tick it should be removed from the
        // active set.
        const bm = gridBitmap([
            '###',
            '#w#',
            '###',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.activeCells.size).toBe(0);
        // Bitmap unchanged.
        expect(renderGrid(bm)).toEqual(['###', '#w#', '###']);
    });

    it('external setPixel reactivates a previously-stuck cell', () => {
        // Water blocked on a stone shelf. Active set drops it.
        // Then we carve a hole in the shelf via setPixel — the
        // sand-falling-into-newly-air cell must be processed next
        // tick.
        const bm = gridBitmap([
            'w',
            '#',
            '.',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.activeCells.size).toBe(0);
        // Carve the stone away.
        bm.setPixel(0, 1, 0);
        // Auto-marked the carved cell + its in-bounds neighbors,
        // including the water cell at (0, 0).
        expect(bm.activeCells.has(0)).toBe(true);
        CellularAutomaton.step(bm, 1);
        // Water fell into the hole.
        expect(bm.getPixel(0, 1)).toBe(water.id);
    });

    it('fire keeps itself active every tick until burnDuration elapses', () => {
        // Lone fire cell with nothing flammable nearby. It must
        // re-mark itself active each tick so its burn timer
        // advances; otherwise the cell would stop processing after
        // a single tick and never die.
        const bm = gridBitmapV23(['f']);
        CellularAutomaton.step(bm, 0);
        expect(bm.activeCells.has(0)).toBe(true); // still alive
        // Run through to burnout. burnDuration in tests is 20.
        runTicks(bm, 19);
        expect(bm.getPixel(0, 0)).toBe(0); // air
    });

    it('step on an empty bitmap is a no-op (no allocation explosions)', () => {
        // Pure air → seed scan finds nothing → step returns early.
        const bm = new ChunkedBitmap({
            width: 4, height: 4, chunkSize: 2,
            materials: [sand, water, stone],
        });
        for (let t = 0; t < 100; t++) CellularAutomaton.step(bm, t);
        expect(bm.activeCells.size).toBe(0);
    });

    it('settled-sand bitmap stays settled across many empty-step ticks', () => {
        // Sand promoted to a static "settled-sand" then continues
        // running step many times. The static cell must NOT re-enter
        // the active set, and the bitmap must remain stable.
        const SETTLED = 4;
        const settledSand: Material = {
            id: SETTLED,
            name: 'settled-sand',
            color: 0xa08050,
            density: 1, friction: 0.7, restitution: 0.05,
            destructible: true, destructionResistance: 0,
            simulation: 'static',
        };
        const settlingSand: Material = {
            ...sand,
            settlesTo: SETTLED,
            settleAfterTicks: 1,
        };
        const bm = new ChunkedBitmap({
            width: 1, height: 2, chunkSize: 1,
            materials: [settlingSand, stone, settledSand],
        });
        bm.setPixel(0, 0, settlingSand.id);
        bm.setPixel(0, 1, stone.id);
        // Tick 1 promotes sand → SETTLED. Run 100 more steps to
        // confirm the static cell stays out of the active set.
        for (let t = 0; t < 100; t++) CellularAutomaton.step(bm, t);
        expect(bm.getPixel(0, 0)).toBe(SETTLED);
        expect(bm.activeCells.size).toBe(0);
    });
});

describe('CellularAutomaton.step — multi-cell lateral spread (v3.0.2)', () => {
    // v3.0.2 introduced multi-cell lateral reach so flattening
    // propagates ~5 cells per tick — roughly 5× the gravity rate.
    // Each step in the lateral chain uses fresh state, so mass
    // cascades outward in a single tick.

    it('a single water cell spreads ~5 cells per tick laterally', () => {
        // Sealed 1-tall channel — only horizontal motion possible.
        const W = 21;
        const H = 3;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) {
            bm.setPixel(x, 0, stone.id);
            bm.setPixel(x, 2, stone.id);
        }
        bm.setPixel(W >> 1, 1, water.id);
        CellularAutomaton.step(bm, 0);
        let leftmost = W;
        let rightmost = -1;
        for (let x = 0; x < W; x++) {
            if (bm.getPixel(x, 1) === water.id) {
                if (x < leftmost) leftmost = x;
                if (x > rightmost) rightmost = x;
            }
        }
        const center = W >> 1;
        // After 1 tick, mass should have reached at least 4 cells
        // on each side of the source (5 in the standard config;
        // assertion is "at least 4" to allow for tuning).
        expect(center - leftmost).toBeGreaterThanOrEqual(4);
        expect(rightmost - center).toBeGreaterThanOrEqual(4);
    });

    it('a 6-tall column drains AND flattens within 30 ticks', () => {
        const W = 13;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < 6; y++) bm.setPixel(W >> 1, y, water.id);
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // No water above the floor row.
        for (let y = 0; y < H - 2; y++) {
            for (let x = 0; x < W; x++) {
                expect(bm.getPixel(x, y)).toBe(0);
            }
        }
        // Floor cells near-uniform.
        const masses: number[] = [];
        for (let x = 0; x < W; x++) {
            if (bm.getPixel(x, H - 2) === water.id) {
                masses.push(bm.getMass(x, H - 2));
            }
        }
        const max = Math.max(...masses);
        const min = Math.min(...masses);
        expect(max - min).toBeLessThan(0.05);
    });
});

describe('CellularAutomaton.step — surface flatness + no orphans (v3.0.1)', () => {
    // v3.0.1 dropped MIN_FLOW from 0.005 to MIN_MASS (0.0001) so
    // cells fully equalize instead of freezing once differences
    // hit `4 × MIN_FLOW`. Also added evaporation for stuck-tiny
    // cells. The result is genuinely flat surfaces and no
    // mid-air water particles.

    it('a 6-tall column drains to a uniform floor layer (max-min < 0.05)', () => {
        const W = 13;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < 6; y++) bm.setPixel(W >> 1, y, water.id);
        for (let t = 0; t < 500; t++) CellularAutomaton.step(bm, t);

        // No water above the floor row.
        for (let y = 0; y < H - 2; y++) {
            for (let x = 0; x < W; x++) {
                expect(bm.getPixel(x, y)).toBe(0);
            }
        }
        // Floor row masses near-uniform.
        const masses: number[] = [];
        for (let x = 0; x < W; x++) {
            if (bm.getPixel(x, H - 2) === water.id) {
                masses.push(bm.getMass(x, H - 2));
            }
        }
        const max = Math.max(...masses);
        const min = Math.min(...masses);
        expect(max - min).toBeLessThan(0.05);
    });

    it('a single falling water cell reaches the floor (no orphan)', () => {
        const W = 3;
        const H = 10;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        bm.setPixel(W >> 1, 0, water.id);
        for (let t = 0; t < 50; t++) CellularAutomaton.step(bm, t);
        for (let y = 0; y < H - 2; y++) {
            for (let x = 0; x < W; x++) {
                expect(bm.getPixel(x, y)).toBe(0);
            }
        }
    });

    it('a sub-MIN_MASS water cell evaporates on its first step', () => {
        const bm = new ChunkedBitmap({
            width: 1, height: 1, chunkSize: 1,
            materials: [water],
        });
        bm.setMass(0, 0, 0.00005, water.id);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(0);
    });
});

describe('CellularAutomaton.step — mass-based fluid (v3)', () => {
    it('water mass is conserved across many ticks', () => {
        // Pour 6 mass into a sealed box and verify it stays at 6.
        const W = 11;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [stone, water],
        });
        for (let x = 0; x < W; x++) {
            bm.setPixel(x, 0, stone.id);
            bm.setPixel(x, H - 1, stone.id);
        }
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        for (let y = 1; y < 7; y++) bm.setPixel(W >> 1, y, water.id);
        const initial = (() => {
            let m = 0;
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    if (bm.getPixel(x, y) === water.id) m += bm.getMass(x, y);
                }
            }
            return m;
        })();
        for (let t = 0; t < 300; t++) CellularAutomaton.step(bm, t);
        let after = 0;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (bm.getPixel(x, y) === water.id) after += bm.getMass(x, y);
            }
        }
        expect(after).toBeCloseTo(initial, 1);
    });

    it('water on a flat floor settles into a smooth bell-shape distribution', () => {
        // Single 6-tall water column on a 13-wide floor. After
        // many ticks every cell along the floor row should have
        // some water (smooth gradient from center outward).
        const W = 13;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [stone, water],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < 6; y++) bm.setPixel(W >> 1, y, water.id);
        for (let t = 0; t < 200; t++) CellularAutomaton.step(bm, t);

        // Floor row should have water at the central cells (mass
        // gradient outward). Check that at least half the floor
        // cells contain water (any mass > MIN_MASS).
        let waterCellsOnFloor = 0;
        for (let x = 0; x < W; x++) {
            if (bm.getPixel(x, H - 2) === water.id) waterCellsOnFloor++;
        }
        expect(waterCellsOnFloor).toBeGreaterThanOrEqual(7);
    });
});

describe('CellularAutomaton.step — water column drainage (v3 mass-based)', () => {
    it('a tall water column drains and conserves mass on the floor row', () => {
        const bm = gridBitmapV23([
            '.............',
            '.............',
            '.............',
            '.............',
            '.............',
            '.............',
            '......w......',
            '......w......',
            '......w......',
            '......w......',
            '......w......',
            '......w......',
            '#############',
        ]);
        runTicks(bm, 200);
        // v3: assert mass conservation + column drained (no water
        // above the floor row).
        let totalMass = 0;
        let aboveFloorMass = 0;
        const H = bm.height;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < bm.width; x++) {
                if (bm.getPixel(x, y) === water.id) {
                    const m = bm.getMass(x, y);
                    totalMass += m;
                    if (y < H - 2) aboveFloorMass += m;
                }
            }
        }
        expect(totalMass).toBeCloseTo(6.0, 1);
        expect(aboveFloorMass).toBeCloseTo(0, 0);
    });
});

// ──────────────────────────────────────────────────────────────────────
// v2.5 — invariants surfaced by the tuning-research probe (see
// docs-dev/04-tuning-research.md). Keepers from the probe move
// here; gotchas (e.g. burnDuration > 256 → infinite burn) are
// documented in the research file, not pinned as test invariants
// (we may fix them later).
// ──────────────────────────────────────────────────────────────────────

describe('CellularAutomaton.step — boundary timers', () => {
    it('burnDuration=1 kills fire on its first step', () => {
        // Minimum legal value (registry rejects burnDuration < 1).
        // The condition `current + 1 >= burnDuration` fires at
        // current=0, so the cell turns to air on step 0.
        const fireMat: Material = { ...fire, burnDuration: 1 };
        const bm = new ChunkedBitmap({
            width: 1, height: 1, chunkSize: 1,
            materials: [fireMat],
        });
        bm.setPixel(0, 0, fireMat.id);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(0);
    });

    it('settleAfterTicks=1 promotes on first stationary tick', () => {
        // Minimum legal value (registry rejects < 1). Sand on stone
        // can't fall; maybeSettle bumps timer 0→1, threshold reached,
        // promote.
        const SETTLED = 4;
        const settledSand: Material = {
            id: SETTLED, name: 'settled', color: 0xa08050,
            density: 1, friction: 0.7, restitution: 0.05,
            destructible: true, destructionResistance: 0,
            simulation: 'static',
        };
        const settlingSand: Material = {
            ...sand,
            settlesTo: SETTLED,
            settleAfterTicks: 1,
        };
        const bm = new ChunkedBitmap({
            width: 1, height: 2, chunkSize: 1,
            materials: [settlingSand, stone, settledSand],
        });
        bm.setPixel(0, 0, settlingSand.id);
        bm.setPixel(0, 1, stone.id);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(SETTLED);
    });
});

describe('CellularAutomaton.step — same-rank fluids do not swap', () => {
    it('water column on water rests stable on stone', () => {
        const bm = new ChunkedBitmap({
            width: 1, height: 3, chunkSize: 1,
            materials: [water, stone],
        });
        bm.setPixel(0, 0, water.id);
        bm.setPixel(0, 1, water.id);
        bm.setPixel(0, 2, stone.id);
        for (let t = 0; t < 5; t++) CellularAutomaton.step(bm, t);
        expect(bm.getPixel(0, 0)).toBe(water.id);
        expect(bm.getPixel(0, 1)).toBe(water.id);
    });

    it('oil on oil — neither moves', () => {
        const bm = new ChunkedBitmap({
            width: 1, height: 3, chunkSize: 1,
            materials: [oil, stone],
        });
        bm.setPixel(0, 0, oil.id);
        bm.setPixel(0, 1, oil.id);
        bm.setPixel(0, 2, stone.id);
        for (let t = 0; t < 5; t++) CellularAutomaton.step(bm, t);
        expect(bm.getPixel(0, 0)).toBe(oil.id);
        expect(bm.getPixel(0, 1)).toBe(oil.id);
    });
});

describe('CellularAutomaton.step — fire density-swap & water reaction', () => {
    // Fire's `simulation` is `'fire'`, not `'static'`. Density swaps
    // from neighboring fluids treat fire as a normal rank-2 cell and
    // can move it. The exception is water: as of v2.7.2, water
    // adjacent to fire extinguishes both cells before any density
    // swap or ignition fires.
    it('gas below fire — gas rises, fire pushed down', () => {
        const bm = gridBitmapV23([
            'f',
            'g',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(gas.id);
        expect(bm.getPixel(0, 1)).toBe(fire.id);
    });

    it('water above fire — both consumed (water extinguishes, v2.7.2)', () => {
        const bm = gridBitmapV23([
            'w',
            'f',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(0);
        expect(bm.getPixel(0, 1)).toBe(0);
    });

    it('water beside fire — both consumed', () => {
        const bm = gridBitmapV23([
            'fw',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(0);
        expect(bm.getPixel(1, 0)).toBe(0);
    });

    it('water diagonal to fire (cardinal cells stoned) does NOT extinguish', () => {
        // Fire at (0,0), water at (1,1) — diagonal. The cells
        // between them ((1,0) and (0,1)) are stone, so water
        // can't flow to be cardinal-adjacent and the reaction
        // (cardinal-only) doesn't fire. Both survive.
        const bm = gridBitmapV23([
            'f#',
            '#w',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(fire.id);
        expect(bm.getPixel(1, 1)).toBe(water.id);
    });

    it('water-soaked fire does not ignite adjacent wood', () => {
        // Fire next to water AND wood. The water reaction fires
        // before the ignition pass, so the wood survives.
        const bm = gridBitmapV23([
            'wfW',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(0);
        expect(bm.getPixel(1, 0)).toBe(0);
        expect(bm.getPixel(2, 0)).toBe(wood.id);
    });

    it('sand above fire — sand sinks, fire pushed up', () => {
        const bm = gridBitmapV23([
            's',
            'f',
        ]);
        CellularAutomaton.step(bm, 0);
        expect(bm.getPixel(0, 0)).toBe(fire.id);
        expect(bm.getPixel(0, 1)).toBe(sand.id);
    });
});

describe('CellularAutomaton.step — mixed-rank stack equilibrium', () => {
    it('5-fluid stack on stone resolves to density-sorted top-down', () => {
        // Initial: . / g / o / w / s / # (ill-sorted)
        const bm = new ChunkedBitmap({
            width: 1, height: 6, chunkSize: 1,
            materials: [sand, stone, water, oil, gas],
        });
        bm.setPixel(0, 1, gas.id);
        bm.setPixel(0, 2, oil.id);
        bm.setPixel(0, 3, water.id);
        bm.setPixel(0, 4, sand.id);
        bm.setPixel(0, 5, stone.id);

        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);

        // Steady state: gas(0), air(1), oil(2), water(3), sand(4), stone(5).
        expect(bm.getPixel(0, 0)).toBe(gas.id);
        expect(bm.getPixel(0, 1)).toBe(0);
        expect(bm.getPixel(0, 2)).toBe(oil.id);
        expect(bm.getPixel(0, 3)).toBe(water.id);
        expect(bm.getPixel(0, 4)).toBe(sand.id);
        expect(bm.getPixel(0, 5)).toBe(stone.id);
    });
});

describe('CellularAutomaton.step — fluid past fall column (v3.1.2)', () => {
    // v3.1.2: a vertical fall column (water pouring off a cliff
    // edge) used to act as a "wall" for water flowing past at the
    // column's row. The lateral-equalize scan terminated at the
    // column cell on `diff <= 0` (column had equal/higher mass
    // than the running water remainder), so air on the far side
    // of the column never received flow. The fix detects "this
    // target is part of a column being fed from above" by
    // checking the cell directly above and skips past it instead
    // of terminating the scan.
    it('lateral flow propagates past a same-material column cell', () => {
        const W = 20;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        // Floor at row 6 so water at row 5 can't fall; isolates
        // the lateral-scan behavior.
        for (let x = 0; x < W; x++) bm.setPixel(x, 6, stone.id);
        // Running water at row 5, columns 0–4.
        for (let x = 0; x <= 4; x++) bm.setPixel(x, 5, water.id);
        // 2-tall column at x=10. The cell at (10,5) has same-
        // material directly above (10,4), so the v3.1.2
        // column-detection skip fires.
        bm.setPixel(10, 4, water.id);
        bm.setPixel(10, 5, water.id);
        CellularAutomaton.step(bm, 0);
        // Air at (11, 5) should now hold water — the lateral
        // scan from running cells reached past column 10.
        expect(bm.getPixel(11, 5)).toBe(water.id);
    });

    it('lateral termination still works at a settled pool surface (no above feed)', () => {
        // Settled pool surface: cells at row 6 with air above
        // and stone below. No column-detection skip should fire
        // (above is air), so the scan terminates on the first
        // equal-mass neighbor, preserving the v3.0.3 perf opt.
        const W = 8;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let x = 0; x < W; x++) bm.setPixel(x, 6, water.id);
        CellularAutomaton.step(bm, 0);
        // Pool intact: every cell at row 6 still water.
        for (let x = 0; x < W; x++) {
            expect(bm.getPixel(x, 6)).toBe(water.id);
        }
    });
});
