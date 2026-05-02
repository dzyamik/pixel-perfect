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
 * Connected component of same-material fluid cells.
 *
 * Pools are owned by `ChunkedBitmap` and rebuilt (phase 1) or
 * incrementally maintained (phase 3) each tick. They expose
 * the aggregate state that the v3.1 step uses to skip per-cell
 * work in stable bodies of fluid.
 */
export interface FluidPool {
    /** Stable id (the index used in the per-cell sidecar). */
    readonly id: number;
    /** Material id of every cell in this pool. */
    readonly materialId: number;
    /**
     * Cell flat indices (`y * width + x`) belonging to the pool.
     * Use a Set so add / remove are O(1) for incremental
     * maintenance in phase 3.
     */
    readonly cells: Set<number>;
    /**
     * Sum of cell masses across the pool. Updated when cells
     * are added / removed and during the equilibrium pass.
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
 * Distributes the pool's total mass across its cells in a
 * hydrostatic bottom-up fill: bottom rows are saturated to
 * `MAX_POOL_MASS_PER_CELL` first, then upward, with the topmost
 * row possibly partially filled with the remainder. Within a
 * row, mass is uniform.
 *
 * This is the canonical "instant pool flattening" pass in CA
 * fluid sims (W-Shadow / jgallant / Noita lineage): a brush
 * burst that lands on top of a connected pool merges and the
 * pool's surface rises by `mass_added / footprint_width` —
 * matching real-water hydrostatics — within one tick instead of
 * cascading via reach-25 lateral over many ticks.
 *
 * Cells in rows ABOVE the new surface (no mass left after the
 * fill) are demoted to air (mass = 0, id = 0) — otherwise they'd
 * sit at id = fluid with mass = 0, blocking pool re-detection
 * next tick.
 *
 * Caller is responsible for `pool.totalMass` being current
 * (i.e. having just rebuilt the pool via `detectPools`).
 */
export function distributePoolMass(bitmap: ChunkedBitmap, pool: FluidPool): void {
    if (pool.cells.size === 0) return;
    const W = bitmap.width;

    // Group cells by y, then sort y values descending (bottom first).
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
    const ys = [...cellsByY.keys()].sort((a, b) => b - a);

    let remainingMass = pool.totalMass;
    const masses = bitmap._getMassArrayUnchecked();

    for (const y of ys) {
        const rowCells = cellsByY.get(y)!;
        const rowCellCount = rowCells.length;
        const rowCapacity = rowCellCount * MAX_POOL_MASS_PER_CELL;

        if (remainingMass >= rowCapacity) {
            // Row fully saturated.
            for (const idx of rowCells) masses[idx] = MAX_POOL_MASS_PER_CELL;
            remainingMass -= rowCapacity;
        } else if (remainingMass > 0) {
            // Top of fill: row partially filled, uniform within row.
            const perCell = remainingMass / rowCellCount;
            for (const idx of rowCells) masses[idx] = perCell;
            remainingMass = 0;
        } else {
            // Above the new surface — demote to air. Without this,
            // cells would keep id = fluid with mass = 0, and next
            // tick's `detectPools` would re-include them.
            for (const idx of rowCells) {
                masses[idx] = 0;
                const cy = (idx / W) | 0;
                const cx = idx - cy * W;
                bitmap._writeIdUnchecked(cx, cy, 0);
                bitmap._markCellChanged(cx, cy, true);
            }
        }
    }

    // Mass conservation: if every row was saturated and there's
    // still mass left over, distribute the excess as uniform
    // compression on the topmost row (so the pool can hold it
    // without losing mass). Cells render binary so the visible
    // surface is unchanged.
    if (remainingMass > 0 && ys.length > 0) {
        const topY = ys[ys.length - 1]!;
        const topCells = cellsByY.get(topY)!;
        const bonusPerCell = remainingMass / topCells.length;
        for (const idx of topCells) masses[idx] = masses[idx]! + bonusPerCell;
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

    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            const flatIdx = y * W + x;
            if (poolIds[flatIdx] !== NO_POOL) continue;
            const id = bitmap._readIdUnchecked(x, y);
            if (id === 0) continue;
            const mat = materials.get(id);
            if (mat === undefined) continue;
            const sim = mat.simulation;
            if (sim !== 'water' && sim !== 'oil' && sim !== 'gas') continue;

            // Start a new component. Flood-fill to all 4-connected
            // same-id cells.
            const poolId = nextId++;
            const cells = new Set<number>();
            let totalMass = 0;
            stack.length = 0;
            stack.push(flatIdx);
            poolIds[flatIdx] = poolId;
            while (stack.length > 0) {
                const fi = stack.pop()!;
                cells.add(fi);
                totalMass += masses[fi]!;
                const cy = (fi / W) | 0;
                const cx = fi - cy * W;
                // 4-connected neighbors.
                if (cx > 0) {
                    const ni = fi - 1;
                    if (poolIds[ni] === NO_POOL && bitmap._readIdUnchecked(cx - 1, cy) === id) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
                if (cx + 1 < W) {
                    const ni = fi + 1;
                    if (poolIds[ni] === NO_POOL && bitmap._readIdUnchecked(cx + 1, cy) === id) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
                if (cy > 0) {
                    const ni = fi - W;
                    if (poolIds[ni] === NO_POOL && bitmap._readIdUnchecked(cx, cy - 1) === id) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
                if (cy + 1 < H) {
                    const ni = fi + W;
                    if (poolIds[ni] === NO_POOL && bitmap._readIdUnchecked(cx, cy + 1) === id) {
                        poolIds[ni] = poolId;
                        stack.push(ni);
                    }
                }
            }
            out.set(poolId, {
                id: poolId,
                materialId: id,
                cells,
                totalMass,
                dirty: false,
            });
        }
    }

    return out;
}
