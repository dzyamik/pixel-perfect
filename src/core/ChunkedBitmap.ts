import { MaterialRegistry } from './Materials.js';
import type { Chunk, Material, Point } from './types.js';

/**
 * Construction options for {@link ChunkedBitmap}.
 *
 * `chunkSize` must divide both `width` and `height` evenly; ragged edge
 * chunks are not supported in v1.
 */
export interface ChunkedBitmapOptions {
    /** World width in pixels. Must be a positive integer divisible by `chunkSize`. */
    width: number;
    /** World height in pixels. Must be a positive integer divisible by `chunkSize`. */
    height: number;
    /** Edge length of each square chunk in pixels. Must be a positive integer. */
    chunkSize: number;
    /** Optional initial materials to populate the registry with. */
    materials?: readonly Material[];
}

/**
 * The world bitmap, partitioned into fixed-size square chunks.
 *
 * `ChunkedBitmap` is the source of truth for terrain state. Every cell
 * stores a single material id (`0` = air, `1..255` = registered material).
 * Mutations dirty the owning chunk; consumers (renderers, physics adapter)
 * walk dirty chunks at end-of-frame to project the bitmap into colliders
 * and textures.
 *
 * The bitmap is dependency-free and framework-agnostic; it can be used
 * outside Phaser (e.g. with PixiJS or in a headless tool chain).
 */
export class ChunkedBitmap {
    /** World width in pixels. */
    readonly width: number;
    /** World height in pixels. */
    readonly height: number;
    /** Edge length of each chunk in pixels. */
    readonly chunkSize: number;
    /** Number of chunks along the X axis. */
    readonly chunksX: number;
    /** Number of chunks along the Y axis. */
    readonly chunksY: number;
    /** Material registry shared with this bitmap. */
    readonly materials: MaterialRegistry;
    /** Row-major chunk grid: `chunks[cy * chunksX + cx]`. */
    readonly chunks: readonly Chunk[];

    /**
     * Per-cell counter used by the cellular-automaton step for
     * features that need state across ticks — e.g. how long a sand
     * cell has been at rest before promoting to a static "settled"
     * material, or how long a fire cell has been burning before
     * dying out.
     *
     * Lazy-allocated on first access (zero-initialized
     * `Uint8Array(width * height)`). Auto-reset to 0 by `setPixel`
     * because the cell's content just changed; whatever timer was
     * being tracked for the previous occupant is no longer
     * meaningful for the new one. Caps at 255 (Uint8Array max);
     * thresholds above 255 saturate.
     */
    private _cellTimers: Uint8Array | null = null;

    /**
     * Sparse set of cells that the cellular-automaton step should
     * visit on its next call (encoded as `y * width + x`).
     *
     * Lazy-allocated when {@link enableActiveCellTracking} or the
     * {@link activeCells} getter is first invoked. Once initialized,
     * every {@link setPixel} mutation auto-adds the changed cell and
     * its 8 neighbors so external carve / deposit / paint ops AND
     * the sim's own swap-mutations keep activation propagating
     * organically. Cells that didn't move and have no ongoing state
     * (timers, fire) drop out next tick and don't return until a
     * neighbor's mutation re-activates them.
     */
    private _activeCells: Set<number> | null = null;

    /**
     * Per-cell horizontal-flow memory used by the cellular-automaton
     * step (v2.7.6). Each entry stores the **x coordinate** the
     * current occupant came from on its last horizontal flow
     * move, or `0xFFFF` if the cell has no recent move history.
     *
     * The sim consults this when scanning for a flow target — if
     * the prospective target equals the source's `flowSource`
     * value, the move would just undo the previous move, which is
     * the exact pattern that produced 2-tick oscillations
     * pre-v2.7.6. Skipping such targets allows the v2.6.2
     * same-rank-beyond guard to be removed entirely, which in
     * turn lets surface cells compact across air gaps.
     *
     * Lazy-allocated as `Uint16Array(width * height)` filled with
     * `0xFFFF`. `setPixel` resets the cell's entry to `0xFFFF`
     * because the cell's content (and therefore its move history)
     * just changed.
     */
    private _horizFlowSource: Uint16Array | null = null;

    /**
     * Per-cell mass storage for the v3 mass-based fluid simulation.
     *
     * Lazy-allocated as `Float32Array(width * height)`. Once
     * allocated, the value at `[y * width + x]` is the mass of
     * the current cell:
     *
     *  - **`0`** for air (id `0`).
     *  - **`1.0`** for full cells of any registered material. This
     *    is what {@link setPixel} writes; existing v2.x callers
     *    therefore see no behavior change.
     *  - **`0..MAX_MASS + MAX_COMPRESS`** for fluid cells under
     *    the v3 stable-split rules. Above-`MAX_MASS` values come
     *    from compression at the bottom of a tall column; the
     *    overflow drives lateral and upward redistribution.
     *
     * Static / sand / fire materials always have mass `1.0`
     * (they're binary). Only `'water' | 'oil' | 'gas'` produce
     * fractional masses through the cellular-automaton step.
     *
     * @see docs-dev/06-v3-mass-based-fluid.md
     */
    private _masses: Float32Array | null = null;

    /**
     * Per-cell pool-id sidecar used by the v3.1 connected-
     * component pool sim. Each entry holds the id of the
     * `FluidPool` the cell belongs to, or `0xFFFF` (no pool)
     * for cells that aren't part of any pool — air, static,
     * sand, and fire.
     *
     * Lazy-allocated as `Uint16Array(width × height)` filled
     * with `0xFFFF`. Pool detection writes to it; the sim's
     * step rebuilds the contents at the start of each tick in
     * phase 1 (or maintains incrementally in phase 3).
     */
    private _poolIds: Uint16Array | null = null;

    /**
     * @throws If width/height/chunkSize are not positive integers, or if
     *         chunkSize does not divide width and height evenly.
     */
    constructor(options: ChunkedBitmapOptions) {
        const { width, height, chunkSize } = options;

        if (!Number.isInteger(width) || width <= 0) {
            throw new RangeError(`width must be a positive integer; got ${width}`);
        }
        if (!Number.isInteger(height) || height <= 0) {
            throw new RangeError(`height must be a positive integer; got ${height}`);
        }
        if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
            throw new RangeError(`chunkSize must be a positive integer; got ${chunkSize}`);
        }
        if (width % chunkSize !== 0 || height % chunkSize !== 0) {
            throw new RangeError(
                `chunkSize ${chunkSize} must divide both width (${width}) and height (${height})`,
            );
        }

        this.width = width;
        this.height = height;
        this.chunkSize = chunkSize;
        this.chunksX = width / chunkSize;
        this.chunksY = height / chunkSize;
        this.materials = new MaterialRegistry(options.materials ?? []);

        const chunks: Chunk[] = [];
        const cellsPerChunk = chunkSize * chunkSize;
        for (let cy = 0; cy < this.chunksY; cy++) {
            for (let cx = 0; cx < this.chunksX; cx++) {
                chunks.push({
                    cx,
                    cy,
                    bitmap: new Uint8Array(cellsPerChunk),
                    dirty: false,
                    visualDirty: false,
                    contours: null,
                });
            }
        }
        this.chunks = chunks;
    }

    /**
     * Returns the chunk at the given chunk-grid coordinates.
     *
     * @throws If `cx` or `cy` is outside `[0, chunksX)` or `[0, chunksY)`.
     */
    getChunk(cx: number, cy: number): Chunk {
        if (cx < 0 || cx >= this.chunksX || cy < 0 || cy >= this.chunksY) {
            throw new RangeError(
                `Chunk coords (${cx}, ${cy}) out of range; ` +
                    `valid: 0..${this.chunksX - 1}, 0..${this.chunksY - 1}`,
            );
        }
        // Safe: bounds-checked above. Constructor populates every slot.
        return this.chunks[cy * this.chunksX + cx]!;
    }

    /**
     * Reads a cell. Returns `0` for any out-of-bounds coordinate, treating
     * outside-the-world as air. This simplifies neighbor sampling at world
     * edges in algorithms like marching squares.
     */
    getPixel(x: number, y: number): number {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return 0;
        }
        const cs = this.chunkSize;
        const cx = (x / cs) | 0;
        const cy = (y / cs) | 0;
        const lx = x - cx * cs;
        const ly = y - cy * cs;
        const chunk = this.chunks[cy * this.chunksX + cx]!;
        return chunk.bitmap[ly * cs + lx]!;
    }

    /**
     * Writes a cell.
     *
     * - Throws if `(x, y)` is outside the bitmap. Carve / deposit ops are
     *   responsible for clipping their footprint before calling.
     * - Throws if `materialId` is not an integer in `0..255`.
     * - No-ops (does not mark dirty) when the new value equals the current.
     *
     * On any real change, marks the owning chunk's `dirty` and `visualDirty`
     * flags. This is the single mutation primitive that satisfies CLAUDE.md
     * hard rule #5.
     */
    setPixel(x: number, y: number, materialId: number): void {
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new RangeError(`setPixel coordinates must be integers; got (${x}, ${y})`);
        }
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            throw new RangeError(
                `setPixel coords (${x}, ${y}) out of bounds (${this.width} x ${this.height})`,
            );
        }
        if (!Number.isInteger(materialId) || materialId < 0 || materialId > 255) {
            throw new RangeError(`materialId must be an integer in 0..255; got ${materialId}`);
        }

        const cs = this.chunkSize;
        const cx = (x / cs) | 0;
        const cy = (y / cs) | 0;
        const lx = x - cx * cs;
        const ly = y - cy * cs;
        const chunk = this.chunks[cy * this.chunksX + cx]!;
        const index = ly * cs + lx;
        if (chunk.bitmap[index] === materialId) {
            return;
        }
        // Only set `chunk.dirty` (the static-collider rebuild
        // flag) when the change MIGHT affect the static-cell mask
        // — i.e. either the previous or new material is static
        // (or unknown, treated as static). Pure fluid-fluid or
        // fluid-air transitions skip the rebuild path entirely
        // (`chunkToContours` filters to static anyway, but the
        // marching-squares scan over the chunk costs real time
        // when many chunks are dirty per frame).
        const oldStatic = this._isStaticOrUnknown(chunk.bitmap[index]!);
        const newStatic = this._isStaticOrUnknown(materialId);
        chunk.bitmap[index] = materialId;
        chunk.visualDirty = true;
        if (oldStatic || newStatic) {
            chunk.dirty = true;
        }
        const flatIdx = y * this.width + x;
        // Cell content changed — any per-cell timer (rest counter,
        // burn timer, etc.) tracked for the previous occupant is no
        // longer meaningful for the new one. Reset.
        if (this._cellTimers !== null) {
            this._cellTimers[flatIdx] = 0;
        }
        // Same reasoning for the v2.7.6 horizontal-flow memory:
        // the move-from-where history belonged to the previous
        // occupant, not the new one. Reset to the no-history
        // sentinel.
        if (this._horizFlowSource !== null) {
            this._horizFlowSource[flatIdx] = 0xFFFF;
        }
        // v3 mass storage: a fresh `setPixel` produces a full cell
        // (mass = 1.0) for any registered material id, or an empty
        // cell (mass = 0) for air. The mass-based sim then nudges
        // the value toward the stable-split equilibrium each tick.
        // Backwards compatible: v2.x callers writing only the
        // material id see no behavior change.
        if (this._masses !== null) {
            this._masses[flatIdx] = materialId === 0 ? 0 : 1.0;
        }
        // Once active-cell tracking is on, propagate activation to
        // the changed cell + its 8-neighborhood so the sim picks up
        // anything that might want to fall, flow, ignite, or settle
        // because of this change. No-op until the sim has called
        // `enableActiveCellTracking`, so non-fluid users pay nothing.
        if (this._activeCells !== null) {
            this._touchActiveNeighborhood(x, y);
        }
    }

    /**
     * Reads the mass of the cell at `(x, y)`.
     *
     * For binary cells (air, static, sand, fire) returns `0` for
     * air and `1` for any registered material — same as
     * `getPixel(x, y) === 0 ? 0 : 1`. For mass-tracked fluid
     * cells (water, oil, gas under the v3 rules) returns the
     * actual stored mass, which can be `0..MAX_MASS + MAX_COMPRESS`.
     *
     * Out-of-bounds returns `0` (treats outside-the-world as
     * air-equivalent), matching {@link getPixel}'s behavior.
     */
    getMass(x: number, y: number): number {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            return 0;
        }
        if (this._masses !== null) {
            return this._masses[y * this.width + x]!;
        }
        return this.getPixel(x, y) === 0 ? 0 : 1.0;
    }

    /**
     * Returns `true` if the cell with the given material id should
     * trigger a static-collider rebuild on change. Air (`0`)
     * counts as "yes" because air-to-stone (or stone-to-air)
     * transitions definitely affect the contour. Static and
     * unknown materials count as "yes." Fluid materials count as
     * "no" — they never appear in the static contour mask, so
     * fluid-only mutations skip the rebuild path.
     */
    private _isStaticOrUnknown(materialId: number): boolean {
        if (materialId === 0) return true;
        const m = this.materials.get(materialId);
        if (m === undefined) return true;
        const sim = m.simulation;
        return sim === undefined || sim === 'static';
    }

    /**
     * Internal fast-path used by `CellularAutomaton.stepLiquid`.
     * Returns the underlying mass array (allocating + seeding it
     * on first use). Callers MUST treat the array read-only for
     * cells they don't own and MUST call {@link _markCellChanged}
     * after writing so chunk dirty / active-cell tracking stay
     * consistent.
     *
     * Bypasses the validation overhead of {@link setMass}; safe
     * only inside the well-behaved sim loop. Public users should
     * stick to {@link getMass} / {@link setMass}.
     */
    _getMassArrayUnchecked(): Float32Array {
        if (this._masses === null) this._initMassArray();
        return this._masses!;
    }

    /**
     * Internal fast-path: returns the per-cell pool-id sidecar
     * (`Uint16Array(width × height)`), allocating it lazily on
     * first access and filling with the `NO_POOL = 0xFFFF`
     * sentinel. Used by the v3.1 pool-detection step in
     * `CellularAutomaton`. Public callers don't have a use for
     * this — it's pool-id tracking, not material id.
     */
    _getPoolIdsUnchecked(): Uint16Array {
        if (this._poolIds === null) {
            const arr = new Uint16Array(this.width * this.height);
            arr.fill(0xFFFF);
            this._poolIds = arr;
        }
        return this._poolIds;
    }

    /**
     * Internal fast-path companion to {@link _getMassArrayUnchecked}.
     * Marks the chunk owning `(x, y)` visually dirty and adds the
     * cell to the active set if active-cell tracking is on.
     * Skips the 8-neighbor mark — pass `idChanged: true` only
     * when the cell's material id transitions (air ↔ fluid),
     * which warrants neighbor wake-up. For mass-only changes,
     * leave it `false`.
     *
     * Critically, **does NOT set `chunk.dirty`** (the collider-
     * rebuild flag). Only static-material id changes affect the
     * static contour, and those always go through {@link setPixel}.
     * Fluid mass changes / fluid id transitions only need a
     * visual repaint.
     *
     * Bypasses bounds checks; caller guarantees `(x, y)` is in
     * range.
     */
    _markCellChanged(x: number, y: number, idChanged: boolean): void {
        const cs = this.chunkSize;
        const cx = (x / cs) | 0;
        const cy = (y / cs) | 0;
        const chunk = this.chunks[cy * this.chunksX + cx]!;
        chunk.visualDirty = true;
        if (this._activeCells !== null) {
            if (idChanged) {
                this._touchActiveNeighborhood(x, y);
            } else {
                this._activeCells.add(y * this.width + x);
            }
        }
    }

    /**
     * Internal fast-path id writer for the sim. Writes
     * `materialId` to the bitmap cell at `(x, y)` and resets the
     * cell's per-cell timer + horizontal-flow source memory.
     * Skips bounds + integer validation, the no-op-on-same-id
     * check, and the active-set / dirty-chunk bookkeeping —
     * caller is responsible for following up with
     * {@link _markCellChanged}.
     *
     * Use only inside the sim hot path. Public callers use
     * {@link setPixel}.
     */
    _writeIdUnchecked(x: number, y: number, materialId: number): void {
        const cs = this.chunkSize;
        const cx = (x / cs) | 0;
        const cy = (y / cs) | 0;
        const lx = x - cx * cs;
        const ly = y - cy * cs;
        const chunk = this.chunks[cy * this.chunksX + cx]!;
        chunk.bitmap[ly * cs + lx] = materialId;
        const flatIdx = y * this.width + x;
        if (this._cellTimers !== null) this._cellTimers[flatIdx] = 0;
        if (this._horizFlowSource !== null) this._horizFlowSource[flatIdx] = 0xFFFF;
    }

    /**
     * Internal fast-path id reader for the sim. Reads the
     * material id at `(x, y)`. Skips out-of-bounds checks (the
     * caller must clamp / break first).
     */
    _readIdUnchecked(x: number, y: number): number {
        const cs = this.chunkSize;
        const cx = (x / cs) | 0;
        const cy = (y / cs) | 0;
        const lx = x - cx * cs;
        const ly = y - cy * cs;
        const chunk = this.chunks[cy * this.chunksX + cx]!;
        return chunk.bitmap[ly * cs + lx]!;
    }

    /**
     * Lazy-allocates `_masses` as `Float32Array(width × height)`
     * and seeds it: every cell with a registered material id
     * (`getPixel(x, y) !== 0`) gets `mass = 1.0`; air cells stay
     * at `0`. Idempotent — guarded by the null check at the call
     * sites. Without the seed, the first mass mutation would zero
     * out the implicit `1.0` of every other cell.
     */
    private _initMassArray(): void {
        const masses = new Float32Array(this.width * this.height);
        const W = this.width;
        const H = this.height;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (this.getPixel(x, y) !== 0) masses[y * W + x] = 1.0;
            }
        }
        this._masses = masses;
    }

    /**
     * Writes the mass for the cell at `(x, y)`. The cell's material
     * id is updated as a side effect:
     *
     *  - If `mass <= 0`, the cell becomes air (`id = 0`).
     *  - If `mass > 0`, the cell keeps its current id (or, if the
     *    cell was previously air, takes the id from the optional
     *    `idIfAir` argument).
     *
     * Lazy-allocates the mass array on first call. Marks the
     * owning chunk dirty and propagates active-cell activation
     * (same as `setPixel`).
     *
     * Used by `CellularAutomaton.step`'s mass-transfer rules; not
     * typically called by application code.
     *
     * @throws If `(x, y)` is out of bounds, or if `mass` is not
     *         finite.
     */
    setMass(x: number, y: number, mass: number, idIfAir = 0): void {
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
            throw new RangeError(`setMass coordinates must be integers; got (${x}, ${y})`);
        }
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            throw new RangeError(
                `setMass coords (${x}, ${y}) out of bounds (${this.width} x ${this.height})`,
            );
        }
        if (!Number.isFinite(mass)) {
            throw new RangeError(`mass must be a finite number; got ${mass}`);
        }
        const flatIdx = y * this.width + x;
        // Lazy-init the mass array, seeding all current non-air
        // cells to `1.0` so existing v2.x bitmaps "switch on" to
        // mass tracking with the same effective state. Without
        // this seed, cells that were placed via `setPixel` before
        // any mass operation would silently default to mass 0
        // (Float32Array zero-init), causing mass loss.
        if (this._masses === null) {
            this._initMassArray();
        }
        const masses = this._masses!;
        const currentId = this.getPixel(x, y);
        if (mass <= 0) {
            masses[flatIdx] = 0;
            if (currentId !== 0) {
                this.setPixel(x, y, 0);
                // setPixel just touched everything; mass is now 0 from the
                // setPixel branch above as well. Leave it.
            }
            return;
        }
        const cs = this.chunkSize;
        const cx = (x / cs) | 0;
        const cy = (y / cs) | 0;
        const lx = x - cx * cs;
        const ly = y - cy * cs;
        const chunk = this.chunks[cy * this.chunksX + cx]!;
        const targetId = currentId !== 0 ? currentId : idIfAir;
        const idChanged = targetId !== 0 && currentId !== targetId;
        if (idChanged) {
            chunk.bitmap[ly * cs + lx] = targetId;
        }
        chunk.dirty = true;
        chunk.visualDirty = true;
        masses[flatIdx] = mass;
        if (this._activeCells !== null) {
            // v3.0.3 perf: only mark 8 neighbors when the cell's
            // material id changed (cell appeared, disappeared, or
            // swapped). Mass-only changes mark just the cell
            // itself — those are by far the hot path in v3
            // (`stepLiquid` does ~30 setMass calls per cell per
            // tick), and the cells whose mass changed are
            // already in the active set anyway.
            if (idChanged) {
                this._touchActiveNeighborhood(x, y);
            } else {
                this._activeCells.add(flatIdx);
            }
        }
    }

    /**
     * Adds the 3×3 Moore neighborhood of `(x, y)` to the active-cell
     * set, clipping at world bounds. Caller guarantees
     * `this._activeCells !== null`.
     */
    private _touchActiveNeighborhood(x: number, y: number): void {
        const set = this._activeCells!;
        const W = this.width;
        const H = this.height;
        const xMin = x > 0 ? x - 1 : 0;
        const xMax = x < W - 1 ? x + 1 : W - 1;
        const yMin = y > 0 ? y - 1 : 0;
        const yMax = y < H - 1 ? y + 1 : H - 1;
        for (let yy = yMin; yy <= yMax; yy++) {
            const rowBase = yy * W;
            for (let xx = xMin; xx <= xMax; xx++) {
                set.add(rowBase + xx);
            }
        }
    }

    /**
     * Lazy-allocated `Uint8Array(width * height)` of per-cell counters
     * used by `CellularAutomaton.step` for features that need state
     * across ticks (sand-rest counter, fire-burn timer, etc.).
     *
     * On first read, the array is zero-initialized. Subsequent reads
     * return the same instance. `setPixel` auto-resets the cell's
     * timer to 0 because the cell's content just changed; the
     * cellular-automaton step manages increments and threshold checks
     * on cells that didn't move this tick.
     *
     * Caps at 255 per cell (Uint8Array max); threshold checks above
     * 255 saturate.
     */
    get cellTimers(): Uint8Array {
        if (this._cellTimers === null) {
            this._cellTimers = new Uint8Array(this.width * this.height);
        }
        return this._cellTimers;
    }

    /**
     * Lazy-allocated `Uint16Array(width * height)` of per-cell
     * horizontal-flow source-X memory used by the v2.7.6 anti-
     * oscillation rule in `CellularAutomaton.step`. `0xFFFF`
     * means "no recent horizontal move."
     *
     * On first read the array is initialized to all-`0xFFFF`.
     * The sim writes to it after every successful horizontal
     * flow move (`flowSource[targetIdx] = sourceX`); reading
     * back at the next call lets the moved cell skip a flow
     * back to the same source — preventing 2-tick oscillation
     * cycles that would otherwise force a conservative
     * same-rank-beyond guard.
     *
     * `setPixel` resets the cell's entry to `0xFFFF` because the
     * occupant changed.
     */
    get horizFlowSource(): Uint16Array {
        if (this._horizFlowSource === null) {
            this._horizFlowSource = new Uint16Array(this.width * this.height);
            this._horizFlowSource.fill(0xFFFF);
        }
        return this._horizFlowSource;
    }

    /**
     * Sparse set of cell indices (`y * width + x`) the cellular-
     * automaton step should visit on its next call.
     *
     * Lazy-allocated on first access. Once it exists, every
     * {@link setPixel} mutation auto-marks the changed cell and its
     * 8 neighbors. The sim consumes this set at the start of each
     * `step` (snapshot + clear), then the same set fills back up
     * during processing via `setPixel` calls and explicit
     * {@link markActive} calls for cells with ongoing state (fire
     * timers, settling sand counters).
     */
    get activeCells(): Set<number> {
        if (this._activeCells === null) {
            this._activeCells = new Set<number>();
        }
        return this._activeCells;
    }

    /**
     * Whether active-cell tracking has been initialized on this
     * bitmap. Used by sim helpers that want to peek without lazy-
     * initializing the set.
     */
    get hasActiveCellTracking(): boolean {
        return this._activeCells !== null;
    }

    /**
     * Idempotent. Initializes the active-cell set and seeds it with
     * every non-air, non-static cell currently in the bitmap so the
     * sim can pick up cells that were placed before tracking turned
     * on. The first `CellularAutomaton.step` call invokes this; you
     * can also call it eagerly if you need the auto-mark side-effect
     * on `setPixel` before the first step runs.
     */
    enableActiveCellTracking(): void {
        if (this._activeCells !== null) return;
        const set = new Set<number>();
        this._activeCells = set;
        const W = this.width;
        const H = this.height;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const id = this.getPixel(x, y);
                if (id === 0) continue;
                const m = this.materials.get(id);
                if (m === undefined) continue;
                const sim = m.simulation;
                if (sim === undefined || sim === 'static') continue;
                set.add(y * W + x);
            }
        }
    }

    /**
     * Adds `(x, y)` to the active-cell set so the next `step` will
     * visit it. Used by the cellular automaton to keep cells with
     * ongoing state (fire timer ticking, sand rest counter
     * incrementing) in the rotation when `setPixel` wasn't called.
     *
     * No-op when active-cell tracking hasn't been initialized
     * (callers in the sim run after `enableActiveCellTracking` so
     * the guard is conservative). Out-of-bounds coordinates are
     * silently ignored.
     */
    markActive(x: number, y: number): void {
        if (this._activeCells === null) return;
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
        this._activeCells.add(y * this.width + x);
    }

    /**
     * Maps a world coordinate to the enclosing chunk's grid coordinates.
     * Does not validate the input is within the world; callers in the
     * algorithm layer may need to query out-of-bounds positions.
     */
    worldToChunk(x: number, y: number): { cx: number; cy: number } {
        return {
            cx: Math.floor(x / this.chunkSize),
            cy: Math.floor(y / this.chunkSize),
        };
    }

    /**
     * Maps a world coordinate to chunk-local pixel coordinates within the
     * enclosing chunk.
     */
    worldToChunkLocal(x: number, y: number): Point {
        return {
            x: ((x % this.chunkSize) + this.chunkSize) % this.chunkSize,
            y: ((y % this.chunkSize) + this.chunkSize) % this.chunkSize,
        };
    }

    /**
     * Visits every currently-dirty chunk in stable row-major (cy, cx) order.
     *
     * The callback may not mutate the dirty flag during iteration (call
     * `clearDirty` afterwards). Iteration order is fixed so consumers
     * (Box2D rebuild, GPU upload) see a deterministic sequence — useful
     * for replay debugging and best-effort determinism (architecture doc
     * § Determinism).
     */
    forEachDirtyChunk(callback: (chunk: Chunk) => void): void {
        for (let cy = 0; cy < this.chunksY; cy++) {
            for (let cx = 0; cx < this.chunksX; cx++) {
                const chunk = this.chunks[cy * this.chunksX + cx]!;
                if (chunk.dirty) {
                    callback(chunk);
                }
            }
        }
    }

    /**
     * Clears the collider dirty flag on a chunk. Called by the physics
     * adapter after a successful rebuild. Does not touch `visualDirty`.
     */
    clearDirty(chunk: Chunk): void {
        chunk.dirty = false;
    }

    /**
     * Clears the visual dirty flag on a chunk. Called by the renderer after
     * a successful texture upload. Does not touch `dirty`.
     */
    clearVisualDirty(chunk: Chunk): void {
        chunk.visualDirty = false;
    }
}
