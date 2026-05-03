import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { MaterialRegistry } from '../Materials.js';
import type { Material } from '../types.js';
import {
    detectPools,
    distributePoolMass,
    isPoolInterior,
    liftAirBubblesAll,
    NO_POOL,
} from './FluidPools.js';

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
 *    into air, multi-cell horizontal flow into air. Spread per
 *    tick is `Material.flowDistance` (default `4`); pools level
 *    off over ~`width / flowDistance` ticks.
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
    // v3.1.15: ping-pong the lateral scan direction every tick to
    // remove the L→R / R→L bias from the fixed scan order. With
    // `sxFlip = 0` the scan tries left-then-right (s=0 → -1, s=1
    // → +1); with `sxFlip = 1` it tries right-then-left. Standard
    // symmetry-fix from the falling-sand engine literature.
    const sxFlip = tick & 1;
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
    // v3.1.16: alternate within-row x-order per tick (in addition
    // to the v3.1.15 lateral-scan ping-pong). Without this, a pool
    // draining off a RIGHT cliff has its drainage source processed
    // FIRST in its row (highest x) and then the rest of the row
    // back-fills it within the same tick via lateral cascades; a
    // pool draining off a LEFT cliff has its drainage source
    // processed LAST (lowest x) and gets no within-tick back-fill.
    // The resulting end-of-tick mass distribution differs between
    // left and right scenarios. Alternating x-order each tick
    // averages out the asymmetry.
    if ((tick & 1) === 0) {
        cells.sort((a, b) => b - a);
    } else {
        cells.sort((a, b) => {
            const ya = (a / W) | 0;
            const yb = (b / W) | 0;
            if (ya !== yb) return yb - ya;
            return a - b;
        });
    }
    active.clear();

    // Cells that received fluid via in-row movement this tick. The
    // outer loop skips them — a water cell that just slid sideways
    // shouldn't be picked up again as the loop continues. Also used
    // by upward-moving fluids (gas) so the not-yet-visited row they
    // just rose into doesn't re-process them, and by fire so a
    // freshly-ignited neighbor doesn't spread further this tick.
    const movedThisTick = new Set<number>();

    // Adaptive lateral reach (v3.0.4, retuned v3.1.1). At low active
    // counts use the full `LATERAL_REACH_MAX` for fast surface
    // flattening (~25× gravity rate). Past `LATERAL_REACH_HIGH_LOAD`
    // cells in the active set, drop to `LATERAL_REACH_HIGH_LOAD_VAL`
    // so heavy pours don't blow the frame budget. Cost scales
    // linearly with reach.
    const lateralReach = cells.length > LATERAL_REACH_HIGH_LOAD
        ? LATERAL_REACH_HIGH_LOAD_VAL
        : LATERAL_REACH_MAX;

    // v3.1 pool-based optimization: when the active set is large
    // enough to make connected-component detection worthwhile, run
    // flood fill, redistribute mass uniformly within each pool,
    // and skip per-cell `stepLiquid` for cells deep INSIDE a pool
    // (where every 4-neighbor is in the same pool). Perimeter cells
    // still go through `stepLiquid` so spreading into adjacent air
    // and cross-material density swaps still work. Cells outside
    // pools (singletons, falling drops) also use `stepLiquid`.
    //
    // For settled bodies of water this collapses ~all of the
    // per-cell cost into one O(N) flood fill + one O(N) pass over
    // the pool's cells.
    let poolIds: Uint16Array | null = null;
    if (cells.length > POOL_DETECTION_MIN) {
        const pools = detectPools(bitmap, materials);
        for (const pool of pools.values()) {
            if (pool.cells.size >= POOL_MIN_SIZE) {
                distributePoolMass(bitmap, pool, materials);
            }
        }
        // v3.1.19: enclosed air bubbles rise one row per tick. Runs
        // after distribute so the swapped-down fluid cell carries
        // its post-distribute mass; updates poolIds in place so the
        // per-cell loop below sees a consistent sidecar.
        liftAirBubblesAll(bitmap, pools, materials);
        poolIds = bitmap._getPoolIdsUnchecked();
    }

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

        // v3.1: skip cells deep in a pool. Their mass is already
        // set by `distributePoolMass`; per-cell flow has nothing
        // to add (every 4-neighbor is the same material with the
        // same equilibrium mass).
        if (poolIds !== null) {
            const pid = poolIds[idx]!;
            if (pid !== NO_POOL && isPoolInterior(poolIds, x, y, W, H, pid)) {
                continue;
            }
        }

        if (kind === 'sand') {
            stepSand(bitmap, materials, x, y, id, W, H, goRight, movedThisTick);
        } else if (kind === 'water') {
            stepLiquid(bitmap, materials, x, y, id, W, H, +1, RANK_WATER, lateralReach, sxFlip, poolIds);
        } else if (kind === 'oil') {
            stepLiquid(bitmap, materials, x, y, id, W, H, +1, RANK_OIL, lateralReach, sxFlip, poolIds);
        } else if (kind === 'gas') {
            stepLiquid(bitmap, materials, x, y, id, W, H, -1, RANK_GAS, lateralReach, sxFlip, poolIds);
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

// Note: the v2.x `DEFAULT_FLUID_FLOW_DIST = 4` constant was removed
// at v3.0. Water / oil / gas now use mass transfer via
// {@link stepLiquid}; horizontal flow distance is no longer a
// per-tick cell count. Sand still calls `stepFluid` with `flowDist=0`
// (no horizontal flow); sand's pressure-mode flow is hard-coded to
// 1 in {@link stepSand}.

// ──────────────────────────────────────────────────────────────────
// v3 mass-based liquid simulation
// ──────────────────────────────────────────────────────────────────

/** Standard cell capacity. A "full" cell holds exactly this much. */
const MAX_MASS = 1.0;
/**
 * Extra mass a bottom-of-stack cell can hold before overflowing
 * upward. W-Shadow's default; tunable.
 *
 * History:
 * - v3.1.4 bumped to `0.5` to speed cascade through saturated
 *   streams (cascade rate ≈ `MAX_COMPRESS / 2` per stage / tick).
 * - v3.1.5 reverted to `0.02`: the speed-up didn't address the
 *   user-reported "pile at landing" symptom because cascade rate
 *   AND per-cell holding capacity scale together, so the
 *   over-mass-per-tick remainder (which is what triggers
 *   compression overflow up — the visible pile) is roughly
 *   invariant in `MAX_COMPRESS`.
 */
const MAX_COMPRESS = 0.02;
/** Below this mass a cell is considered empty and reverts to air. */
const MIN_MASS = 0.0001;
/**
 * Below this transfer amount the move is suppressed (numerical
 * noise filter). Set equal to `MIN_MASS` (v3.0.1, was `0.005`):
 * a higher threshold leaves "orphan" cells with mass between
 * MIN_MASS and MIN_FLOW unable to drain, AND freezes adjacent-
 * cell mass differences at `4 × MIN_FLOW`, producing a visible
 * bell shape on water surfaces instead of flatness. With
 * MIN_FLOW = MIN_MASS, any cell that the simulation considers
 * "wet" is also able to transfer.
 */
const MIN_FLOW = 0.0001;
/** Maximum mass that can transfer between two cells in a single tick. */
const MAX_FLOW = 1.0;
/**
 * Lateral equalization fraction — fraction of the mass difference
 * between two same-rank neighbors that flows from heavier to
 * lighter per tick. `0.5` fully equalizes a pair of adjacent
 * cells in a single tick; lower values produce gentler spread.
 * v3.0.2: bumped from `0.25` to `0.5` to keep up with multi-cell
 * lateral reach (see {@link LATERAL_REACH}).
 */
const LATERAL_EQUALIZE = 0.5;
/**
 * Maximum number of cells on each side that a fluid cell tries
 * to equalize with per tick when the simulation is "lightly
 * loaded" (small active set). Surface flattening propagates
 * ~`LATERAL_REACH_MAX` cells per tick — `25` is roughly 25× the
 * single-cell-per-tick gravity rate (v3.1.1, was `5` at v3.0.4).
 * The pool-based fast path (v3.1) keeps the cost of this larger
 * reach manageable: cells deep inside a settled pool skip
 * `stepLiquid` entirely, so only perimeter cells pay the per-cell
 * O(reach) scan.
 */
const LATERAL_REACH_MAX = 25;
/**
 * Threshold (in active-set size) above which the cellular
 * automaton drops to {@link LATERAL_REACH_HIGH_LOAD_VAL} for
 * the tick. The scan cost in `stepLiquid` is linear in reach,
 * so a smaller value cuts per-cell sim cost — useful when a
 * sustained pour blows the frame budget before the pool fast
 * path kicks in. The trade-off is slower spread, but at high
 * load the user is filling cells faster than the sim can settle
 * anyway.
 */
const LATERAL_REACH_HIGH_LOAD = 8000;
const LATERAL_REACH_HIGH_LOAD_VAL = 5;

/**
 * Minimum active-set size that triggers v3.1 pool detection.
 *
 * v3.1.8 dropped from `10000` to `0`: pool flood-fill now runs every
 * tick whenever there are active fluid cells. This is the canonical
 * "instant pool flattening" fix in the W-Shadow / jgallant / Noita
 * CA-fluid lineage — `distributePoolMass` averages mass uniformly
 * across each connected component, so a brush burst that lands on
 * top of an existing pool merges and equalizes within one tick
 * instead of cascading through reach-25 lateral over many ticks.
 *
 * The cost is bounded: `detectPools` is O(W × H) per tick (~32 K
 * reads on a 256×128 bitmap, ~0.3 ms). For a settled world the
 * outer step short-circuits before pool detection runs, so the
 * cost is paid only when the active set is non-empty.
 */
const POOL_DETECTION_MIN = 0;
/**
 * Minimum pool size that gets the equilibrium mass distribution
 * pass.
 *
 * v3.1.15 lowered from `8` to `2`: even small pools (a couple of
 * cells) need hydrostatic flattening or they read like sand-piles
 * (per-cell stepLiquid produces uneven surfaces because the
 * lateral scan can't fully equilibrate within a single tick of
 * just-merged cells). The distribution pass is cheap: a Map +
 * sort over a couple of cells is sub-microsecond.
 *
 * Singletons (size 1) skip distribution since there's nothing to
 * equilibrate.
 */
const POOL_MIN_SIZE = 2;

/**
 * Given two stacked cells with combined mass `total`, returns
 * how much the BOTTOM cell should hold at equilibrium. The rest
 * goes into the upper cell. Implements W-Shadow's pseudo-
 * compressible split:
 *
 *  - `total ≤ MAX_MASS`: all mass sits at the bottom.
 *  - `total < 2·MAX_MASS + MAX_COMPRESS`: a smooth ramp where
 *    the bottom is over-full and the top is partial.
 *  - Larger totals: bottom holds half plus the compression bonus.
 */
function stableSplit(total: number): number {
    if (total <= MAX_MASS) return total;
    if (total < 2 * MAX_MASS + MAX_COMPRESS) {
        return (MAX_MASS * MAX_MASS + total * MAX_COMPRESS) / (MAX_MASS + MAX_COMPRESS);
    }
    return (total + MAX_COMPRESS) / 2;
}

/**
 * Mass-based liquid step (v3).
 *
 * Replaces {@link stepFluid} for `'water'`, `'oil'`, and `'gas'`
 * materials. Each cell runs four sequential transfers:
 *
 *  1. Vertical (sinking direction): cross-material density swap
 *     OR same-material/air mass transfer toward the stable split.
 *  2. Lateral left: quarter-equalize toward the left neighbor.
 *  3. Lateral right: quarter-equalize toward the right neighbor.
 *  4. Vertical up (compression overflow): only fires when source
 *     mass exceeds `MAX_MASS`.
 *
 * For sinking fluids (`yDir = +1`) the natural-deep direction is
 * down; for rising gas (`yDir = -1`) the directions invert (mass
 * transfers UP, compression overflows DOWN). Cross-material
 * density swaps still operate on whole cells (atomic
 * `setPixel` swap with mass preserved).
 *
 * The transfer logic is in-place: each cell modifies its own
 * mass and its target's mass directly. This is order-dependent
 * (per W-Shadow's published algorithm), but the bottom-up scan
 * order from the outer loop and the small per-tick flow caps
 * keep the visible result stable.
 */
function stepLiquid(
    bitmap: ChunkedBitmap,
    materials: MaterialRegistry,
    x: number,
    y: number,
    id: number,
    W: number,
    H: number,
    yDir: number,
    srcRank: number,
    lateralReach: number,
    sxFlip: number,
    poolIds: Uint16Array | null,
): void {
    // v3.1.19: when `poolIds` is non-null, an air target with
    // `poolIds[idx] !== NO_POOL` is an enclosed-bubble cell. Per-cell
    // donations (lateral or vertical) into bubble cells are blocked
    // so the bubble persists until `liftAirBubblesAll` raises it.
    // Without this, surface-row water cells (whose stone lid forces
    // them to be perimeter) donate water into a bubble at the top
    // of the pool within one tick.
    const isBubbleAt = (cellIdx: number): boolean =>
        poolIds !== null && poolIds[cellIdx] !== NO_POOL;
    // v3.0.3 perf: cache the mass array reference and use direct
    // index access. setMass(...) does ~30 lookups + bookkeeping
    // calls per stepLiquid call; with 25k+ active cells per tick
    // that's the dominant cost. Only call setPixel for actual id
    // transitions (air ↔ fluid + cross-material swaps); for
    // mass-only changes write the float directly and use the
    // lighter `_markCellChanged` to update chunk-dirty + active
    // set.
    const masses = bitmap._getMassArrayUnchecked();
    const idxHere = y * W + x;

    const initialMass = masses[idxHere]!;
    let remaining = initialMass;
    if (remaining < MIN_MASS) {
        // Evaporate. setPixel handles the air transition (8-cell
        // mark for neighbors that may want to fall in).
        if (remaining > 0) {
            masses[idxHere] = 0;
            if (bitmap._readIdUnchecked(x, y) !== 0) {
                bitmap._writeIdUnchecked(x, y, 0);
                bitmap._markCellChanged(x, y, true);
            }
        }
        return;
    }

    // 1. Vertical move toward the natural-deep direction.
    const ny = y + yDir;
    if (ny >= 0 && ny < H) {
        const idxNy = ny * W + x;
        const targetId = bitmap._readIdUnchecked(x, ny);
        if (targetId !== id && targetId !== 0) {
            // Cross-material density swap. Atomic — both cells
            // change id; masses swap to follow.
            if (canVerticalSwap(srcRank, targetId, materials, yDir)) {
                const targetMass = masses[idxNy]!;
                bitmap._writeIdUnchecked(x, ny, id);
                masses[idxNy] = remaining;
                bitmap._markCellChanged(x, ny, true);
                bitmap._writeIdUnchecked(x, y, targetId);
                masses[idxHere] = targetMass;
                bitmap._markCellChanged(x, y, true);
                return;
            }
        } else if (targetId === 0 && isBubbleAt(idxNy)) {
            // Don't fill enclosed bubbles. The bubble cell will be
            // raised by `liftAirBubblesAll` instead of consumed.
        } else {
            // Air or same-material at deep: mass transfer toward
            // stable split.
            const targetMass = masses[idxNy]!;
            const total = remaining + targetMass;
            const targetEquilibrium = stableSplit(total);
            let flow = targetEquilibrium - targetMass;
            if (flow > MAX_FLOW) flow = MAX_FLOW;
            if (flow > remaining) flow = remaining;
            if (flow > MIN_FLOW) {
                const wasAir = targetMass === 0;
                masses[idxNy] = targetMass + flow;
                if (wasAir) bitmap._writeIdUnchecked(x, ny, id);
                bitmap._markCellChanged(x, ny, wasAir);
                remaining -= flow;
                if (remaining < MIN_MASS) {
                    masses[idxHere] = 0;
                    bitmap._writeIdUnchecked(x, y, 0);
                    bitmap._markCellChanged(x, y, true);
                    return;
                }
            }
        }
    }

    // 2 + 3. Lateral equalization (left and right) up to
    // `LATERAL_REACH` cells on each side.
    //
    // v3.0.3 perf: track which side stopped flowing. Once a side
    // hits a wall, a non-air different material, or the chain
    // saturates (mass equilibrated), don't re-scan it for higher
    // `d`. For settled / near-settled bodies of water this skips
    // most of the inner loop — biggest savings come from large
    // pools where most cells are at equilibrium with their
    // neighbors.
    //
    // v3.1.12: anchor check at the donation site. A source with
    // air or same-material directly below is part of a fluid
    // column that's not directly anchored on stone — stream cells,
    // off-cliff drops, sub-surface stream blocks, AND pool TOP-row
    // cells that sit on a sub-surface row. Such sources don't
    // donate laterally to UNSUPPORTED air (target air with air
    // below). Only sources with stone/static directly below — pool
    // sub-surface bottom cells, single droplets on a wall — are
    // allowed to seed an off-cliff column. This produces a single
    // narrow stream from the pool's bottom edge cell, no parallel
    // streams from the surface.
    // v3.1.15: width-from-depth — count contiguous same-material
    // cells directly above the source. The off-cliff donation rule
    // allows `d ≤ headCount + 1` so a stone-anchored pool-edge cell
    // with N cells of water above it spills into N+1 off-cliff
    // columns. Approximates Bernoulli outflow `width ∝ head` in
    // discrete cells (capped at `lateralReach` for safety).
    let headCount = 0;
    for (let yy = y - 1; yy >= 0; yy--) {
        if (bitmap._readIdUnchecked(x, yy) !== id) break;
        headCount += 1;
        if (headCount >= lateralReach) break;
    }
    const maxOffCliffD = headCount + 1;
    let leftDone = false;
    let rightDone = false;
    for (let d = 1; d <= lateralReach; d++) {
        if (remaining < MIN_MASS) break;
        if (leftDone && rightDone) break;
        for (let s = 0; s < 2; s++) {
            if (remaining < MIN_MASS) break;
            // v3.1.15: alternate scan direction per tick to remove
            // the left-first bias.
            const sx = (s ^ sxFlip) === 0 ? -1 : 1;
            if (sx === -1 && leftDone) continue;
            if (sx === 1 && rightDone) continue;
            const nx = x + sx * d;
            if (nx < 0 || nx >= W) {
                if (sx === -1) leftDone = true; else rightDone = true;
                continue;
            }
            const idxNx = y * W + nx;
            const targetId = bitmap._readIdUnchecked(nx, y);
            if (targetId !== id && targetId !== 0) {
                if (sx === -1) leftDone = true; else rightDone = true;
                continue;
            }
            // v3.1.12 (refined v3.1.14): block lateral donation to
            // UNSUPPORTED air (target air whose natural-deep
            // neighbor is also air — the cliff-drop column) when
            // either:
            //   (a) source's deep neighbor is air or same-material
            //       (source is part of a fluid column NOT directly
            //       anchored on stone — pool top-row, mid-stream
            //       cells, off-cliff cells), OR
            //   (b) `d > 1` even with a stone-anchored source —
            //       a stone-supported pool-edge cell IS allowed to
            //       donate to the immediately adjacent off-cliff
            //       column (the drainage seed) but NOT to further
            //       columns past it. Without (b), the lateral scan
            //       at reach=25 turns one drainage seed into 25
            //       parallel streams of decreasing mass; with (b)
            //       the stream is exactly one column wide and
            //       symmetric between left- and right-cliff
            //       scenarios.
            if (targetId === 0) {
                // v3.1.19: don't laterally donate into an enclosed
                // air bubble. Bubbles are raised by
                // `liftAirBubblesAll`; treating them as drainage
                // space lets a single perimeter water cell collapse
                // a bubble in one tick.
                if (isBubbleAt(idxNx)) {
                    if (sx === -1) leftDone = true; else rightDone = true;
                    continue;
                }
                const tny = y + yDir;
                if (tny >= 0 && tny < H
                    && bitmap._readIdUnchecked(nx, tny) === 0) {
                    const srcBelow = bitmap._readIdUnchecked(x, tny);
                    if (srcBelow === 0 || srcBelow === id || d > maxOffCliffD) {
                        if (sx === -1) leftDone = true; else rightDone = true;
                        continue;
                    }
                }
            }
            const targetMass = masses[idxNx]!;
            const diff = remaining - targetMass;
            // v3.1.2 (refined v3.1.3): treat a target as a mid-fall
            // stream column ONLY when it's in a narrow vertical
            // column.
            //
            // Criterion: same-material directly above AND at least
            // one lateral side is non-same-material. The narrow
            // check distinguishes a 1–2 cell wide falling stream
            // (water pouring off a cliff) from a sub-surface cell of
            // a wide settled pool. Both have same-material above,
            // but a sub-surface pool middle has same-material on
            // both lateral sides; a stream has air (or differing
            // material) on at least one side.
            //
            // Pre-v3.1.3 used same-material-above alone, which made
            // sub-surface pool cells skip lateral equalization
            // entirely. Visible as a "pile" of water at a stream's
            // landing point and as the source pool failing to drain.
            const isNarrowColumn = targetId === id && y > 0
                && bitmap._readIdUnchecked(nx, y - 1) === id
                && ((nx - 1 < 0 || bitmap._readIdUnchecked(nx - 1, y) !== id)
                    || (nx + 1 >= W || bitmap._readIdUnchecked(nx + 1, y) !== id));
            if (diff <= 0) {
                if (isNarrowColumn) continue;
                if (sx === -1) leftDone = true; else rightDone = true;
                continue;
            }
            let flow = diff * LATERAL_EQUALIZE;
            if (flow > MAX_FLOW) flow = MAX_FLOW;
            if (flow > remaining) flow = remaining;
            if (flow > MIN_FLOW) {
                if (isNarrowColumn) continue;
                const wasAir = targetMass === 0;
                masses[idxNx] = targetMass + flow;
                if (wasAir) bitmap._writeIdUnchecked(nx, y, id);
                bitmap._markCellChanged(nx, y, wasAir);
                remaining -= flow;
            } else {
                if (isNarrowColumn) continue;
                if (sx === -1) leftDone = true; else rightDone = true;
            }
        }
    }

    // 4. Compression overflow toward the natural-shallow direction.
    if (remaining > MAX_MASS) {
        const upY = y - yDir;
        if (upY >= 0 && upY < H) {
            const idxUp = upY * W + x;
            const targetId = bitmap._readIdUnchecked(x, upY);
            if (targetId === id || targetId === 0) {
                const targetMass = masses[idxUp]!;
                const total = remaining + targetMass;
                const sourceEquilibrium = stableSplit(total);
                let flow = remaining - sourceEquilibrium;
                if (flow > MAX_FLOW) flow = MAX_FLOW;
                if (flow > remaining) flow = remaining;
                if (flow > MIN_FLOW) {
                    const wasAir = targetMass === 0;
                    masses[idxUp] = targetMass + flow;
                    if (wasAir) bitmap._writeIdUnchecked(x, upY, id);
                    bitmap._markCellChanged(x, upY, wasAir);
                    remaining -= flow;
                }
            }
        }
    }

    // Final commit. Three cases:
    //  - Mass dropped below MIN_MASS → evaporate, id transition
    //    fires the 8-neighbor wake.
    //  - Mass changed by more than MIN_FLOW → write back, mark
    //    cell active for next tick.
    //  - Mass effectively unchanged (sub-MIN_FLOW drift OR no
    //    transfer at all) → don't touch the active set so the
    //    cell drops out of the rotation. Big perf win for
    //    settled bodies of water — most cells in a stable pool
    //    fall into this branch each tick.
    const delta = remaining - initialMass;
    if (remaining < MIN_MASS) {
        masses[idxHere] = 0;
        bitmap._writeIdUnchecked(x, y, 0);
        bitmap._markCellChanged(x, y, true);
    } else if (delta > MIN_FLOW || delta < -MIN_FLOW) {
        masses[idxHere] = remaining;
        bitmap._markCellChanged(x, y, false);
    }
}

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

    // Horizontal flow — air only. Two regimes:
    //
    // (A) **Source under pressure** (same-rank cell in the
    //     opposite direction of motion — above for sinking, below
    //     for rising): single 1-cell push into the nearest air.
    //     Multi-cell jumps would leave the intermediate cells as
    //     air pockets, visible as internal gaps inside a pile.
    //
    // (B) **No pressure**: multi-cell flow up to `flowDist` cells
    //     in the preferred-then-other direction, landing at the
    //     farthest reachable air. Flow halts at the first non-air
    //     cell so it never tunnels through other fluids.
    //
    // **Anti-oscillation memory (v2.7.6)**: the pre-v2.7.6
    // "same-rank-beyond guard" is gone. In its place,
    // `bitmap.horizFlowSource` records the X coordinate the
    // current occupant came from on its last horizontal flow.
    // The flow scan skips a target equal to that source X
    // (would just undo the prior move). This prevents 2-tick
    // pocket-dance oscillations while ALSO permitting cells to
    // compact across air gaps — the regime the same-rank-beyond
    // guard wrongly blocked. Net result: surfaces actually
    // flatten over time.
    //
    // `setPixel` resets `horizFlowSource[idx]` to `0xFFFF` (no
    // memory), so a cell that arrives at a position via a
    // density swap or external mutation has fresh history; only
    // the cell that just *flowed* to its current position
    // carries the don't-flow-back constraint.
    const pressureY = y - yDir;
    let underPressure = false;
    if (pressureY >= 0 && pressureY < H) {
        const pressureId = bitmap.getPixel(x, pressureY);
        if (pressureId !== 0 && densityRank(pressureId, materials) === srcRank) {
            underPressure = true;
        }
    }

    if (flowDist > 0) {
        const flowSource = bitmap.horizFlowSource;
        const cameFromX = flowSource[y * W + x]!;
        for (const sx of sides) {
            let target = -1;
            if (underPressure) {
                const nx = x + sx;
                if (
                    nx >= 0
                    && nx < W
                    && nx !== cameFromX
                    && bitmap.getPixel(nx, y) === 0
                ) {
                    target = nx;
                }
            } else {
                for (let d = 1; d <= flowDist; d++) {
                    const nx = x + sx * d;
                    if (nx < 0 || nx >= W) break;
                    if (bitmap.getPixel(nx, y) !== 0) break;
                    if (nx === cameFromX) break;
                    target = nx;
                }
            }
            if (target !== -1) {
                bitmap.setPixel(target, y, id);
                bitmap.setPixel(x, y, 0);
                // Remember the source X so this cell skips a flow
                // back next tick. setPixel just reset the target's
                // entry to 0xFFFF, so we're free to write here.
                flowSource[y * W + target] = x;
                movedThisTick.add(y * W + target);
                return true;
            }
        }
    }

    return false;
}

/**
 * Sand step: density-aware fall + air-only diagonal slide + a
 * pressure-based horizontal escape (v2.7.4) for buried grains.
 *
 * Sand normally has `flowDistance = 0` (granular: only falls /
 * slides diagonally, no horizontal flow). That gives a 45° angle
 * of repose, which produces visibly-vertical piles when sand is
 * poured faster than diagonals can carry it away.
 *
 * To break this, we count consecutive same-id cells stacked
 * directly above. When the stack reaches `SAND_PRESSURE_THRESHOLD`
 * cells, the bottom-most grain is treated as "buried" and gets a
 * mild horizontal flow (`SAND_PRESSURE_FLOW_DIST`) so the pile's
 * base spreads outward. Top of the pile keeps the granular look;
 * the base widens until pressure relieves itself.
 *
 * Active-set bookkeeping: `setPixel` auto-marks moved cells, so
 * the fall / horizontal-flow paths need no explicit re-add. A
 * non-moving cell drops out of the active set unless this material
 * has settling configured, in which case the rest-timer needs to
 * keep ticking — we mark the cell active explicitly until either
 * it moves (because a neighbor opened up) or it promotes
 * (`setPixel` fires when settling and the new id's auto-mark
 * covers re-activation).
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
    let pressureFlow = 0;
    let stack = 0;
    for (let yy = y - 1; yy >= 0 && stack < SAND_PRESSURE_THRESHOLD; yy--) {
        if (bitmap.getPixel(x, yy) !== id) break;
        stack++;
    }
    if (stack >= SAND_PRESSURE_THRESHOLD) pressureFlow = SAND_PRESSURE_FLOW_DIST;

    const moved = stepFluid(
        bitmap, materials, x, y, id, W, H, goRight, movedThisTick,
        +1, RANK_SAND, pressureFlow,
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
 * Number of consecutive same-id cells stacked directly above a
 * sand grain that triggers the pressure-based horizontal escape.
 * 3 means "a sand cell with at least 3 grains above it gets a
 * mild horizontal flow." Lower → flatter piles, more water-like.
 * Higher → more vertical piles, more granular.
 */
const SAND_PRESSURE_THRESHOLD = 3;

/**
 * Horizontal flow distance applied to sand grains under pressure
 * (see {@link SAND_PRESSURE_THRESHOLD}). Set to `1` because
 * pressure-mode flow is always 1-cell-only (see the comment in
 * `stepFluid`'s horizontal-flow block) — any non-zero value
 * here just gates the flow on/off. Kept as a constant rather
 * than a literal so the intent stays explicit at the call site.
 */
const SAND_PRESSURE_FLOW_DIST = 1;

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
 * Fire step: water-extinguish check → ignite one flammable
 * neighbor → age the cell's own burn timer.
 *
 * **Water extinguishes (v2.7.2)**: if any of the four cardinal
 * neighbors is a `'water'`-simulation cell, both the fire and
 * the water turn to air this tick. The check runs BEFORE
 * ignition and aging, so a fire cell adjacent to water never
 * spreads or burns down a wood chain — water always wins. The
 * reaction is one fire ↔ one water per tick (the first water
 * neighbor encountered); a fire fully encased in water takes a
 * single tick to die regardless.
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
    // Water extinguishment — if a 4-neighbor is water, both die.
    // Cardinal-only (no diagonals) so a fire cell separated from
    // water by a corner still burns; a sheet of water actually
    // touching the fire kills it.
    const cardinals: readonly (readonly [number, number])[] = [
        [0, -1], [-1, 0], [1, 0], [0, 1],
    ];
    for (const dir of cardinals) {
        const nx = x + dir[0]!;
        const ny = y + dir[1]!;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const neighborId = bitmap.getPixel(nx, ny);
        if (neighborId === 0) continue;
        const neighborMat = materials.get(neighborId);
        if (neighborMat?.simulation !== 'water') continue;
        bitmap.setPixel(x, y, 0);
        bitmap.setPixel(nx, ny, 0);
        movedThisTick.add(ny * W + nx);
        return;
    }

    const burnDuration = material.burnDuration ?? 60;
    const timers = bitmap.cellTimers;
    const idx = y * W + x;
    const current = timers[idx]!;

    // Try to ignite a flammable neighbor (up / left / right / down).
    // Order is fixed (no L/R alternation): fire spread is slow
    // enough already that L/R bias isn't visible.
    for (const dir of cardinals) {
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
