import type { Chunk, ChunkedBitmap, Contour, Material } from '../core/index.js';
import type { Box2DAdapter } from './Box2DAdapter.js';
import { chunkToContours } from './ContourExtractor.js';
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
 *  - **Terrain rebuild** — `enqueueChunk(chunk)`. Each dirty chunk has
 *    its solid pixels independently extracted and triangulated; only the
 *    chunk's own static body is rebuilt. Chunks not in the dirty set are
 *    untouched, so contacts between dynamic bodies and other chunks'
 *    static bodies survive across the carve. The chunks' collider dirty
 *    flags are cleared once the rebuild completes (the visual flag is
 *    left for the renderer).
 *  - **Debris bodies** — `enqueueDebris(contour, material)`. On flush,
 *    every queued debris is converted into a dynamic body via
 *    {@link Box2DAdapter.createDebrisBody}. Debris is event-driven and
 *    is processed unconditionally — debris that misses its creation
 *    frame would visibly pop in.
 *
 * Per-chunk colliders
 * --------------------
 * Each chunk owns its own static body, made of triangulated polygons
 * extracted from just that chunk's pixels. Chunk-boundary edges are
 * handled correctly by two-sided polygon collision: adjacent chunks each
 * carry a polygon whose edge sits on the boundary, and the combined
 * mass acts as one solid for any body sitting on top. The cross-chunk
 * stitching from Phase 2.5 is no longer required and the global
 * flood-fill rebuild was retired with this model.
 *
 * Why per-chunk over per-blob: a per-blob model rebuilt the entire
 * blob's body on every carve, destroying every contact bound to it and
 * waking every dynamic body resting on the blob — including bodies
 * nowhere near the carve. With per-chunk colliders the blast radius of
 * a carve is the dirty chunks only, so a settled body on a distant
 * chunk doesn't see its underlying static body change at all.
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

    private rebuildTerrain(
        adapter: Box2DAdapter,
        onChunkRebuilt?: (chunk: Chunk) => void,
    ): void {
        // Iterate dirty chunks in (cy, cx) order so the onChunkRebuilt
        // callback fires deterministically (eases replay debugging) and
        // so unit tests can assert on the order.
        const dirtySorted = [...this.dirtyChunks].sort((a, b) => {
            if (a.cy !== b.cy) return a.cy - b.cy;
            return a.cx - b.cx;
        });

        // Snapshot dynamic bodies in the AABB *of the dirty chunks only*.
        // Bodies on chunks not being rebuilt have their static bodies
        // (and the contacts on them) preserved across this flush, so
        // they don't need snapshot/restore — and skipping them avoids
        // the round-trip overhead and keeps Box2D's internal awake-set
        // bookkeeping clean for those bodies.
        const cs = this.bitmap.chunkSize;
        let aabbMinX = Number.POSITIVE_INFINITY;
        let aabbMinY = Number.POSITIVE_INFINITY;
        let aabbMaxX = Number.NEGATIVE_INFINITY;
        let aabbMaxY = Number.NEGATIVE_INFINITY;
        for (const chunk of dirtySorted) {
            const x0 = chunk.cx * cs;
            const y0 = chunk.cy * cs;
            if (x0 < aabbMinX) aabbMinX = x0;
            if (y0 < aabbMinY) aabbMinY = y0;
            if (x0 + cs > aabbMaxX) aabbMaxX = x0 + cs;
            if (y0 + cs > aabbMaxY) aabbMaxY = y0 + cs;
        }
        const snapshots = dirtySorted.length === 0
            ? []
            : adapter.snapshotDynamicBodies({
                minX: aabbMinX,
                minY: aabbMinY,
                maxX: aabbMaxX,
                maxY: aabbMaxY,
            });

        // For each dirty chunk, extract its own contours independently
        // and rebuild its body if and only if the new contour set
        // differs from the cached one. Chunks not in the dirty set are
        // not touched at all.
        for (const chunk of dirtySorted) {
            const contours = chunkToContours(
                chunk,
                this.bitmap,
                this.simplificationEpsilon,
            );

            if (contoursEqual(chunk.contours, contours)) {
                // Defensive: the chunk's body might have been destroyed
                // by an earlier path (e.g. dispose); but if contours are
                // unchanged we don't touch it here.
                continue;
            }

            if (contours.length === 0) {
                // Chunk became all-air. Drop its body and clear cache.
                adapter.destroyChunk(chunk);
                chunk.contours = null;
            } else {
                adapter.rebuildChunk(chunk, contours);
                chunk.contours = contours;
            }
            onChunkRebuilt?.(chunk);
        }

        // Clear dirty flags on the chunks we touched. Other chunks are
        // left alone (their `dirty` flag is false anyway since they were
        // never enqueued).
        for (const chunk of dirtySorted) {
            this.bitmap.clearDirty(chunk);
        }
        this.dirtyChunks.clear();

        // Restore dynamic-body state we snapshotted before the rebuild.
        // Rebuilds destroy contacts and wake their bodies; restoring
        // (transform, velocity, awake) puts sleeping bodies back to
        // sleep and preserves the motion of awake ones.
        adapter.restoreDynamicBodies(snapshots);
    }
}

/**
 * Bit-equality on a contour list. Used to skip a chunk's collider
 * rebuild when its outline hasn't changed across frames — see
 * {@link DeferredRebuildQueue#rebuildTerrain}.
 *
 * Both list ordering and per-vertex coordinates must match exactly.
 * `chunkToContours` is deterministic (it builds a temp bitmap and
 * runs marching squares + DP with fixed parameters), so two
 * extractions of the same chunk produce bit-identical results.
 */
function contoursEqual(
    a: readonly Contour[] | null,
    b: readonly Contour[],
): boolean {
    if (a === null) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        const ai = a[i]!;
        const bi = b[i]!;
        if (ai.closed !== bi.closed) return false;
        if (ai.points.length !== bi.points.length) return false;
        for (let j = 0; j < ai.points.length; j++) {
            const ap = ai.points[j]!;
            const bp = bi.points[j]!;
            if (ap.x !== bp.x || ap.y !== bp.y) return false;
        }
    }
    return true;
}
