import { DouglasPeucker, MarchingSquares } from '../core/index.js';
import type { Chunk, ChunkedBitmap, Contour, Material } from '../core/index.js';
import type { Box2DAdapter } from './Box2DAdapter.js';
import type { BodyId } from './types.js';

/**
 * Constructor options for {@link DeferredRebuildQueue}.
 */
export interface DeferredRebuildQueueOptions {
    /** Bitmap used for marching-squares neighbor sampling during flush. */
    bitmap: ChunkedBitmap;
    /** Douglas-Peucker epsilon (in pixels) applied to each extracted contour. Default 1. */
    simplificationEpsilon?: number;
    /** Default per-frame chunk-rebuild budget. Default 4. */
    defaultPerFrameBudget?: number;
}

/**
 * Per-flush options that override the queue's defaults.
 */
export interface FlushOptions {
    /**
     * Maximum number of chunk rebuilds processed in this flush. The
     * remainder rolls over to the next flush. Defaults to the value
     * supplied at construction (or 4 if unspecified).
     */
    perFrameBudget?: number;
    /**
     * Called with the {@link BodyId}, contour, and material for every
     * debris body the flush creates.
     */
    onDebrisCreated?: (bodyId: BodyId, contour: Contour, material: Material) => void;
    /**
     * Called once per chunk that was rebuilt in this flush. Useful for
     * debug overlays and for triggering visual repaints downstream.
     */
    onChunkRebuilt?: (chunk: Chunk) => void;
}

interface PendingDebris {
    contour: Contour;
    material: Material;
}

/**
 * Single-threaded queue of physics work that is deferred to end-of-frame.
 *
 * Per CLAUDE.md hard rule #3, Box2D body creation and destruction must
 * never happen inside a physics step. The queue exists so that game
 * logic running inside `world.step()` (e.g. carve operations triggered
 * from a contact callback) can mark work without violating the rule;
 * the actual body churn happens later in `flush()`.
 *
 * Two work categories:
 *
 *  - **Chunk rebuilds** — `enqueueChunk(chunk)`. On flush, marching
 *    squares + Douglas-Peucker run on each pending chunk and the result
 *    is handed to {@link Box2DAdapter.rebuildChunk}. The chunk's
 *    `dirty` flag is cleared (the visual flag is left for the renderer).
 *    Bounded by `perFrameBudget` to cap worst-case per-frame cost.
 *  - **Debris bodies** — `enqueueDebris(contour, material)`. On flush,
 *    every queued debris is converted into a dynamic body via
 *    {@link Box2DAdapter.createDebrisBody}. Debris is event-driven and
 *    is processed unconditionally (no budget) — debris that misses its
 *    creation frame would visibly pop in.
 *
 * Drain order for chunks is stable row-major `(cy, cx)`, regardless of
 * insertion order. This matches `ChunkedBitmap.forEachDirtyChunk`'s
 * iteration and keeps best-effort determinism for replay debugging
 * (architecture doc § Determinism).
 */
export class DeferredRebuildQueue {
    private readonly bitmap: ChunkedBitmap;
    private readonly simplificationEpsilon: number;
    private readonly defaultPerFrameBudget: number;

    private readonly dirtyChunks = new Set<Chunk>();
    private readonly pendingDebris: PendingDebris[] = [];

    constructor(options: DeferredRebuildQueueOptions) {
        this.bitmap = options.bitmap;
        this.simplificationEpsilon = options.simplificationEpsilon ?? 1;
        this.defaultPerFrameBudget = options.defaultPerFrameBudget ?? 4;
    }

    /**
     * Marks a chunk for rebuild on the next flush. Re-enqueueing the
     * same chunk before flush is a no-op (deduplicated by Set semantics).
     */
    enqueueChunk(chunk: Chunk): void {
        this.dirtyChunks.add(chunk);
    }

    /**
     * Queues a debris body for creation on the next flush. Debris is
     * always created in flush order (FIFO).
     */
    enqueueDebris(contour: Contour, material: Material): void {
        this.pendingDebris.push({ contour, material });
    }

    /** Number of chunks waiting to be rebuilt. */
    pendingChunkCount(): number {
        return this.dirtyChunks.size;
    }

    /** Number of debris bodies waiting to be created. */
    pendingDebrisCount(): number {
        return this.pendingDebris.length;
    }

    /**
     * Drains queued work into Box2D. Chunk rebuilds are bounded by
     * `perFrameBudget` (default 4); debris creation is unbounded.
     */
    flush(adapter: Box2DAdapter, options: FlushOptions = {}): void {
        const budget = options.perFrameBudget ?? this.defaultPerFrameBudget;

        if (this.dirtyChunks.size > 0 && budget > 0) {
            // Sort chunks into row-major (cy, cx) order. Working from a
            // sorted snapshot ensures stable iteration regardless of
            // insertion order.
            const sorted = [...this.dirtyChunks].sort((a, b) => {
                if (a.cy !== b.cy) return a.cy - b.cy;
                return a.cx - b.cx;
            });

            const limit = Math.min(budget, sorted.length);
            for (let i = 0; i < limit; i++) {
                const chunk = sorted[i]!;
                this.rebuildOne(chunk, adapter);
                options.onChunkRebuilt?.(chunk);
                this.dirtyChunks.delete(chunk);
            }
        }

        if (this.pendingDebris.length > 0) {
            // Snapshot the debris list and clear before iterating; this
            // avoids reentrancy issues if a callback enqueues more work.
            const debris = this.pendingDebris.splice(0, this.pendingDebris.length);
            for (const { contour, material } of debris) {
                const bodyId = adapter.createDebrisBody(contour, material);
                if (bodyId !== null) {
                    options.onDebrisCreated?.(bodyId, contour, material);
                }
            }
        }
    }

    private rebuildOne(chunk: Chunk, adapter: Box2DAdapter): void {
        const raw = MarchingSquares.extract(chunk, this.bitmap);
        const simplified: Contour[] = [];
        for (const c of raw) {
            const s = DouglasPeucker.simplify(c, this.simplificationEpsilon);
            // Drop contours that simplification reduced to a degenerate
            // shape — they cannot form a valid Box2D chain.
            if (s.points.length >= 3 || (!s.closed && s.points.length >= 4)) {
                simplified.push(s);
            }
        }
        adapter.rebuildChunk(chunk, simplified);
        this.bitmap.clearDirty(chunk);
    }
}
