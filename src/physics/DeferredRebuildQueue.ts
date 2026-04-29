import { FloodFill } from '../core/index.js';
import type { Chunk, ChunkedBitmap, Contour, Material } from '../core/index.js';
import type { Box2DAdapter } from './Box2DAdapter.js';
import { componentToContours } from './ContourExtractor.js';
import type { BodyId } from './types.js';

/**
 * Constructor options for {@link DeferredRebuildQueue}.
 */
export interface DeferredRebuildQueueOptions {
    /** Bitmap used for marching-squares neighbor sampling during flush. */
    bitmap: ChunkedBitmap;
    /** Douglas-Peucker epsilon (in pixels) applied to each extracted contour. Default 1. */
    simplificationEpsilon?: number;
}

/**
 * Per-flush options.
 */
export interface FlushOptions {
    /**
     * Called with the {@link BodyId}, contour, and material for every
     * debris body the flush creates.
     */
    onDebrisCreated?: (bodyId: BodyId, contour: Contour, material: Material) => void;
    /**
     * Called once per chunk whose terrain body was created or rebuilt
     * by this flush. Useful for debug overlays.
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
 *  - **Terrain rebuild** — `enqueueChunk(chunk)`. The set of dirtied
 *    chunks is just a "do we need to re-mesh terrain at all" signal;
 *    `flush()` does a *global* per-blob rebuild (see below). The
 *    chunks' collider dirty flags are cleared once the rebuild completes
 *    (the visual flag is left for the renderer).
 *  - **Debris bodies** — `enqueueDebris(contour, material)`. On flush,
 *    every queued debris is converted into a dynamic body via
 *    {@link Box2DAdapter.createDebrisBody}. Debris is event-driven and
 *    is processed unconditionally — debris that misses its creation
 *    frame would visibly pop in.
 *
 * Per-blob global rebuild
 * -----------------------
 * Naive per-chunk marching squares produces *open* polylines wherever
 * a contour spans multiple chunks; Box2D's open chain shape needs at
 * least 4 vertices, but cross-chunk fragments simplify to 2–3 after
 * Douglas-Peucker, leaving collider seams. To avoid this, `flush()`
 * uses {@link FloodFill.findAllComponents} to identify every connected
 * solid component, extracts each component's closed contour(s) via the
 * shared {@link componentToContours} helper, and routes each component
 * to a *representative chunk* (the chunk containing the component's
 * lex-smallest cell). The {@link Box2DAdapter}'s `Map<Chunk, BodyId>`
 * then holds at most one entry per representative chunk; chunks that
 * are interior to a blob have no body at all.
 *
 * Trade-off: the global pass is O(W·H) per dirty flush rather than
 * per-chunk. Fine for destruction events that happen a few times per
 * second; if it shows up as a hot path later, the optimization is to
 * confine flood fill + extraction to the dirty chunks' bounding box.
 */
export class DeferredRebuildQueue {
    private readonly bitmap: ChunkedBitmap;
    private readonly simplificationEpsilon: number;

    private readonly dirtyChunks = new Set<Chunk>();
    private readonly pendingDebris: PendingDebris[] = [];

    constructor(options: DeferredRebuildQueueOptions) {
        this.bitmap = options.bitmap;
        this.simplificationEpsilon = options.simplificationEpsilon ?? 1;
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
     * Drains queued work into Box2D. When any chunk is dirty, this runs
     * a full per-blob global rebuild (see class doc). Debris creation is
     * always unbounded.
     */
    flush(adapter: Box2DAdapter, options: FlushOptions = {}): void {
        if (this.dirtyChunks.size > 0) {
            this.rebuildTerrain(adapter, options.onChunkRebuilt);
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

    private rebuildTerrain(adapter: Box2DAdapter, onChunkRebuilt?: (chunk: Chunk) => void): void {
        // Identify every connected solid component in the bitmap, extract
        // its closed contours, and route each component to a deterministic
        // representative chunk (the chunk containing its lex-smallest
        // cell — i.e., the BFS start cell). Multiple components whose
        // first cells fall in the same chunk merge into one body's chain
        // shapes; for static terrain this is harmless.
        const components = FloodFill.findAllComponents(this.bitmap);
        const cs = this.bitmap.chunkSize;
        const newAssignments = new Map<Chunk, Contour[]>();

        for (const component of components) {
            const head = component.cells[0];
            if (head === undefined) continue; // empty component, never happens
            const cx = Math.floor(head.x / cs);
            const cy = Math.floor(head.y / cs);
            const repChunk = this.bitmap.getChunk(cx, cy);
            const contours = componentToContours(
                component,
                this.bitmap,
                this.simplificationEpsilon,
            );
            const accum = newAssignments.get(repChunk) ?? [];
            accum.push(...contours);
            newAssignments.set(repChunk, accum);
        }

        // Destroy every previously-tracked chunk that no longer has an
        // assignment. Snapshot the iterable first because destroyChunk
        // mutates the adapter's internal map. Also clear cached
        // contours so they don't outlive the body.
        const previouslyTracked = [...adapter.trackedChunks()];
        for (const chunk of previouslyTracked) {
            if (!newAssignments.has(chunk)) {
                adapter.destroyChunk(chunk);
                chunk.contours = null;
            }
        }

        // Wipe contour caches on every other chunk too — chunks that
        // were never tracked (interior chunks of a previous blob, or
        // freshly-air chunks) must not retain stale contour data.
        for (const chunk of this.bitmap.chunks) {
            if (!newAssignments.has(chunk)) chunk.contours = null;
        }

        // Rebuild the rep chunks. Sort for deterministic invocation order
        // (eases replay debugging and gives onChunkRebuilt a stable
        // sequence). Also populate chunk.contours so debug renderers
        // and consumers that want to inspect the collider shape can.
        const repsSorted = [...newAssignments.keys()].sort((a, b) => {
            if (a.cy !== b.cy) return a.cy - b.cy;
            return a.cx - b.cx;
        });
        for (const chunk of repsSorted) {
            const contours = newAssignments.get(chunk)!;
            adapter.rebuildChunk(chunk, contours);
            chunk.contours = contours;
            onChunkRebuilt?.(chunk);
        }

        // Clear all dirty flags — every chunk's collider state is now in
        // sync with the bitmap, regardless of which chunks were
        // explicitly enqueued.
        for (const chunk of this.bitmap.chunks) {
            this.bitmap.clearDirty(chunk);
        }
        this.dirtyChunks.clear();
    }
}
