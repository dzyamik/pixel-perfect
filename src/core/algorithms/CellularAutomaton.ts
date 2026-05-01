import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { MaterialRegistry } from '../Materials.js';
import type { Material } from '../types.js';

/**
 * One-tick cellular-automaton step over the supplied bitmap.
 *
 * Iterates the bitmap's sparse {@link ChunkedBitmap.activeCells} set
 * — only cells that might have changed (or are known to have
 * ongoing state like a fire timer or sand rest counter) are
 * processed. The set is maintained automatically: every
 * {@link ChunkedBitmap.setPixel} call adds the changed cell and its
 * 8 neighbors so external carve / deposit / paint ops AND the sim's
 * own swap-mutations keep activation propagating organically.
 * Cells that didn't move and have no ongoing state drop out of the
 * set and don't return until a neighbor's mutation re-activates
 * them — once a world reaches steady state, `step` becomes a no-op.
 *
 * On the very first call the bitmap is scanned once
 * ({@link ChunkedBitmap.enableActiveCellTracking}) to seed the set
 * with cells placed before tracking was enabled.
 *
 * Within each tick the snapshot is processed bottom-up
 * (`y = H-1 → 0`) so material falling from row `y` can't be
 * re-processed in row `y+1`. Side preference is per-cell
 * (`goRight === (x is even)`), so contiguous fluid blocks spread
 * symmetrically instead of shifting en masse. The `tick` parameter
 * flips a global L/R bias each call so a body of fluid alternates
 * its preferred side, killing residual asymmetries.
 *
 * Five mobile fluid kinds are implemented; their behavior is
 * parameterised over a single generic `stepFluid` helper.
 *
 *  - **`'sand'`** — falls straight down (density swap with any
 *    lower-rank fluid below), slides diagonally into pure air.
 *    No horizontal flow. Optionally `settlesTo` a static variant
 *    after `settleAfterTicks` stationary ticks (v2.2 bridge).
 *  - **`'water'`** — falls straight down (density swap), diagonal
 *    into air, multi-cell horizontal flow into air (`FLUID_FLOW_DIST`
 *    cells per tick — see the module-private constant). Pools
 *    level off over ~`width / FLUID_FLOW_DIST` ticks instead of
 *    one-cell-per-tick.
 *  - **`'oil'`** — like water but rank 3 (< water rank 4): can't
 *    displace water on a fall, so oil floats on water.
 *  - **`'gas'`** — rises straight up (density swap), diagonal-up
 *    into air, horizontal spread into air. Bubbles up through
 *    liquids since gas rank 0 < liquid ranks.
 *  - **`'fire'`** — stationary. Each tick: ignites the first
 *    adjacent `flammable` neighbor it finds (top, sides, bottom);
 *    the new fire cell starts at timer 0. Increments its own timer
 *    and dies (→ air) at the `burnDuration` threshold. Stays in
 *    the active set until it dies regardless of whether anything
 *    flammable is nearby.
 *
 * Density ranks for vertical swaps:
 *
 *     gas (0) < air (1) < fire (2) < oil (3) < water (4) < sand (5)
 *
 * Static materials never swap (regardless of rank). Vertical swaps
 * only happen between *different* ranks, with the heavier ending up
 * deeper — for downward motion that's `srcRank > targetRank`, for
 * upward motion `srcRank < targetRank`. Diagonal slides and
 * horizontal flow are air-only — the swap bookkeeping stays
 * single-cell (no mid-flight three-cell shuffle).
 *
 * Cost: O(N log N) per tick where N is the number of currently-
 * active cells (the log factor is the snapshot sort that orders
 * rows bottom-up). For a mostly-settled world the active set drops
 * to zero and `step` returns immediately. For a continuous pour it
 * scales with the moving cells, not the world dimensions.
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
 *               the bias flips each call. Default `0` — fine for
 *               one-shot tests but produces a slight bias if called
 *               repeatedly without changing.
 */
export function step(bitmap: ChunkedBitmap, tick = 0): void {
    bitmap.enableActiveCellTracking();
    const active = bitmap.activeCells;
    if (active.size === 0) return;

    const W = bitmap.width;
    const H = bitmap.height;
    const goRight = (tick & 1) === 0;
    const materials = bitmap.materials;

    // Snapshot to a sortable array, then clear the live set so the
    // setPixel-driven activation calls during this tick populate the
    // *next* tick's set without disturbing this iteration.
    //
    // The encoded form `idx = y*W + x` sorts descending into bottom-
    // up row order naturally — within each row x descends, but per-
    // cell side preference handles directional symmetry independently
    // of x-iteration order.
    const cells = [...active];
    cells.sort((a, b) => b - a);
    active.clear();

    // Cells that received fluid via in-row movement this tick. The
    // outer loop skips them — a water cell that just slid sideways
    // shouldn't be picked up again as the loop continues. Also used
    // by upward-moving fluids (gas) so the not-yet-visited row they
    // just rose into doesn't re-process them, and by fire so a
    // freshly-ignited neighbor doesn't spread further this tick.
    const movedThisTick = new Set<number>();

    for (const idx of cells) {
        if (movedThisTick.has(idx)) continue;
        const y = (idx / W) | 0;
        const x = idx - y * W;

        const id = bitmap.getPixel(x, y);
        if (id === 0) continue;
        const material = materials.get(id);
        if (material === undefined) continue;
        const kind = material.simulation;
        if (kind === undefined || kind === 'static') continue;

        if (kind === 'sand') {
            stepSand(bitmap, materials, x, y, id, W, H, goRight, movedThisTick);
        } else if (kind === 'water') {
            stepFluid(
                bitmap, materials, x, y, id, W, H, goRight, movedThisTick,
                +1, RANK_WATER, FLUID_FLOW_DIST,
            );
        } else if (kind === 'oil') {
            stepFluid(
                bitmap, materials, x, y, id, W, H, goRight, movedThisTick,
                +1, RANK_OIL, FLUID_FLOW_DIST,
            );
        } else if (kind === 'gas') {
            stepFluid(
                bitmap, materials, x, y, id, W, H, goRight, movedThisTick,
                -1, RANK_GAS, FLUID_FLOW_DIST,
            );
        } else if (kind === 'fire') {
            stepFire(bitmap, materials, x, y, id, material, W, H, movedThisTick);
        }
    }
}

// Density ranks. Higher = heavier. Air is implicit at rank 1.
const RANK_AIR = 1;
const RANK_GAS = 0;
const RANK_FIRE = 2;
const RANK_OIL = 3;
const RANK_WATER = 4;
const RANK_SAND = 5;

/**
 * Multi-cell horizontal flow distance for liquids (water, oil) and
 * gas. A liquid cell that's blocked vertically can move up to this
 * many empty (air) cells sideways in a single tick — without it,
 * a wide pool would take O(width) ticks to level visibly because
 * each cell only spreads by 1 column per tick. Higher = more
 * "responsive" liquids; lower = more granular look. 4 is a balance.
 */
const FLUID_FLOW_DIST = 4;

/**
 * Returns the density rank for a cell's contents.
 *
 * Air (id `0`) is implicit at rank 1. Static and unknown cells
 * return `Infinity` so density comparisons reject them; callers
 * additionally short-circuit on static via {@link isStaticTarget}
 * to keep the rule "never swap with static" explicit even though
 * the rank value alone would also block the swap. Fluids return
 * their dedicated rank constant.
 */
function densityRank(id: number, materials: MaterialRegistry): number {
    if (id === 0) return RANK_AIR;
    const m = materials.get(id);
    if (m === undefined) return Infinity;
    const kind = m.simulation;
    if (kind === undefined || kind === 'static') return Infinity;
    switch (kind) {
        case 'gas': return RANK_GAS;
        case 'fire': return RANK_FIRE;
        case 'oil': return RANK_OIL;
        case 'water': return RANK_WATER;
        case 'sand': return RANK_SAND;
    }
    return Infinity;
}

/**
 * `true` if the target cell holds a static material. Static cells
 * never swap with anything (regardless of density rank — a feather
 * doesn't displace bedrock just because it's lighter).
 */
function isStaticTarget(id: number, materials: MaterialRegistry): boolean {
    if (id === 0) return false;
    const m = materials.get(id);
    if (m === undefined) return true; // unknown = treat as immovable
    const kind = m.simulation;
    return kind === undefined || kind === 'static';
}

/**
 * Returns `true` if a fluid cell of `srcRank` should swap places
 * with the cell at `(tx, ty)` for vertical motion in `yDir`.
 *
 * Down (yDir > 0): src wants to sink → swap when src is heavier.
 * Up (yDir < 0):   src wants to rise → swap when src is lighter.
 *
 * Static targets always reject. Same-rank cells never swap (sand
 * doesn't slip past sand on density alone).
 */
function canVerticalSwap(
    srcRank: number,
    targetId: number,
    materials: MaterialRegistry,
    yDir: number,
): boolean {
    if (isStaticTarget(targetId, materials)) return false;
    const targetRank = densityRank(targetId, materials);
    if (yDir > 0) return srcRank > targetRank;
    return srcRank < targetRank;
}

/**
 * Generic fluid step: try fall/rise (density swap) → diagonal in
 * `yDir` (air only) → horizontal multi-cell flow (air only).
 *
 * Side preference is **per-cell** (`goRight === (x is even)`)
 * rather than per-tick. Without that asymmetry, a contiguous block
 * of fluid under uniform per-tick preference shifts en masse
 * instead of spreading, and the visual is "fluid piles like sand
 * even though it should level off."
 *
 * Horizontal moves register the destination in `movedThisTick` so
 * the outer scan doesn't re-process the just-placed cell as the
 * loop continues. Without this guard, a right-preferring scan that
 * encounters fluid at x=2 and moves it to x=3 would then process
 * x=3 (now fluid) and move it to x=4 — fluid "tunnels" along the
 * scan direction in a single tick instead of spreading by 1.
 *
 * @param yDir       `+1` for sinking fluids (water, oil); `-1` for
 *                   rising fluids (gas).
 * @param srcRank    Density rank of the moving cell (see module-
 *                   private `RANK_*` constants).
 * @param flowDist   Maximum horizontal cells the fluid can flow per
 *                   tick into contiguous air. `0` disables horizontal
 *                   flow (used by sand). The flow stops at any non-
 *                   air cell, so the moving cell never tunnels past
 *                   another fluid — it lands at the last air cell
 *                   reached, up to `flowDist` away.
 */
function stepFluid(
    bitmap: ChunkedBitmap,
    materials: MaterialRegistry,
    x: number,
    y: number,
    id: number,
    W: number,
    H: number,
    goRight: boolean,
    movedThisTick: Set<number>,
    yDir: number,
    srcRank: number,
    flowDist: number,
): boolean {
    // Vertical move (in yDir) with density swap.
    //
    // Bottom-up scan + downward motion: target row y+1 was already
    // processed in this tick, so the moved cell isn't re-visited
    // (no `movedThisTick` entry needed for sinking).
    //
    // Bottom-up scan + upward motion: target row y-1 will be
    // processed LATER in this tick. Without recording the target
    // in `movedThisTick`, gas rising from y → y-1 would be re-
    // processed when the loop reached y-1 and would rise again,
    // tunneling all the way to the top in a single tick.
    const ny = y + yDir;
    if (ny >= 0 && ny < H) {
        const targetId = bitmap.getPixel(x, ny);
        if (canVerticalSwap(srcRank, targetId, materials, yDir)) {
            bitmap.setPixel(x, ny, id);
            bitmap.setPixel(x, y, targetId);
            if (yDir < 0) movedThisTick.add(ny * W + x);
            return true;
        }
    }

    // Per-cell L/R preference: combine scan-tick parity with x-cell
    // parity so adjacent cells in a row try opposite sides each tick.
    const xEven = (x & 1) === 0;
    const preferRight = goRight === xEven;
    const sides = preferRight ? [1, -1] : [-1, 1];

    // Diagonal in yDir — into pure air only (keeps swap single-cell;
    // a "diagonal density swap" would need three-cell bookkeeping).
    // Diagonal-up is also subject to the rising-tunnel guard; we
    // record the target so the not-yet-visited row doesn't re-run
    // the same cell.
    if (ny >= 0 && ny < H) {
        for (const sx of sides) {
            const nx = x + sx;
            if (nx < 0 || nx >= W) continue;
            if (bitmap.getPixel(nx, y) === 0 && bitmap.getPixel(nx, ny) === 0) {
                bitmap.setPixel(nx, ny, id);
                bitmap.setPixel(x, y, 0);
                if (yDir < 0) movedThisTick.add(ny * W + nx);
                return true;
            }
        }
    }

    // Horizontal multi-cell flow — air only. The fluid travels up
    // to `flowDist` cells in the preferred-then-other direction,
    // landing at the farthest reachable air cell. Flow halts at the
    // first non-air cell so it never tunnels through other fluids.
    if (flowDist > 0) {
        for (const sx of sides) {
            let target = -1;
            for (let d = 1; d <= flowDist; d++) {
                const nx = x + sx * d;
                if (nx < 0 || nx >= W) break;
                if (bitmap.getPixel(nx, y) !== 0) break;
                target = nx;
            }
            if (target !== -1) {
                bitmap.setPixel(target, y, id);
                bitmap.setPixel(x, y, 0);
                movedThisTick.add(y * W + target);
                return true;
            }
        }
    }

    return false;
}

/**
 * Sand step: density-aware fall + air-only diagonal slide. Wraps
 * {@link stepFluid} (with `yDir=+1`, `flowDist=0`, sand rank), then
 * runs settling logic if the cell didn't move.
 *
 * Active-set bookkeeping: `setPixel` auto-marks moved cells, so the
 * fall path needs no explicit re-add. A non-moving cell drops out
 * of the active set unless this material has settling configured,
 * in which case the rest-timer needs to keep ticking — we mark
 * the cell active explicitly until either it moves (because a
 * neighbor opened up) or it promotes (`setPixel` fires when
 * settling and the new id's auto-mark covers re-activation).
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
    movedThisTick: Set<number>,
): void {
    const moved = stepFluid(
        bitmap, materials, x, y, id, W, H, goRight, movedThisTick,
        +1, RANK_SAND, 0,
    );
    if (moved) return;

    // Didn't move this tick — increment the rest timer; if at the
    // promotion threshold, settle in place to a static variant.
    maybeSettle(bitmap, materials, x, y, id);

    // If the cell is still our sand (i.e. didn't promote) and the
    // material has a settling config, keep it active so the timer
    // ticks again next call. Plain non-settling sand drops from
    // the active set; a neighbor's mutation will re-add it via
    // setPixel auto-mark when conditions change.
    if (bitmap.getPixel(x, y) !== id) return;
    const material = materials.get(id);
    if (material === undefined) return;
    if (material.settlesTo === undefined || material.settleAfterTicks === undefined) return;
    bitmap.markActive(x, y);
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
 * Fire step: ignite one flammable neighbor (up, left, right, down),
 * then increment the cell's own burn timer; once the timer reaches
 * `burnDuration`, the cell turns to air.
 *
 * The new fire cell's timer is auto-reset by `setPixel`, so each
 * fresh ignition starts from 0 and burns for the full duration.
 * Fire that finds no flammable neighbor still ages and dies — a
 * lone flame in midair burns out without spreading.
 *
 * Ignition stops at the first flammable neighbor found per tick;
 * spreading rate is therefore "one new cell per tick per existing
 * fire cell." For visibly-fast spread, set `burnDuration` to a
 * value greater than the chain's hop count so cells don't burn
 * out before passing the flame on.
 */
function stepFire(
    bitmap: ChunkedBitmap,
    materials: MaterialRegistry,
    x: number,
    y: number,
    id: number,
    material: Material,
    W: number,
    H: number,
    movedThisTick: Set<number>,
): void {
    const burnDuration = material.burnDuration ?? 60;
    const timers = bitmap.cellTimers;
    const idx = y * W + x;
    const current = timers[idx]!;

    // Try to ignite a flammable neighbor (up / left / right / down).
    // Order is fixed (no L/R alternation): fire spread is slow
    // enough already that L/R bias isn't visible.
    const dirs: readonly (readonly [number, number])[] = [
        [0, -1], [-1, 0], [1, 0], [0, 1],
    ];
    for (const dir of dirs) {
        const nx = x + dir[0]!;
        const ny = y + dir[1]!;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const neighborId = bitmap.getPixel(nx, ny);
        if (neighborId === 0 || neighborId === id) continue;
        const neighborMat = materials.get(neighborId);
        if (neighborMat === undefined) continue;
        if (!neighborMat.flammable) continue;
        // Ignite — setPixel auto-resets the neighbor cell's timer
        // so the new fire burns its full lifetime. Add it to
        // `movedThisTick` so the outer scan doesn't process the
        // freshly-lit cell again *this* tick — without that guard
        // fire would cascade across an entire flammable line in
        // one step instead of one cell per step.
        bitmap.setPixel(nx, ny, id);
        movedThisTick.add(ny * W + nx);
        break;
    }

    // Age this fire cell. When it reaches the burn duration, die.
    if (current + 1 >= burnDuration) {
        bitmap.setPixel(x, y, 0);  // setPixel auto-marks neighbors
        return;
    }
    timers[idx] = current === 255 ? 255 : current + 1;
    // Still alive — keep this cell in the active set so its timer
    // ticks again next call, regardless of whether anything
    // flammable was found this tick. A lone flame in midair must
    // still age and die.
    bitmap.markActive(x, y);
}
