/**
 * Connected-component pool detection for the v3.1 fluid sim.
 *
 * A {@link FluidPool} is a maximal connected set of same-
 * material fluid cells (water / oil / gas). Each tick the
 * cellular automaton groups its active fluid cells into
 * pools, reads aggregate state (total mass, cell count, etc.),
 * and replaces the per-cell `stepLiquid` work with a single
 * O(N) equilibrium distribution per pool. Settled pools cost
 * effectively nothing.
 *
 * Pool membership is tracked via a per-cell `Uint16Array`
 * sidecar on `ChunkedBitmap`. `0xFFFF` is the sentinel for
 * "not in any pool."
 *
 * This file owns:
 *
 *  - The `FluidPool` shape.
 *  - `detectPools(bitmap)` — full flood-fill rebuild of the
 *    pool registry (used by v3.1 phase 1 each tick; phase 3
 *    will replace it with incremental maintenance).
 *  - Helpers for marking / clearing pool ids.
 */
import type { ChunkedBitmap } from '../ChunkedBitmap.js';
import type { MaterialRegistry } from '../Materials.js';

/** Pool-id sentinel meaning "this cell isn't in a pool." */
export const NO_POOL = 0xFFFF;

/**
 * Connected component of fluid cells (water / oil / gas).
 *
 * Pools are owned by `ChunkedBitmap` and rebuilt (phase 1) or
 * incrementally maintained (phase 3) each tick. They expose
 * the aggregate state that the v3.1 step uses to skip per-cell
 * work in stable bodies of fluid.
 *
 * **v3.1.17:** pools are now MULTI-MATERIAL — flood fill 4-
 * connects ANY fluid cell regardless of id. A cell of oil
 * touching a cell of water joins the same pool. The pool then
 * carries per-id mass totals and `distributePoolMass` writes a
 * density-stratified profile (heaviest fluid at the bottom,
 * lightest at the top). This makes oil rise to the top of water
 * within one tick of pool detection, and self-heals chimneys
 * that the per-cell density-swap rule alone can't unwind
 * (lateral cross-density swaps don't exist in the per-cell path).
 */
export interface FluidPool {
    /** Stable id (the index used in the per-cell sidecar). */
    readonly id: number;
    /**
     * Per-material total mass in this pool. Keys are material ids
     * present in the pool; values are the summed mass of cells
     * holding that id.
     */
    readonly materialMass: Map<number, number>;
    /**
     * Cell flat indices (`y * width + x`) belonging to the pool.
     * Use a Set so add / remove are O(1) for incremental
     * maintenance in phase 3.
     */
    readonly cells: Set<number>;
    /**
     * Enclosed-air-bubble cells associated with this pool (v3.1.19).
     * Air cells whose flood-fill component does NOT touch the world
     * edge AND whose bounding non-air neighbors are all static or
     * fluid (any pool). Each tick's `liftAirBubbles` pass swaps each
     * bubble cell with the fluid cell directly above, raising the
     * bubble one row per tick until it surfaces. Empty for pools
     * without trapped air.
     */
    readonly airCells: Set<number>;
    /**
     * Sum of cell masses across the pool, across all materials.
     * Updated when cells are added / removed and during the
     * equilibrium pass.
     */
    totalMass: number;
    /**
     * `true` when membership might be stale — set by `setPixel`
     * / `setMass` when a cell crossed an air ↔ fluid boundary
     * within or adjacent to this pool. The next call to
     * `detectPools` re-runs flood fill on these.
     */
    dirty: boolean;
}

/**
 * Density rank for a fluid material (matches the CellularAutomaton
 * rank constants). Higher = heavier. Returned by the rank function
 * for use in hydrostatic stratification inside `distributePoolMass`.
 *
 * Kept private to this module to avoid a circular import
 * (CellularAutomaton.ts imports FluidPools.ts, not the other way).
 * The values match `RANK_GAS / RANK_OIL / RANK_WATER` in
 * CellularAutomaton.ts; updates must stay in sync.
 */
function fluidRank(simulation: string): number {
    switch (simulation) {
        case 'gas': return 0;
        case 'napalm': return 2.5;
        case 'oil': return 3;
        case 'water': return 4;
        default: return -1;
    }
}

/**
 * Returns `true` if the cell at `(x, y)` is **interior** to its
 * pool — every 4-neighbor in bounds shares the same pool id.
 * Cells on the world edge are never interior (out-of-bounds is
 * treated as "different pool"). Pure pool-id reads, no
 * material lookup; safe inside the sim hot path.
 *
 * Used by the outer step loop to skip per-cell `stepLiquid` work
 * for cells deep inside a pool — their mass is set en masse by
 * the pool's equilibrium distribution and they have nothing to
 * exchange with neighbors of the same pool.
 */
export function isPoolInterior(
    poolIds: Uint16Array,
    x: number,
    y: number,
    W: number,
    H: number,
    poolId: number,
): boolean {
    if (x === 0 || x === W - 1 || y === 0 || y === H - 1) return false;
    const idx = y * W + x;
    if (
        poolIds[idx - 1] !== poolId
        || poolIds[idx + 1] !== poolId
        || poolIds[idx - W] !== poolId
        || poolIds[idx + W] !== poolId
    ) {
        return false;
    }
    return true;
}

/**
 * Distributes the pool's mass across its cells as a hydrostatic
 * density-stratified bottom-up fill. Bottom rows hold the
 * heaviest fluid present (saturated), then transitioning to the
 * next-heavier as that fluid's mass budget runs out, until the
 * top row may hold the lightest fluid at partial mass. Within a
 * row, mass is uniform.
 *
 * **v3.1.17 multi-material extension.** Pools may contain a mix
 * of water / oil / gas (anywhere they are 4-connected). The
 * fill processes fluids in rank-descending order (water first,
 * then oil, then gas) and flips id + mass per cell. A "transition
 * row" (where one fluid's budget ends mid-row) is filled
 * uniformly with that fluid at partial mass; the next-lighter
 * fluid starts at the next row up. This means the visible
 * surface profile may include short transition layers but each
 * row holds exactly one id.
 *
 * The single-fluid case collapses to the v3.1.8 behavior: bottom
 * rows saturated, topmost row at partial mass with the remainder.
 *
 * This is the canonical "instant pool flattening" pass in CA
 * fluid sims (W-Shadow / jgallant / Noita lineage): a brush
 * burst that lands on top of a connected pool merges and the
 * pool's surface rises by `mass_added / footprint_width` —
 * matching real-water hydrostatics — within one tick instead of
 * cascading via reach-25 lateral over many ticks. With the
 * multi-material extension, mixed fluids self-sort by density
 * within a single pool-detection cycle.
 *
 * Cells in rows ABOVE all fluid surfaces (no mass left after the
 * fill) are demoted to air (mass = 0, id = 0) — otherwise they'd
 * sit at id = fluid with mass = 0, blocking pool re-detection
 * next tick.
 *
 * Caller is responsible for `pool.totalMass` and
 * `pool.materialMass` being current (i.e. having just rebuilt the
 * pool via `detectPools`).
 */
export function distributePoolMass(
    bitmap: ChunkedBitmap,
    pool: FluidPool,
    materials: MaterialRegistry,
): void {
    if (pool.cells.size === 0) return;
    const W = bitmap.width;

    // Group cells by y, then sort y values descending (bottom first).
    // v3.1.21: include "stuck" enclosed-air-bubble cells in the row
    // footprint so distribute can relocate bubbles past overhangs
    // the per-tick `liftAirBubbles` rule can't navigate. A bubble
    // cell is stuck when its up-neighbor is NOT a pool fluid cell
    // (stone or out-of-bounds) — `liftAirBubbles` then can't swap
    // upward. For unstuck bubbles (fluid or another bubble cell
    // directly above), keep the per-tick 1-row animation by
    // EXCLUDING them from distribute's footprint.
    const poolIds = bitmap._getPoolIdsUnchecked();
    const cellsByY = new Map<number, number[]>();
    for (const idx of pool.cells) {
        const y = (idx / W) | 0;
        let row = cellsByY.get(y);
        if (row === undefined) {
            row = [];
            cellsByY.set(y, row);
        }
        row.push(idx);
    }
    let hasAirBubbles = false;
    for (const idx of pool.airCells) {
        const y = (idx / W) | 0;
        // Skip bubble cells that can rise via the per-tick lift.
        if (y > 0) {
            const upIdx = idx - W;
            if (poolIds[upIdx] === pool.id) continue;
        }
        // Stuck — include in distribute.
        let row = cellsByY.get(y);
        if (row === undefined) {
            row = [];
            cellsByY.set(y, row);
        }
        row.push(idx);
        hasAirBubbles = true;
    }
    const ys = [...cellsByY.keys()].sort((a, b) => b - a);
    // v3.1.22: sort cells within each row by index (= x ascending,
    // since y is fixed within a row) so the transition-row cells
    // and the leftover air cells end up at the same x positions
    // every tick. Without this sort, flood-fill insertion order
    // bleeds into distribute's output: a transition cell or stray
    // air cell would jitter between x positions across ticks as
    // the flood-fill stack happened to reach different cells first.
    for (const row of cellsByY.values()) row.sort((a, b) => a - b);

    // Materials in this pool, sorted heaviest-first (water > oil > gas).
    const idsByRank = [...pool.materialMass.keys()].sort((a, b) => {
        const ra = fluidRank(materials.get(a)!.simulation!);
        const rb = fluidRank(materials.get(b)!.simulation!);
        return rb - ra;
    });

    // Per-id remaining mass to place. Mutated as we fill rows.
    const remaining = new Map<number, number>();
    for (const [id, m] of pool.materialMass) remaining.set(id, m);

    const masses = bitmap._getMassArrayUnchecked();

    // Helper to write an id+mass to a cell, dirtying it if the id
    // changed. Skips redundant writes for perf.
    const assignCell = (idx: number, newId: number, newMass: number): void => {
        const cy = (idx / W) | 0;
        const cx = idx - cy * W;
        const oldId = bitmap._readIdUnchecked(cx, cy);
        if (oldId !== newId) {
            bitmap._writeIdUnchecked(cx, cy, newId);
            bitmap._markCellChanged(cx, cy, true);
        }
        masses[idx] = newMass;
    };

    // Helper: does any fluid AFTER `activeIdx` still have mass?
    const hasMoreFluidAfter = (activeIdx: number): boolean => {
        for (let i = activeIdx + 1; i < idsByRank.length; i++) {
            const id = idsByRank[i]!;
            if ((remaining.get(id) ?? 0) > 0) return true;
        }
        return false;
    };

    // Walk fluids in rank order: bottom rows saturate with the
    // heaviest, then transition to the next-heavier as that fluid
    // runs out. Within a single fluid, partial-fill rows use uniform
    // mass (smooth surface). At a fluid-to-fluid transition where
    // one row would otherwise mix two fluids, allocate WHOLE cells
    // (saturated) to each fluid in turn — the row's id is non-
    // uniform but mass is conserved per id.
    //
    // Floating-point note: water mass accumulated through many
    // mass-transfer ticks drifts off integer multiples of `MAX_MASS`
    // by ~`Number.EPSILON × N`. We use `MASS_DRIFT_EPS` instead of
    // 0 for the "fluid exhausted" check so a row that would
    // otherwise be allocated to the lighter fluid isn't stolen by
    // a microscopic remainder of the heavier fluid (would silently
    // overwrite oil with water at mass ~1e-7, leaking the lighter
    // fluid's mass into the leftover branch).
    let fluidIdx = 0;
    let activeId = idsByRank[fluidIdx];
    while (activeId !== undefined && (remaining.get(activeId) ?? 0) <= MASS_DRIFT_EPS) {
        fluidIdx += 1;
        activeId = idsByRank[fluidIdx];
    }

    for (const y of ys) {
        const rowCells = cellsByY.get(y)!;
        const rowCellCount = rowCells.length;
        let cellsAssigned = 0;

        while (cellsAssigned < rowCellCount) {
            while (activeId !== undefined && (remaining.get(activeId) ?? 0) <= MASS_DRIFT_EPS) {
                fluidIdx += 1;
                activeId = idsByRank[fluidIdx];
            }
            if (activeId === undefined) {
                // No fluid left — demote remaining cells in this row
                // (and all higher rows) to air.
                for (let i = cellsAssigned; i < rowCellCount; i++) {
                    assignCell(rowCells[i]!, 0, 0);
                }
                cellsAssigned = rowCellCount;
                break;
            }

            const cellsLeft = rowCellCount - cellsAssigned;
            const capacityLeft = cellsLeft * MAX_POOL_MASS_PER_CELL;
            const remainingForActive = remaining.get(activeId)!;

            if (remainingForActive >= capacityLeft) {
                // Active fluid fills the rest of the row.
                for (let i = cellsAssigned; i < rowCellCount; i++) {
                    assignCell(rowCells[i]!, activeId, MAX_POOL_MASS_PER_CELL);
                }
                remaining.set(activeId, remainingForActive - capacityLeft);
                cellsAssigned = rowCellCount;
            } else if (!hasMoreFluidAfter(fluidIdx) && !hasAirBubbles) {
                // Single-fluid surface row — distribute remaining
                // mass uniformly (smooth visible surface). Matches
                // pre-v3.1.17 behavior for single-fluid pools.
                // Skipped when the pool has air bubbles: those need
                // whole-cell allocation so leftover cells become air
                // rather than getting smeared with thin fluid mass
                // (which would erase the bubble visually).
                const perCell = remainingForActive / cellsLeft;
                for (let i = cellsAssigned; i < rowCellCount; i++) {
                    assignCell(rowCells[i]!, activeId, perCell);
                }
                remaining.set(activeId, 0);
                cellsAssigned = rowCellCount;
            } else {
                // Multi-fluid transition row: allocate whole cells
                // saturated for activeId, then loop continues with
                // the next fluid for the remaining cells. Float-
                // drift `partialMass` (below `MASS_DRIFT_EPS`) is
                // discarded rather than allocated to a cell —
                // otherwise a residual ~1e-7 of the heavier fluid
                // takes the cell slot the lighter fluid needs and
                // its mass leaks into the post-loop leftover branch
                // which has no air-id cell to credit.
                const fullCells = Math.floor(remainingForActive / MAX_POOL_MASS_PER_CELL);
                const partialMass = remainingForActive - fullCells * MAX_POOL_MASS_PER_CELL;
                for (let i = 0; i < fullCells; i++) {
                    assignCell(rowCells[cellsAssigned + i]!, activeId, MAX_POOL_MASS_PER_CELL);
                }
                cellsAssigned += fullCells;
                if (partialMass > MASS_DRIFT_EPS && cellsAssigned < rowCellCount) {
                    assignCell(rowCells[cellsAssigned]!, activeId, partialMass);
                    cellsAssigned += 1;
                }
                remaining.set(activeId, 0);
            }
        }
    }

    // Mass conservation: any leftover (heavier-than-pool-capacity
    // single fluid) compresses onto the topmost row of its id —
    // matches the v3.1.8 single-fluid behavior. With multi-fluid
    // pools the loop above conserves mass exactly, so leftover is
    // only nonzero when the heaviest fluid alone exceeds pool
    // capacity (compressed water tank).
    let leftoverMass = 0;
    let leftoverId = 0;
    for (const [id, m] of remaining) {
        if (m > 0) {
            leftoverMass += m;
            leftoverId = id;
        }
    }
    if (leftoverMass > 0 && ys.length > 0) {
        const topY = ys[ys.length - 1]!;
        const topCells = cellsByY.get(topY)!;
        const bonusPerCell = leftoverMass / topCells.length;
        for (const idx of topCells) {
            const cy = (idx / W) | 0;
            const cx = idx - cy * W;
            if (bitmap._readIdUnchecked(cx, cy) === leftoverId) {
                masses[idx] = masses[idx]! + bonusPerCell;
            }
        }
    }
}

/**
 * Mass each cell holds when its row is fully saturated by
 * `distributePoolMass`. Equal to `MAX_MASS = 1.0`. Compression
 * (`mass > MAX_MASS`) is intentionally not modeled by the pool
 * fast path — rendering is binary so the visible surface is the
 * top of the topmost cell that holds any mass, regardless of
 * compressed depth below.
 */
const MAX_POOL_MASS_PER_CELL = 1.0;

/**
 * Threshold under which a fluid's accumulated mass is treated as
 * "exhausted" inside `distributePoolMass`. Float32 mass arrays
 * drift by ~Number.EPSILON × cells when many ticks of
 * `stableSplit`-driven micro-transfers run; without a tolerance,
 * a residual ~1e-7 of the heavier fluid steals the surface row
 * that should host the lighter fluid (e.g. water with 60.0000003
 * mass eats the oil cell that should sit on top of it). Set just
 * above the noise floor seen in practice; well below `MIN_MASS`
 * so it can't mask a genuine sub-cell amount of fluid.
 */
const MASS_DRIFT_EPS = 1e-5;

/**
 * Full rebuild of the pool registry from the current bitmap.
 * O(N) where N is the count of fluid cells.
 *
 * Returns the new registry; replaces any existing one. Each
 * cell's pool-id sidecar entry is updated to point at the
 * pool that owns it (or `NO_POOL` for cells that aren't
 * part of any pool — i.e. air, static, sand, fire).
 *
 * Materials are considered "fluid" for pooling iff
 * `simulation` is `'water' | 'oil' | 'gas'`. Sand and fire
 * stay per-cell.
 *
 * **v3.1.17:** flood fill is multi-material — any 4-connected
 * fluid cells join the same pool regardless of id. The pool
 * carries per-id mass totals so `distributePoolMass` can sort
 * by density. This is what makes oil rise to the top of water
 * (and a water "chimney" through oil heal) within a single
 * tick of pool detection.
 *
 * Phase 1: the cellular automaton calls this every tick.
 * Phase 3 will replace with incremental maintenance keyed off
 * `setPixel` / `setMass` calls.
 */
export function detectPools(
    bitmap: ChunkedBitmap,
    materials: MaterialRegistry,
): Map<number, FluidPool> {
    const W = bitmap.width;
    const H = bitmap.height;
    const poolIds = bitmap._getPoolIdsUnchecked();
    poolIds.fill(NO_POOL);
    const masses = bitmap._getMassArrayUnchecked();
    const out = new Map<number, FluidPool>();
    let nextId = 0;

    // Stack-based flood fill so we don't blow the call stack on
    // big pools. Reused across components to avoid repeated
    // allocation.
    const stack: number[] = [];

    // Cache "is fluid" per material id we encounter during the
    // outer scan to avoid repeated map lookups.
    const isFluidCache = new Map<number, boolean>();
    const isFluid = (mid: number): boolean => {
        const cached = isFluidCache.get(mid);
        if (cached !== undefined) return cached;
        const mat = materials.get(mid);
        const sim = mat?.simulation;
        const v = sim === 'water' || sim === 'oil' || sim === 'napalm' || sim === 'gas';
        isFluidCache.set(mid, v);
        return v;
    };

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const flatIdx = y * W + x;
            if (poolIds[flatIdx] !== NO_POOL) continue;
            const id = bitmap._readIdUnchecked(x, y);
            if (id === 0) continue;
            if (!isFluid(id)) continue;

            // Start a new component. Flood-fill to all 4-connected
            // fluid cells (any fluid id).
            const poolId = nextId++;
            const cells = new Set<number>();
            const materialMass = new Map<number, number>();
            let totalMass = 0;
            stack.length = 0;
            stack.push(flatIdx);
            poolIds[flatIdx] = poolId;
            while (stack.length > 0) {
                const fi = stack.pop()!;
                cells.add(fi);
                const cy = (fi / W) | 0;
                const cx = fi - cy * W;
                const cellId = bitmap._readIdUnchecked(cx, cy);
                const cellMass = masses[fi]!;
                totalMass += cellMass;
                materialMass.set(cellId, (materialMass.get(cellId) ?? 0) + cellMass);
                // 4-connected neighbors. Multi-material: any fluid
                // joins the same pool.
                if (cx > 0) {
                    const ni = fi - 1;
                    const nid = bitmap._readIdUnchecked(cx - 1, cy);
                    if (poolIds[ni] === NO_POOL && nid !== 0 && isFluid(nid)) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
                if (cx + 1 < W) {
                    const ni = fi + 1;
                    const nid = bitmap._readIdUnchecked(cx + 1, cy);
                    if (poolIds[ni] === NO_POOL && nid !== 0 && isFluid(nid)) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
                if (cy > 0) {
                    const ni = fi - W;
                    const nid = bitmap._readIdUnchecked(cx, cy - 1);
                    if (poolIds[ni] === NO_POOL && nid !== 0 && isFluid(nid)) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
                if (cy + 1 < H) {
                    const ni = fi + W;
                    const nid = bitmap._readIdUnchecked(cx, cy + 1);
                    if (poolIds[ni] === NO_POOL && nid !== 0 && isFluid(nid)) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
            }
            out.set(poolId, {
                id: poolId,
                materialMass,
                cells,
                airCells: new Set<number>(),
                totalMass,
                dirty: false,
            });
        }
    }

    // v3.1.19: second pass — flood-fill air components and classify
    // each as enclosed-or-not. An enclosed component touches no
    // world edge AND every bounding non-air cell is either static
    // or in some fluid pool. Enclosed components attach to the
    // smallest-id pool they bound (so a single bubble pinned by
    // multiple pools becomes one of them; doesn't matter much for
    // demo cases since the unified-pool flood-fill already merges
    // any 4-connected fluid).
    detectAirBubbles(bitmap, poolIds, out);

    return out;
}

/**
 * Finds enclosed air components in the bitmap and assigns them to
 * the appropriate fluid pool's `airCells` set.
 *
 * Run AFTER fluid pool flood fill has populated `poolIds`. Iterates
 * the bitmap once, flood-filling each unvisited air cell. Tracks
 * whether the component touches the world edge and which fluid pool
 * ids bound it. Components that don't touch any edge AND have at
 * least one bounding fluid pool count as "enclosed bubbles" and are
 * appended to one of those pools.
 *
 * Cost: O(N) over air cells per call. Cheap relative to fluid pool
 * detection in typical scenes (most air is open air = one big
 * non-enclosed component).
 */
function detectAirBubbles(
    bitmap: ChunkedBitmap,
    poolIds: Uint16Array,
    pools: Map<number, FluidPool>,
): void {
    const W = bitmap.width;
    const H = bitmap.height;
    const visited = new Uint8Array(W * H);
    const stack: number[] = [];
    const componentCells: number[] = [];

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const startIdx = y * W + x;
            if (visited[startIdx]) continue;
            if (bitmap._readIdUnchecked(x, y) !== 0) continue;

            let touchesEdge = false;
            let smallestPoolId = NO_POOL;
            componentCells.length = 0;
            stack.length = 0;
            stack.push(startIdx);
            visited[startIdx] = 1;

            while (stack.length > 0) {
                const fi = stack.pop()!;
                componentCells.push(fi);
                const cy = (fi / W) | 0;
                const cx = fi - cy * W;
                if (cx === 0 || cx === W - 1 || cy === 0 || cy === H - 1) {
                    touchesEdge = true;
                }
                // 4-connected neighbors.
                if (cx > 0) {
                    const ni = fi - 1;
                    const nid = bitmap._readIdUnchecked(cx - 1, cy);
                    if (nid === 0) {
                        if (!visited[ni]) {
                            visited[ni] = 1;
                            stack.push(ni);
                        }
                    } else {
                        const pid = poolIds[ni]!;
                        if (pid !== NO_POOL && pid < smallestPoolId) smallestPoolId = pid;
                    }
                }
                if (cx + 1 < W) {
                    const ni = fi + 1;
                    const nid = bitmap._readIdUnchecked(cx + 1, cy);
                    if (nid === 0) {
                        if (!visited[ni]) {
                            visited[ni] = 1;
                            stack.push(ni);
                        }
                    } else {
                        const pid = poolIds[ni]!;
                        if (pid !== NO_POOL && pid < smallestPoolId) smallestPoolId = pid;
                    }
                }
                if (cy > 0) {
                    const ni = fi - W;
                    const nid = bitmap._readIdUnchecked(cx, cy - 1);
                    if (nid === 0) {
                        if (!visited[ni]) {
                            visited[ni] = 1;
                            stack.push(ni);
                        }
                    } else {
                        const pid = poolIds[ni]!;
                        if (pid !== NO_POOL && pid < smallestPoolId) smallestPoolId = pid;
                    }
                }
                if (cy + 1 < H) {
                    const ni = fi + W;
                    const nid = bitmap._readIdUnchecked(cx, cy + 1);
                    if (nid === 0) {
                        if (!visited[ni]) {
                            visited[ni] = 1;
                            stack.push(ni);
                        }
                    } else {
                        const pid = poolIds[ni]!;
                        if (pid !== NO_POOL && pid < smallestPoolId) smallestPoolId = pid;
                    }
                }
            }

            if (touchesEdge) continue;
            if (smallestPoolId === NO_POOL) continue; // sealed cavity, no pool
            const pool = pools.get(smallestPoolId);
            if (pool === undefined) continue;
            for (const ci of componentCells) {
                pool.airCells.add(ci);
                // Tag the bubble cell with the bounding pool's id in
                // the sidecar so `stepLiquid` knows not to flow water
                // into it. Without this tag, lateral / vertical
                // donations from adjacent pool fluid cells fill the
                // bubble within one tick (CA fluids treat any air
                // cell as available drainage space, regardless of
                // enclosure). The tag overlaps with fluid pool ids
                // for the same pool — `isPoolInterior` consumers must
                // continue to gate on `bitmap.getPixel(x, y) !== 0`
                // before treating a poolId as a fluid pool member.
                poolIds[ci] = smallestPoolId;
            }
        }
    }
}

/**
 * Lifts each enclosed air-bubble cell one row by swapping it with
 * the fluid pool cell directly above (v3.1.19). Run once per pool
 * per tick, AFTER `distributePoolMass` so the swapped fluid cell
 * carries its post-distribute mass.
 *
 * Order: bubble cells are processed top-first (y ascending). When
 * a 2+ cell tall bubble is processed, the top cell rises into a
 * fluid; the algorithm then promotes the just-vacated position to
 * a pool member (poolIds + id), which lets the next bubble cell
 * down see a valid fluid above and rise into it. Without that
 * within-pass promotion, a tall bubble would tear apart vertically
 * (top cell rises, lower cells block on the now-air-but-stale-
 * poolIds gap) and split into singletons.
 *
 * Mass and id are swapped 1:1 between the two cells. Pool ids in
 * the sidecar are updated in place so subsequent iterations of the
 * SAME pass see the consistent state. The next tick's
 * `detectPools` will rebuild from the bitmap regardless.
 */
function liftAirBubbles(
    bitmap: ChunkedBitmap,
    pool: FluidPool,
    poolIds: Uint16Array,
    materials: MaterialRegistry,
): void {
    if (pool.airCells.size === 0) return;
    const W = bitmap.width;
    const masses = bitmap._getMassArrayUnchecked();

    // Process top-first so a contiguous vertical bubble rises as a
    // unit. Each iteration swaps with the cell directly above.
    const sorted = [...pool.airCells].sort((a, b) => a - b);

    for (const idx of sorted) {
        const y = (idx / W) | 0;
        if (y === 0) continue;
        const x = idx - y * W;
        // v3.1.21: distribute may have already overwritten this
        // bubble cell with fluid (when the pool's distribute pass
        // relocated the bubble to the top of the pool footprint).
        // Skip the lift in that case so we don't double-move the
        // bubble or stamp an extra air cell on its old neighbor.
        if (bitmap._readIdUnchecked(x, y) !== 0) continue;
        const upIdx = idx - W;
        if (poolIds[upIdx] !== pool.id) continue;
        const upId = bitmap._readIdUnchecked(x, y - 1);
        if (upId === 0) continue;
        // Only lift when the up cell is HEAVIER than air. Gas (rank 0)
        // is lighter than air (rank 1) — air below gas is the correct
        // density layering, swapping them sinks the gas. Water and oil
        // are heavier; air bubbles below them rise normally.
        const upMat = materials.get(upId);
        if (upMat === undefined) continue;
        const upRank = fluidRank(upMat.simulation ?? 'static');
        if (upRank <= 1) continue; // 1 = air rank; gas at 0 is lighter
        const upMass = masses[upIdx]!;
        // Swap. Up cell: fluid → air (id 0, mass 0).
        // This cell: air → fluid (with the up cell's id and mass).
        // poolIds for both cells stay at pool.id — the swap exchanges
        // fluid/bubble roles within the same pool. Per-cell loop's
        // `isPoolInterior` correctly treats both cells as pool members
        // (the air bubble + fluid neighbors share the pool tag), so
        // adjacent water cells stay interior and skip stepLiquid,
        // preventing them from filling the new bubble position via
        // lateral / vertical donation.
        bitmap._writeIdUnchecked(x, y - 1, 0);
        masses[upIdx] = 0;
        bitmap._markCellChanged(x, y - 1, true);
        bitmap._writeIdUnchecked(x, y, upId);
        masses[idx] = upMass;
        bitmap._markCellChanged(x, y, true);
    }
}

/**
 * Public entry point invoked by the cellular automaton step. Runs
 * the bubble-rise pass for every detected pool. Callers pass the
 * current `poolIds` sidecar (already populated by `detectPools`).
 */
export function liftAirBubblesAll(
    bitmap: ChunkedBitmap,
    pools: Map<number, FluidPool>,
    materials: MaterialRegistry,
): void {
    const poolIds = bitmap._getPoolIdsUnchecked();
    for (const pool of pools.values()) {
        liftAirBubbles(bitmap, pool, poolIds, materials);
    }
}

/**
 * Lifts each gas cell in `pool` one row by swapping with the air
 * cell directly above (v3.1.28). Mirror of `liftAirBubbles`: where
 * an enclosed air bubble inside water rises one row per tick by
 * swapping with the heavier fluid above, a gas cell at the
 * boundary of its pool rises by swapping with the lighter (air)
 * neighbor above. Together with the unified-pool sort that places
 * gas at the top of any mixed pool, this makes a gas blob
 * translate as a single unit through open air rather than smearing
 * upward via per-cell `stepLiquid` (which processes cells y-desc
 * and would distort the pool's shape).
 *
 * Cells are sorted by index ascending (= y first, x within row),
 * so a contiguous gas pool rises as a unit: the topmost gas cells
 * swap with the air above first, and the cascade fills the
 * just-vacated cells with the gas cells from below.
 *
 * Stops at any non-air up-neighbor (stone lid, heavier fluid,
 * world edge) — that column doesn't lift this tick.
 */
function liftGasPool(
    bitmap: ChunkedBitmap,
    pool: FluidPool,
    poolIds: Uint16Array,
    materials: MaterialRegistry,
): void {
    const W = bitmap.width;
    const masses = bitmap._getMassArrayUnchecked();

    // Collect gas cells in this pool in idx-ascending order so the
    // top-of-column lifts first and the next cell down can rise
    // into the just-vacated slot.
    const gasCells: number[] = [];
    for (const idx of pool.cells) {
        const cy = (idx / W) | 0;
        const cx = idx - cy * W;
        const id = bitmap._readIdUnchecked(cx, cy);
        if (id === 0) continue;
        const mat = materials.get(id);
        if (mat?.simulation !== 'gas') continue;
        gasCells.push(idx);
    }
    if (gasCells.length === 0) return;
    gasCells.sort((a, b) => a - b);

    // Helper: can `(tx, ty)` accept a swap from a gas cell?
    // True for air (id=0) or any non-static, non-same-gas fluid.
    const canSwapInto = (tx: number, ty: number, gasId: number): boolean => {
        if (tx < 0 || tx >= W || ty < 0) return false;
        const tid = bitmap._readIdUnchecked(tx, ty);
        if (tid === gasId) return false;
        if (tid === 0) return true;
        const tmat = materials.get(tid);
        if (tmat === undefined) return false;
        if (tmat.simulation === undefined || tmat.simulation === 'static') return false;
        return true;
    };

    // Helper: do the actual swap of gas at `(x, y)` with the cell
    // at `(tx, ty)`. Tags both cells with the pool id so adjacent
    // fluid cells in the per-cell pass see them as bubble cells
    // and don't laterally donate in (re-unifying the pool would
    // otherwise let `distributePoolMass` undo the lift).
    const swapWith = (x: number, y: number, tx: number, ty: number,
                       idx: number, gasId: number): void => {
        const targetIdx = ty * W + tx;
        const tid = bitmap._readIdUnchecked(tx, ty);
        const gasMass = masses[idx]!;
        const tMass = tid === 0 ? 0 : masses[targetIdx]!;
        bitmap._writeIdUnchecked(tx, ty, gasId);
        masses[targetIdx] = gasMass;
        bitmap._markCellChanged(tx, ty, true);
        bitmap._writeIdUnchecked(x, y, tid);
        masses[idx] = tMass;
        bitmap._markCellChanged(x, y, true);
        poolIds[targetIdx] = pool.id;
        // poolIds[idx] stays at pool.id (kept tagged).
    };

    for (const idx of gasCells) {
        const y = (idx / W) | 0;
        if (y === 0) continue;
        const x = idx - y * W;
        // Cell may have been vacated by a previous swap in this
        // pass (cascade chain). Skip if no longer gas.
        const id = bitmap._readIdUnchecked(x, y);
        if (id === 0) continue;
        // First try straight up.
        if (canSwapInto(x, y - 1, id)) {
            swapWith(x, y, x, y - 1, idx, id);
            continue;
        }
        // v3.1.29: blocked by static / same-gas above. Try diagonal
        // up-left and up-right so the gas can slide around an
        // overhang or angled wall (the demo 09 funnel narrows as
        // gas rises, edge cells would otherwise pin against the
        // angled stone walls indefinitely). Alternate the side
        // tried first by row parity for L/R symmetry.
        const tryLeftFirst = (y & 1) === 0;
        const sides = tryLeftFirst ? [-1, 1] : [1, -1];
        for (const sx of sides) {
            if (canSwapInto(x + sx, y - 1, id)) {
                swapWith(x, y, x + sx, y - 1, idx, id);
                break;
            }
        }
    }
}

/**
 * Public entry point — runs `liftGasPool` for every pool.
 */
export function liftGasPoolsAll(
    bitmap: ChunkedBitmap,
    pools: Map<number, FluidPool>,
    materials: MaterialRegistry,
): void {
    const poolIds = bitmap._getPoolIdsUnchecked();
    for (const pool of pools.values()) {
        liftGasPool(bitmap, pool, poolIds, materials);
    }
}
