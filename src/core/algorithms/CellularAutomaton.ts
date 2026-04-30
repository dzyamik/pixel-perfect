import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { MaterialRegistry } from '../Materials.js';
import type { SimulationKind } from '../types.js';

/**
 * One-tick cellular-automaton step over the supplied bitmap.
 *
 * Each call processes every cell once in a bottom-up sweep so that a
 * grain of sand or a drop of water falls one row per tick (single-pass
 * correctness — material already moved into row `y+1` blocks the same
 * cell in row `y` from also targeting that destination). Within each
 * row the scan direction alternates left-to-right vs right-to-left
 * across calls, controlled by `tick`, to kill the directional bias an
 * always-same-direction sweep would otherwise produce on diagonal
 * slides and horizontal water spread.
 *
 * Implements two fluid kinds:
 *
 *  - **`'sand'`** — falls straight down when the cell below is air or
 *    water (sand sinks through water on the straight-down move; sand
 *    and water swap places). When blocked, slides diagonally into an
 *    air cell (no water displacement on diagonals — keeps the swap
 *    bookkeeping single-cell). Doesn't move horizontally.
 *  - **`'water'`** — falls straight down when air below; otherwise
 *    tries diagonal-down; otherwise spreads horizontally. All
 *    movements are into air only — water won't displace sand or
 *    other water.
 *
 * Materials whose `simulation` is `'static'` (or unset / unknown for
 * backwards compatibility) never move. The "passability" rules above
 * implement a simple density ordering: stone > sand > water > air.
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
 * collider rebuilds are NOT triggered for fluid-only mutations
 * because the rebuild path filters to static materials only — see
 * `chunkToContours` / `componentToContours`.
 *
 * @param bitmap The bitmap to step.
 * @param tick   Optional tick counter that controls L/R alternation.
 *               Pass an incrementing integer (e.g. frame counter) so
 *               the sand/water bias flips each call. Default `0` —
 *               fine for one-shot tests but produces a slight bias if
 *               called repeatedly without changing.
 */
export function step(bitmap: ChunkedBitmap, tick = 0): void {
    const W = bitmap.width;
    const H = bitmap.height;
    const goRight = (tick & 1) === 0;
    const materials = bitmap.materials;
    // Cells that received fluid via horizontal flow this tick. Used
    // by the outer loop to skip re-processing — a water cell that
    // just slid sideways shouldn't be picked up again as the loop
    // continues to that x. Sand never moves to the same row, so it
    // never enters this set; the cost is a no-op for sand-only worlds.
    const movedThisTick = new Set<number>();

    // Bottom-up so material falling from row y can't be re-processed
    // in row y+1 within the same tick.
    for (let y = H - 1; y >= 0; y--) {
        const xStart = goRight ? 0 : W - 1;
        const xEnd = goRight ? W : -1;
        const dx = goRight ? 1 : -1;
        for (let x = xStart; x !== xEnd; x += dx) {
            if (movedThisTick.has(y * W + x)) continue;

            const id = bitmap.getPixel(x, y);
            if (id === 0) continue;
            const material = materials.get(id);
            if (material === undefined) continue;
            const kind = material.simulation;
            if (kind === undefined || kind === 'static') continue;

            if (kind === 'sand') {
                stepSand(bitmap, materials, x, y, id, W, H, goRight);
            } else if (kind === 'water') {
                stepWater(bitmap, materials, x, y, id, W, H, goRight, movedThisTick);
            }
        }
    }
}

/**
 * Sand step: fall straight down (air or water — density swap), or
 * slide diagonally into pure air. Doesn't displace water on
 * diagonals (would require multi-cell swap; deferred).
 *
 * If the sand cell didn't move this tick AND the material has
 * `settlesTo` + `settleAfterTicks` configured, increments the
 * per-cell rest timer. Once the timer reaches the threshold the
 * cell is promoted in place to the `settlesTo` material — typically
 * a `'static'` variant that joins the static collider mesh, so the
 * pile starts supporting dynamic bodies.
 */
function stepSand(
    bitmap: ChunkedBitmap,
    materials: MaterialRegistry,
    x: number,
    y: number,
    id: number,
    W: number,
    H: number,
    goRight: boolean,
): void {
    if (y + 1 >= H) {
        // Bottom row, nowhere to go. Treat as "didn't move" — settle
        // path applies (sand on the world floor should still settle).
        maybeSettle(bitmap, materials, x, y, id);
        return;
    }

    // Fall straight down. Allow swap into water.
    const below = bitmap.getPixel(x, y + 1);
    if (canSandDisplace(below, materials)) {
        bitmap.setPixel(x, y + 1, id);
        bitmap.setPixel(x, y, below);
        return;
    }

    // Slide diagonally into air only (no mid-flight water swap).
    const sides = goRight ? [-1, 1] : [1, -1];
    for (const sx of sides) {
        const nx = x + sx;
        if (nx < 0 || nx >= W) continue;
        if (
            bitmap.getPixel(nx, y + 1) === 0 &&
            bitmap.getPixel(nx, y) === 0
        ) {
            bitmap.setPixel(nx, y + 1, id);
            bitmap.setPixel(x, y, 0);
            return;
        }
    }

    // Didn't move this tick — increment the rest timer; if at the
    // promotion threshold, settle.
    maybeSettle(bitmap, materials, x, y, id);
}

/**
 * Increments the at-rest timer for a non-moving sand cell and, if
 * the material's `settleAfterTicks` threshold is reached, promotes
 * it in place to `settlesTo`. No-op for materials that don't opt
 * into settling.
 */
function maybeSettle(
    bitmap: ChunkedBitmap,
    materials: MaterialRegistry,
    x: number,
    y: number,
    id: number,
): void {
    const material = materials.get(id);
    if (material === undefined) return;
    if (material.settlesTo === undefined || material.settleAfterTicks === undefined) {
        return;
    }
    const timers = bitmap.cellTimers;
    const idx = y * bitmap.width + x;
    const current = timers[idx]!;
    if (current + 1 >= material.settleAfterTicks) {
        // Promote — setPixel auto-resets the timer for the new
        // occupant, so we don't need to explicitly clear it.
        bitmap.setPixel(x, y, material.settlesTo);
        return;
    }
    // Saturate at 255 to avoid wraparound.
    timers[idx] = current === 255 ? 255 : current + 1;
}

/**
 * Water step: fall straight down → diagonal-down → horizontal spread.
 * All targets must be pure air (water doesn't displace sand or other
 * water).
 *
 * Side preference is **per-cell** rather than per-tick. A cell at
 * column `x` prefers right when `goRight === (x is even)`, otherwise
 * left — which means adjacent cells in the same row try opposite
 * directions in a single tick. Without this asymmetry, a contiguous
 * block of water under uniform per-tick preference shifts en masse
 * instead of spreading, and the visual is "water piles like sand
 * even though it should level off." Pools level after enough ticks.
 *
 * Horizontal moves register the destination in `movedThisTick` so
 * the outer scan doesn't re-process the just-placed cell as the
 * loop continues. Without this guard, a right-preferring scan that
 * encounters water at x=2 and moves it to x=3 would then process
 * x=3 (now water) and move it to x=4 — water "tunnels" along the
 * scan direction in a single tick instead of spreading by 1.
 */
function stepWater(
    bitmap: ChunkedBitmap,
    _materials: MaterialRegistry,
    x: number,
    y: number,
    id: number,
    W: number,
    H: number,
    goRight: boolean,
    movedThisTick: Set<number>,
): void {
    // Fall straight down.
    if (y + 1 < H && bitmap.getPixel(x, y + 1) === 0) {
        bitmap.setPixel(x, y + 1, id);
        bitmap.setPixel(x, y, 0);
        return;
    }

    // Per-cell L/R preference: combine scan-tick parity with x-cell
    // parity so adjacent cells in a row try opposite sides each tick.
    const xEven = (x & 1) === 0;
    const preferRight = goRight === xEven;
    const sides = preferRight ? [1, -1] : [-1, 1];

    // Diagonal-down. Targets in row y+1 (already-processed) so no
    // moved-set tracking needed.
    if (y + 1 < H) {
        for (const sx of sides) {
            const nx = x + sx;
            if (nx < 0 || nx >= W) continue;
            if (
                bitmap.getPixel(nx, y + 1) === 0 &&
                bitmap.getPixel(nx, y) === 0
            ) {
                bitmap.setPixel(nx, y + 1, id);
                bitmap.setPixel(x, y, 0);
                return;
            }
        }
    }

    // Horizontal spread — gives water its level-finding behavior.
    for (const sx of sides) {
        const nx = x + sx;
        if (nx < 0 || nx >= W) continue;
        if (bitmap.getPixel(nx, y) === 0) {
            bitmap.setPixel(nx, y, id);
            bitmap.setPixel(x, y, 0);
            // Same row — guard against re-processing as the outer
            // loop reaches the destination column.
            movedThisTick.add(y * W + nx);
            return;
        }
    }
}

/**
 * Returns `true` if a sand cell can move into a cell currently holding
 * `targetId`. Sand displaces air and water (density: sand > water);
 * everything else blocks.
 */
function canSandDisplace(targetId: number, materials: MaterialRegistry): boolean {
    if (targetId === 0) return true;
    const m = materials.get(targetId);
    if (m === undefined) return false;
    const kind: SimulationKind | undefined = m.simulation;
    return kind === 'water';
}
