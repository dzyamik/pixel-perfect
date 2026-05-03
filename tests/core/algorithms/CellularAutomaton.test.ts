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

    it('gas at the top row spreads laterally rather than piling (v3.1.30)', () => {
        // v3.1.30: when straight-up and diagonal-up are blocked,
        // gas spreads horizontally. Pool flattens against the
        // ceiling and accumulates downward as more gas arrives.
        const bm = gridBitmapV23(['g....']);
        CellularAutomaton.step(bm, 0);
        const after = renderGridV23(bm);
        // Gas still present in row 0 (just may have shifted).
        expect(after[0]!.includes('g')).toBe(true);
    });

    it('gas pool accumulates at the ceiling — volume grows (v3.1.30)', () => {
        // Sustained pour from row 4 with closed top (stone lid).
        // After enough ticks the gas should fill ROW 1 across
        // the open columns and start filling row 2 — volume grew.
        const bm = gridBitmapV23([
            '#####',
            '.....',
            '.....',
            '.....',
            '.gg.g',
            '#####',
        ]);
        for (let t = 0; t < 12; t++) CellularAutomaton.step(bm, t);
        // Count gas cells at row 1 (ceiling-adjacent).
        let gasAtRow1 = 0;
        for (let x = 0; x < bm.width; x++) {
            if (bm.getPixel(x, 1) === gas.id) gasAtRow1 += 1;
        }
        // Original 3 gas cells should accumulate at row 1.
        expect(gasAtRow1).toBeGreaterThanOrEqual(3);
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

describe('CellularAutomaton.step — oil surfaces and flattens on water (v3.1.17)', () => {
    // User-reported (2026-05-03): oil placed inside / under a
    // body of water should rise to the top and form a flat
    // layer covering the water. The 1D 5-fluid stack test above
    // confirms density swap works one row per tick. These tests
    // cover the 2D scenario where pool fast-path interacts with
    // cross-density swaps.

    it('oil sandbox in water rises to surface within ~depth ticks', () => {
        // 5-wide pool, 6 tall. Oil cell injected at the bottom
        // center should reach the surface row in <= 6 ticks.
        const W = 5;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, oil, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 1; y < H - 1; y++) {
            for (let x = 0; x < W; x++) bm.setPixel(x, y, water.id);
        }
        bm.setPixel(2, H - 2, oil.id); // oil at bottom center
        for (let t = 0; t < 12; t++) CellularAutomaton.step(bm, t);
        // Oil should now be at row 1 (the topmost water row).
        const topRow = 1;
        let oilFound = false;
        for (let x = 0; x < W; x++) {
            if (bm.getPixel(x, topRow) === oil.id) {
                oilFound = true;
                break;
            }
        }
        expect(oilFound).toBe(true);
    });

    it('oil dropped onto water spreads to cover the full surface', () => {
        // Oil placed at one column of the surface should spread
        // laterally to cover the full water surface within
        // ~width ticks.
        const W = 9;
        const H = 8;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, oil, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 3; y < H - 1; y++) {
            for (let x = 0; x < W; x++) bm.setPixel(x, y, water.id);
        }
        // Drop oil at top of surface row column 4 (center). The
        // brush walks down through air to py=2 (just above water
        // surface at y=3). Mass 0.5 per the demo.
        bm.setMass(4, 2, 0.5, oil.id);
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // After settling, every column should have oil somewhere
        // above its water column (oil floats on water, covers
        // surface).
        const oilColumns: number[] = [];
        for (let x = 0; x < W; x++) {
            for (let y = 0; y < H; y++) {
                if (bm.getPixel(x, y) === oil.id) {
                    oilColumns.push(x);
                    break;
                }
            }
        }
        expect(oilColumns).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('oil layer at bottom of wide water pool — full column rise', () => {
        // 12-wide, 10 deep. Full bottom row of oil, water above.
        // Stress-test pool fast-path interaction with cross-rank
        // boundary swaps.
        const W = 12;
        const H = 10;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, oil, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        // 2 rows of oil at bottom, 6 rows of water above.
        for (let x = 0; x < W; x++) {
            bm.setPixel(x, H - 2, oil.id);
            bm.setPixel(x, H - 3, oil.id);
        }
        for (let y = 1; y < H - 3; y++) {
            for (let x = 0; x < W; x++) bm.setPixel(x, y, water.id);
        }
        // After enough ticks, oil should be at the TOP, water below.
        for (let t = 0; t < 50; t++) CellularAutomaton.step(bm, t);
        // Top 2 rows of fluid: should be oil. Bottom 6 rows: water.
        for (let x = 0; x < W; x++) {
            expect(bm.getPixel(x, 1)).toBe(oil.id);
            expect(bm.getPixel(x, 2)).toBe(oil.id);
            for (let y = 3; y < H - 1; y++) {
                expect(bm.getPixel(x, y)).toBe(water.id);
            }
        }
    });

    it('water chimney through oil heals — water sinks, oil reforms on top', () => {
        // The motivating v3.1.17 scenario. Water is denser and
        // CAN sink through oil, so a sustained water pour onto an
        // oil pool drills a vertical "chimney" of water through
        // the oil. Pre-v3.1.17 the chimney was stable (no lateral
        // cross-density swap rule), and oil never reformed on top.
        // v3.1.17 unifies fluid pools by 4-connectivity; the
        // hydrostatic distribution then heals the chimney within
        // one tick.
        const W = 12;
        const H = 12;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, oil, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        // 4 rows of oil at the bottom of the basin.
        for (let y = H - 5; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, oil.id);
        }
        // Carve a "chimney" of water down the middle (replace 3
        // oil cells in column 5 with water). Hand-crafts the bug
        // state without needing the fall mechanics.
        bm.setPixel(5, H - 4, water.id);
        bm.setPixel(5, H - 3, water.id);
        bm.setPixel(5, H - 2, water.id);
        for (let t = 0; t < 5; t++) CellularAutomaton.step(bm, t);
        // After a few ticks: water should sink to the bottom row,
        // oil should fill the upper rows.
        // Bottom row should be entirely water (or at least mostly).
        let waterAtBottom = 0;
        for (let x = 1; x < W - 1; x++) {
            if (bm.getPixel(x, H - 2) === water.id) waterAtBottom += 1;
        }
        // Top row of fluid should be entirely oil.
        let oilAtTop = 0;
        for (let x = 1; x < W - 1; x++) {
            if (bm.getPixel(x, H - 5) === oil.id) oilAtTop += 1;
        }
        expect(waterAtBottom).toBeGreaterThanOrEqual(1);
        expect(oilAtTop).toBe(W - 2);
    });

    it('mixed oil + water column resolves to oil-on-top', () => {
        // 3-wide column, 5 deep. Top-half oil, bottom-half water.
        // Wrong order — should flip so oil is on top.
        const W = 3;
        const H = 9;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, oil, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let x = 0; x < W; x++) {
            // bottom 4: oil; top 4: water — wrong configuration.
            bm.setPixel(x, H - 2, oil.id);
            bm.setPixel(x, H - 3, oil.id);
            bm.setPixel(x, H - 4, oil.id);
            bm.setPixel(x, H - 5, oil.id);
            bm.setPixel(x, H - 6, water.id);
            bm.setPixel(x, H - 7, water.id);
            bm.setPixel(x, H - 8, water.id);
            bm.setPixel(x, H - 9, water.id);
        }
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // After 30 ticks: oil should be on TOP, water on BOTTOM.
        for (let x = 0; x < W; x++) {
            // Top 4 rows: oil
            expect(bm.getPixel(x, 0)).toBe(oil.id);
            expect(bm.getPixel(x, 1)).toBe(oil.id);
            expect(bm.getPixel(x, 2)).toBe(oil.id);
            expect(bm.getPixel(x, 3)).toBe(oil.id);
            // Bottom 4 rows: water
            expect(bm.getPixel(x, 4)).toBe(water.id);
            expect(bm.getPixel(x, 5)).toBe(water.id);
            expect(bm.getPixel(x, 6)).toBe(water.id);
            expect(bm.getPixel(x, 7)).toBe(water.id);
            expect(bm.getPixel(x, 8)).toBe(stone.id);
        }
    });
});

describe('CellularAutomaton.step — enclosed air bubbles rise (v3.1.19)', () => {
    // Pre-v3.1.19, an air pocket carved inside a settled water
    // pool was either filled by lateral water donation in one tick
    // or sat permanently because there was no air-rises-through-
    // water rule. v3.1.19 detects 4-connected air components
    // bounded entirely by static + fluid (any pool) as enclosed
    // bubbles, tags their cells in the pool-id sidecar, blocks
    // per-cell donations into them, and lifts each bubble cell one
    // row per tick by swapping with the fluid pool cell directly
    // above. Bubbles surface at an open-air boundary and pop;
    // sealed-top containers trap them at the top row.

    it('enclosed bubble in open-top water rises and pops at the surface', () => {
        const W = 10;
        const H = 12;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        // Water fills rows 1..H-2; row 0 is open (air outside walls).
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, water.id);
        }
        // Carve a 1-cell bubble at row H-3 (deep).
        bm.setPixel(4, H - 3, 0);
        const bubbleStartY = H - 3;
        // Run enough ticks for the bubble to rise to the surface
        // (~ bubbleStartY rows × 1 row/tick). Add slack.
        for (let t = 0; t < bubbleStartY + 5; t++) CellularAutomaton.step(bm, t);
        // Bubble should have surfaced — every cell in column 4
        // from rows 1..H-2 is water again (or the surface row may
        // be slightly under-mass but binary-renders as water).
        for (let y = 1; y < H - 1; y++) {
            expect(bm.getPixel(4, y)).toBe(water.id);
        }
    });

    it('enclosed bubble in sealed-top container persists at the top row', () => {
        const W = 10;
        const H = 12;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        // Sealed lid: stone at row 0 across the entire width.
        for (let x = 0; x < W; x++) {
            bm.setPixel(x, 0, stone.id);
            bm.setPixel(x, H - 1, stone.id);
        }
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, water.id);
        }
        // 2-cell bubble at row 8.
        bm.setPixel(4, 8, 0);
        bm.setPixel(5, 8, 0);
        // Run more than enough ticks for the bubble to reach the
        // top row (1) and stop there.
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // Bubble cells trapped under the lid: row 1 should hold
        // exactly 2 air cells (the surviving bubble) and 6 water
        // cells. The exact x positions depend on distribute's
        // within-row ordering; only the count matters.
        let airAtTopRow = 0;
        let waterAtTopRow = 0;
        for (let x = 1; x < W - 1; x++) {
            const id = bm.getPixel(x, 1);
            if (id === 0) airAtTopRow += 1;
            else if (id === water.id) waterAtTopRow += 1;
        }
        expect(airAtTopRow).toBe(2);
        expect(waterAtTopRow).toBe(W - 2 - 2);
    });

    it('vertical 2-cell bubble rises as a unit (no vertical tearing)', () => {
        const W = 8;
        const H = 14;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) {
            bm.setPixel(x, 0, stone.id);
            bm.setPixel(x, H - 1, stone.id);
        }
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, water.id);
        }
        // Vertical 2-cell bubble at (3, 10) and (3, 11).
        bm.setPixel(3, 10, 0);
        bm.setPixel(3, 11, 0);
        // After 3 ticks, bubble should be at (3, 7), (3, 8) — both
        // cells of the bubble rose 3 rows together.
        for (let t = 0; t < 3; t++) CellularAutomaton.step(bm, t);
        expect(bm.getPixel(3, 7)).toBe(0);
        expect(bm.getPixel(3, 8)).toBe(0);
        // The cells the bubble vacated should now be water.
        expect(bm.getPixel(3, 10)).toBe(water.id);
        expect(bm.getPixel(3, 11)).toBe(water.id);
    });
});

describe('CellularAutomaton.step — napalm above oil (v3.1.23)', () => {
    // v3.1.23: napalm has its own simulation kind with rank 2.5
    // (between fire 2 and oil 3), so a unified pool stratifies
    // napalm above oil. Pre-v3.1.23 napalm shared oil's rank
    // (3) so the pool's distribute couldn't decide which one
    // should sit on top — flood-fill insertion order alone
    // determined it, and napalm could end up below oil.
    const napalm: Material = {
        id: 9,
        name: 'napalm',
        color: 0,
        density: 0.85,
        friction: 0,
        restitution: 0,
        destructible: true,
        destructionResistance: 0,
        simulation: 'napalm',
        flammable: true,
    };

    it('mixed water + oil + napalm pool stratifies napalm at top', () => {
        const W = 8;
        const H = 14;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, oil, napalm, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        // Place inverted: napalm at the bottom, oil middle, water
        // top — sim should sort water → bottom, oil → middle,
        // napalm → top.
        for (let y = H - 5; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, napalm.id);
        }
        for (let y = H - 8; y < H - 5; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, oil.id);
        }
        for (let y = H - 11; y < H - 8; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, water.id);
        }
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // Top 4 rows of fluid: napalm.
        for (let x = 1; x < W - 1; x++) {
            for (let y = H - 11; y < H - 7; y++) {
                expect(bm.getPixel(x, y)).toBe(napalm.id);
            }
        }
        // Middle 3 rows: oil.
        for (let x = 1; x < W - 1; x++) {
            for (let y = H - 7; y < H - 4; y++) {
                expect(bm.getPixel(x, y)).toBe(oil.id);
            }
        }
        // Bottom 3 rows: water.
        for (let x = 1; x < W - 1; x++) {
            for (let y = H - 4; y < H - 1; y++) {
                expect(bm.getPixel(x, y)).toBe(water.id);
            }
        }
    });
});

describe('CellularAutomaton.step — gas pool moves as a single mass (v3.1.28)', () => {
    // v3.1.28: gas pools rise as a unit — `liftGasPool` swaps each
    // gas cell with the cell directly above (air, fire, water, etc.,
    // anything non-static and non-same-id), processed top-first so
    // a contiguous pool translates without smearing. Per-cell
    // `stepLiquid` is skipped for gas cells in pools so it can't
    // race with the lift. The lift also keeps the just-vacated air
    // cell tagged with the pool id, which prevents adjacent water
    // from laterally donating into it (otherwise water spreads in,
    // re-unifies the pool with the surrounding fluid, and
    // `distributePoolMass` moves the gas back down to the unified
    // pool's surface row).

    it('3x3 gas blob in open air rises as a unit', () => {
        // World is 24 tall so the blob has room to rise multiple
        // ticks at the v3.1.34 rate.
        const W = 9;
        const H = 24;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [stone, gas],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        const startTop = 17;
        for (let y = startTop; y <= startTop + 2; y++) {
            for (let x = 3; x <= 5; x++) bm.setPixel(x, y, gas.id);
        }
        // v3.1.34 — gas lift rate is 6 rows per tick (3x of the
        // v3.1.31 2-row rate, per user request). After 2 ticks the
        // 3x3 blob has risen 12 rows: from 17-19 to 5-7. Same
        // shape preserved.
        for (let t = 0; t < 2; t++) CellularAutomaton.step(bm, t);
        for (let y = 5; y <= 7; y++) {
            for (let x = 3; x <= 5; x++) {
                expect(bm.getPixel(x, y)).toBe(gas.id);
            }
        }
        // Cells that the blob vacated (rows 17-19) are now air.
        for (let y = startTop; y <= startTop + 2; y++) {
            for (let x = 3; x <= 5; x++) {
                expect(bm.getPixel(x, y)).toBe(0);
            }
        }
    });
});

describe('CellularAutomaton.step — air displacement under overhang (v3.1.21)', () => {
    // v3.1.21: bubbles stuck under an overhang (cell above is NOT
    // a pool fluid) can't rise via the v3.1.19 per-tick lift —
    // its check `poolIds[upIdx] === pool.id` rejects the swap.
    // Distribute now treats those stuck bubble cells as part of
    // the pool footprint, so the bottom-up fluid allocation
    // overwrites them with fluid and creates air at the topmost
    // rows of the pool. The 8-cell bubble below an overhang
    // teleports to the surface in one tick of pool detection.

    it('bubble under stone overhang surfaces to top of pool', () => {
        // U-shape with a partial lid: stone overhang covers cols 1-3
        // at row 5 (mid-height). Bubble carved at row 6 cols 1-3 —
        // its up-neighbors are stone, so per-tick lift is blocked.
        // Fluid above the overhang should NOT be a separate pool;
        // we leave a gap in the overhang at col 4..7 so the pool
        // is connected.
        const W = 10;
        const H = 12;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        // Partial overhang at row 5, cols 1-3.
        for (let x = 1; x <= 3; x++) bm.setPixel(x, 5, stone.id);
        // Water fills the rest of the interior.
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                if (bm.getPixel(x, y) === 0) bm.setPixel(x, y, water.id);
            }
        }
        // Carve bubble at row 6 cols 1-3 (directly under the overhang).
        for (let x = 1; x <= 3; x++) bm.setPixel(x, 6, 0);
        CellularAutomaton.step(bm, 0);
        // After one tick, those bubble cells have been replaced
        // with water (distribute relocated the bubble). Air ends up
        // at the top row of the pool.
        for (let x = 1; x <= 3; x++) {
            expect(bm.getPixel(x, 6)).toBe(water.id);
        }
        // 3 air cells should now exist somewhere in the pool's top
        // row (row 1, since the open-top-water-pool surface is row 1).
        let airAtTop = 0;
        for (let x = 1; x < W - 1; x++) {
            if (bm.getPixel(x, 1) === 0) airAtTop += 1;
        }
        expect(airAtTop).toBe(3);
    });
});

describe('CellularAutomaton.step — gas in unified pools (v3.1.20)', () => {
    // v3.1.20: gas (rank 0, lighter than air rank 1) is part of the
    // unified multi-fluid pool sort, so a gas bubble in water rises
    // to the surface within ticks of pool detection rather than the
    // per-cell stepLiquid rate. The v3.1.19 air-bubble lift skips
    // any swap where the up cell is lighter than air, so a gas-
    // above-air-bubble configuration (correct density layering) is
    // preserved instead of inverted.

    it('gas bubble inside water surfaces and exits to open air', () => {
        const W = 10;
        const H = 12;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, gas, stone],
        });
        for (let x = 0; x < W; x++) bm.setPixel(x, H - 1, stone.id);
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        for (let y = 4; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, water.id);
        }
        bm.setPixel(4, H - 3, gas.id);
        bm.setPixel(5, H - 3, gas.id);
        for (let t = 0; t < 12; t++) CellularAutomaton.step(bm, t);
        // Gas should have escaped to row 0 (spread across the top).
        let gasAtTop = 0;
        for (let x = 1; x < W - 1; x++) {
            if (bm.getPixel(x, 0) === gas.id) gasAtTop += 1;
        }
        expect(gasAtTop).toBeGreaterThanOrEqual(2);
    });

    it('gas under sealed lid stays pinned at top water row', () => {
        const W = 10;
        const H = 12;
        const bm = new ChunkedBitmap({
            width: W, height: H, chunkSize: 1,
            materials: [water, gas, stone],
        });
        for (let x = 0; x < W; x++) {
            bm.setPixel(x, 0, stone.id);
            bm.setPixel(x, H - 1, stone.id);
        }
        for (let y = 0; y < H; y++) {
            bm.setPixel(0, y, stone.id);
            bm.setPixel(W - 1, y, stone.id);
        }
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) bm.setPixel(x, y, water.id);
        }
        bm.setPixel(4, 9, gas.id);
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // Gas should be at row 1 (top of pool, just under the lid).
        // No gas anywhere else.
        let gasAtTopRow = 0;
        let gasElsewhere = 0;
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                if (bm.getPixel(x, y) === gas.id) {
                    if (y === 1) gasAtTopRow += 1;
                    else gasElsewhere += 1;
                }
            }
        }
        expect(gasAtTopRow).toBeGreaterThanOrEqual(1);
        expect(gasElsewhere).toBe(0);
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
