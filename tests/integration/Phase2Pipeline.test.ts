/**
 * End-to-end pipeline: ChunkedBitmap mutation → DebrisDetector →
 * DeferredRebuildQueue → Box2DAdapter → live Box2D world.
 *
 * Validates the Phase 2 DoD from `docs-dev/02-roadmap.md`:
 *
 *   "Can run a headless integration test that destroys a chunk of
 *    terrain and observes correct body lifecycle (old destroyed, new
 *    created, no leaks)."
 *
 * Plus a smaller-scale stress test that verifies body counts don't grow
 * without bound across many destroy/create cycles.
 *
 * Single-chunk scope
 * ------------------
 * Phase 2 produces per-chunk bodies whose chain shapes are extracted
 * within each chunk's 1-pixel-padded sample window. Contours that close
 * locally (small blobs that fit in one chunk + padding) form valid
 * loop chains; contours that span multiple chunks would need explicit
 * cross-chunk stitching, which Phase 2 does not implement. The tests
 * below intentionally use single-chunk worlds so this limitation is
 * not exercised.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Carve, ChunkedBitmap, Deposit } from '../../src/core/index.js';
import type { Material } from '../../src/core/index.js';
import {
    Box2DAdapter,
    DebrisDetector,
    DeferredRebuildQueue,
} from '../../src/physics/index.js';
import {
    b2Body_GetShapeCount,
    b2Body_IsValid,
    b2CreateWorld,
    b2CreateWorldArray,
    b2DefaultWorldDef,
    b2DestroyWorld,
} from '../../src/physics/box2d.js';
import type { BodyId, WorldId } from '../../src/physics/index.js';

const dirt: Material = {
    id: 1,
    name: 'dirt',
    color: 0x8b5a3c,
    density: 1,
    friction: 0.7,
    restitution: 0.1,
    destructible: true,
    destructionResistance: 0,
};

let worldId: WorldId;
let bitmap: ChunkedBitmap;
let adapter: Box2DAdapter;
let queue: DeferredRebuildQueue;

beforeAll(() => {
    b2CreateWorldArray();
});

beforeEach(() => {
    worldId = b2CreateWorld(b2DefaultWorldDef());
    bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 64 });
    adapter = new Box2DAdapter({ worldId, pixelsPerMeter: 32 });
    queue = new DeferredRebuildQueue({ bitmap });
});

afterEach(() => {
    adapter.dispose();
    b2DestroyWorld(worldId);
});

/** Convenience: enqueue every dirty chunk and flush. */
function flushAll() {
    bitmap.forEachDirtyChunk((chunk) => queue.enqueueChunk(chunk));
    queue.flush(adapter, { perFrameBudget: 100 });
}

describe('Phase 2 pipeline — destroy a chunk of terrain', () => {
    it('rebuilds chunk colliders after a carve and destroys old bodies', () => {
        // Solid disk fits in the single chunk's sample window.
        Deposit.circle(bitmap, 32, 32, 20, 1);
        flushAll();

        const chunk = bitmap.getChunk(0, 0);
        const bodyBefore = adapter.getChunkBody(chunk);
        expect(bodyBefore).not.toBeNull();
        expect(b2Body_IsValid(bodyBefore!)).toBe(true);
        const shapesBefore = b2Body_GetShapeCount(bodyBefore!);
        expect(shapesBefore).toBeGreaterThan(0);

        // Carve a hole through the disk → contour now donut-shaped.
        Carve.circle(bitmap, 32, 32, 5);
        flushAll();

        const bodyAfter = adapter.getChunkBody(chunk);
        expect(bodyAfter).not.toBeNull();
        expect(bodyAfter).not.toBe(bodyBefore);
        expect(b2Body_IsValid(bodyBefore!)).toBe(false);
        expect(b2Body_IsValid(bodyAfter!)).toBe(true);
        // Donut produces outer + inner contours → more shapes than before.
        expect(b2Body_GetShapeCount(bodyAfter!)).toBeGreaterThan(shapesBefore);
    });

    it('end-to-end: detect a floating block as debris and create a dynamic body', () => {
        // Two regions: anchored ground at the bottom, plus a floating
        // disk. Both fit in the single chunk so we don't run into the
        // cross-chunk-contour limitation.
        for (let x = 0; x < 64; x++) for (let y = 60; y < 64; y++) bitmap.setPixel(x, y, 1);
        Deposit.circle(bitmap, 32, 20, 8, 1);

        flushAll();

        // DebrisDetector identifies the floating disk and removes it.
        const debris = DebrisDetector.detectAndRemove(bitmap);
        expect(debris.length).toBe(1);
        const outer = debris[0]!.contours.find((c) => c.closed)!;
        expect(outer).toBeDefined();
        expect(debris[0]!.dominantMaterial).toBe(1);

        // After removal, the bitmap dirty chunks need to be re-meshed and
        // the debris contour needs a dynamic body.
        bitmap.forEachDirtyChunk((c) => queue.enqueueChunk(c));
        queue.enqueueDebris(outer, dirt);

        const debrisBodies: BodyId[] = [];
        queue.flush(adapter, {
            perFrameBudget: 100,
            onDebrisCreated: (bodyId) => debrisBodies.push(bodyId),
        });

        // Exactly one debris body created; the static ground body was
        // also recreated to reflect the carved state.
        expect(debrisBodies.length).toBe(1);
        expect(b2Body_IsValid(debrisBodies[0]!)).toBe(true);
        expect(b2Body_GetShapeCount(debrisBodies[0]!)).toBeGreaterThan(0);
    });
});

describe('Phase 2 pipeline — leak check', () => {
    it('200 destroy / rebuild cycles do not unboundedly grow the live body count', () => {
        Deposit.circle(bitmap, 32, 32, 24, 1);
        flushAll();

        for (let i = 0; i < 200; i++) {
            // Carve a small hole at varying positions.
            const cx = 16 + (i * 7) % 33;
            const cy = 16 + (i * 11) % 33;
            Carve.circle(bitmap, cx, cy, 2);
            // Re-deposit somewhere else to keep the bitmap from emptying.
            Deposit.circle(bitmap, 64 - cx, 64 - cy, 2, 1);
            flushAll();
        }

        // Invariant: at most one live body per chunk. Single-chunk world,
        // so at most 1.
        let liveBodies = 0;
        for (const chunk of bitmap.chunks) {
            const bodyId = adapter.getChunkBody(chunk);
            if (bodyId !== null && b2Body_IsValid(bodyId)) liveBodies++;
        }
        expect(liveBodies).toBeLessThanOrEqual(1);
    });
});
