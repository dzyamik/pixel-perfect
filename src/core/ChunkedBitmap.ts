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
        chunk.bitmap[index] = materialId;
        chunk.dirty = true;
        chunk.visualDirty = true;
        // Cell content changed — any per-cell timer (rest counter,
        // burn timer, etc.) tracked for the previous occupant is no
        // longer meaningful for the new one. Reset.
        if (this._cellTimers !== null) {
            this._cellTimers[y * this.width + x] = 0;
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
