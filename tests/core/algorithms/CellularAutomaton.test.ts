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
        const bm = gridBitmap([
            '..w..',
            '..w..',
            '..w..',
            '#####',
        ]);
        // Run enough ticks that the column has fully flattened. The
        // alternation kicks in every tick, so the spread is symmetric
        // over even-tick counts.
        for (let t = 0; t < 16; t++) CellularAutomaton.step(bm, t);
        // Three water cells should now be sitting on the floor (row 2)
        // and any leftover columns above are air. Total water count
        // preserved.
        let waterCount = 0;
        for (let y = 0; y < bm.height; y++) {
            for (let x = 0; x < bm.width; x++) {
                if (bm.getPixel(x, y) === water.id) waterCount++;
            }
        }
        expect(waterCount).toBe(3);
        // No water in row 0 (top — column should have drained).
        for (let x = 0; x < bm.width; x++) {
            expect(bm.getPixel(x, 0)).toBe(0);
        }
    });

    it('water fills a U-shaped container from the bottom up', () => {
        const bm = gridBitmap([
            'w....',
            '#...#',
            '#...#',
            '#####',
        ]);
        for (let t = 0; t < 30; t++) CellularAutomaton.step(bm, t);
        // The single water cell should have settled somewhere in the
        // bottom row of the cup (row 2). The first row is the lid we
        // dropped through; the last row is the floor.
        let waterCount = 0;
        let bottomCount = 0;
        for (let y = 0; y < bm.height; y++) {
            for (let x = 0; x < bm.width; x++) {
                if (bm.getPixel(x, y) === water.id) {
                    waterCount++;
                    if (y === 2) bottomCount++;
                }
            }
        }
        expect(waterCount).toBe(1);
        expect(bottomCount).toBe(1);
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
