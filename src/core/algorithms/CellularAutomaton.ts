import type { ChunkedBitmap } from '../ChunkedBitmap.js';

/**
 * One-tick cellular-automaton step over the supplied bitmap.
 *
 * Each call processes every cell once in a bottom-up sweep so that a
 * grain of sand falls one row per tick (single-pass correctness — sand
 * already moved into row `y+1` blocks sand at row `y` from also
 * targeting that cell). Within each row the scan direction alternates
 * left-to-right vs right-to-left across calls, controlled by `tick`,
 * to kill the directional bias an always-same-direction sweep would
 * otherwise produce on diagonal slides.
 *
 * Currently implements one fluid kind: `'sand'`. Sand cells try to
 * move straight down; if blocked, they slide diagonally to either side
 * (the side preference flips with the tick parity). Sand can't tunnel
 * through walls — a diagonal slide requires the side cell at the same
 * height to also be air.
 *
 * Materials whose `simulation` is `'static'` (or unset / unknown for
 * backwards compatibility) never move. Air (`id === 0`) is the only
 * "passable" cell — sand will not displace water or other fluid
 * materials in v2.0.
 *
 * Cost: O(width × height) per tick. For a 1024×320 bitmap that's
 * ~327 K cells, each cheap byte-grid look-ups. Fine at 60 fps for
 * mid-size worlds; for very large worlds, gate the call behind a
 * "are there any fluid pixels currently?" flag or maintain a sparse
 * active-cell set.
 *
 * The bitmap is mutated in place. Affected chunks are dirtied via
 * the bitmap's regular `setPixel` path, so a subsequent
 * `TerrainRenderer.repaintDirty()` picks up the changes. Chunk-
 * collider rebuilds are NOT triggered for sand-only mutations because
 * the rebuild path filters to static materials only — see
 * `chunkToContours` / `componentToContours`.
 *
 * @param bitmap The bitmap to step.
 * @param tick   Optional tick counter that controls L/R alternation.
 *               Pass an incrementing integer (e.g. frame counter) so
 *               the sand bias flips each call. Default `0` — fine for
 *               one-shot tests but produces a slight bias if called
 *               repeatedly without changing.
 */
export function step(bitmap: ChunkedBitmap, tick = 0): void {
    const W = bitmap.width;
    const H = bitmap.height;
    const goRight = (tick & 1) === 0;

    // Bottom-up so a grain falling from row y can't be re-processed in
    // row y+1 within the same tick.
    for (let y = H - 1; y >= 0; y--) {
        const xStart = goRight ? 0 : W - 1;
        const xEnd = goRight ? W : -1;
        const dx = goRight ? 1 : -1;
        for (let x = xStart; x !== xEnd; x += dx) {
            const id = bitmap.getPixel(x, y);
            if (id === 0) continue;
            const material = bitmap.materials.get(id);
            if (material === undefined) continue;
            if (material.simulation !== 'sand') continue;

            // Try fall straight down.
            if (y + 1 < H && bitmap.getPixel(x, y + 1) === 0) {
                bitmap.setPixel(x, y + 1, id);
                bitmap.setPixel(x, y, 0);
                continue;
            }

            // Try diagonal slide. Per-tick side preference reduces
            // the "all sand piles to one side" bias.
            const sides = goRight ? [-1, 1] : [1, -1];
            for (const sx of sides) {
                const nx = x + sx;
                if (nx < 0 || nx >= W || y + 1 >= H) continue;
                if (
                    bitmap.getPixel(nx, y + 1) === 0 &&
                    bitmap.getPixel(nx, y) === 0
                ) {
                    bitmap.setPixel(nx, y + 1, id);
                    bitmap.setPixel(x, y, 0);
                    break;
                }
            }
        }
    }
}
