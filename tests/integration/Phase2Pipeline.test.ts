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
 * without bound across many destroy/create cycles, and a Phase 2.5
 * cross-chunk test that exercises the per-blob global rebuild path.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Carve, ChunkedBitmap, Deposit } from '../../src/core/index.js';
import type { Contour, Material } from '../../src/core/index.js';
import {
    Box2DAdapter,
    DebrisDetector,
    DeferredRebuildQueue,
} from '../../src/physics/index.js';
import {
    b2Body_GetAngularVelocity,
    b2Body_GetLinearVelocity,
    b2Body_GetShapeCount,
    b2Body_GetTransform,
    b2Body_IsAwake,
    b2Body_IsValid,
    b2Body_SetAngularVelocity,
    b2Body_SetAwake,
    b2Body_SetLinearVelocity,
    b2CreateWorld,
    b2CreateWorldArray,
    b2DefaultWorldDef,
    b2DestroyWorld,
    b2Vec2,
    b2World_Step,
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
    queue.flush(adapter);
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
            onDebrisCreated: (bodyId) => debrisBodies.push(bodyId),
        });

        // Exactly one debris body created; the static ground body was
        // also recreated to reflect the carved state.
        expect(debrisBodies.length).toBe(1);
        expect(b2Body_IsValid(debrisBodies[0]!)).toBe(true);
        expect(b2Body_GetShapeCount(debrisBodies[0]!)).toBeGreaterThan(0);
    });
});

describe('Per-chunk colliders — cross-chunk blob support', () => {
    it('a single blob spanning multiple chunks produces one body per occupied chunk', () => {
        // 128x128 / 32 = 16 chunks. Solid rectangle covers 4 chunks
        // (cx 1..2, cy 2..3). The per-chunk model gives each chunk its
        // own static body whose triangulated polygons sit along the
        // chunk boundary — adjacent polygons share an edge but the
        // combined mass acts as one solid for any body resting on top.
        const big = new ChunkedBitmap({ width: 128, height: 128, chunkSize: 32 });
        const bigAdapter = new Box2DAdapter({ worldId, pixelsPerMeter: 32 });
        const bigQueue = new DeferredRebuildQueue({ bitmap: big });
        try {
            for (let x = 32; x < 96; x++) {
                for (let y = 64; y < 128; y++) {
                    big.setPixel(x, y, 1);
                }
            }
            for (const c of big.chunks) bigQueue.enqueueChunk(c);
            bigQueue.flush(bigAdapter);

            const liveBodies = big.chunks
                .map((c) => bigAdapter.getChunkBody(c))
                .filter((b) => b !== null);
            // Rectangle spans 4 chunks (2x2), so 4 bodies.
            expect(liveBodies.length).toBe(4);
            for (const body of liveBodies) {
                expect(b2Body_GetShapeCount(body!)).toBeGreaterThan(0);
            }
        } finally {
            bigAdapter.dispose();
        }
    });

    it('two disjoint cross-chunk blobs produce one body per occupied chunk in each', () => {
        const big = new ChunkedBitmap({ width: 128, height: 128, chunkSize: 32 });
        const bigAdapter = new Box2DAdapter({ worldId, pixelsPerMeter: 32 });
        const bigQueue = new DeferredRebuildQueue({ bitmap: big });
        try {
            // Blob A spans (0..1, 0..1) chunks (2x2 = 4 chunks).
            for (let x = 16; x < 48; x++) for (let y = 16; y < 48; y++) big.setPixel(x, y, 1);
            // Blob B spans (2..3, 2..3) chunks (2x2 = 4 chunks).
            for (let x = 80; x < 112; x++) for (let y = 80; y < 112; y++) big.setPixel(x, y, 1);

            for (const c of big.chunks) bigQueue.enqueueChunk(c);
            bigQueue.flush(bigAdapter);

            const liveBodies = big.chunks
                .map((c) => bigAdapter.getChunkBody(c))
                .filter((b) => b !== null);
            // 4 chunks per blob × 2 blobs = 8 bodies.
            expect(liveBodies.length).toBe(8);
        } finally {
            bigAdapter.dispose();
        }
    });

    it('carving in one chunk does not rebuild bodies in other chunks', () => {
        // This is the property the per-chunk model exists to give us:
        // a settled body resting on chunk B retains its contacts when
        // the user carves chunk A. We assert it via body identity —
        // the bodies in chunks NOT touched by the carve must be the
        // SAME body handle pre- and post-carve.
        const big = new ChunkedBitmap({ width: 128, height: 128, chunkSize: 32 });
        const bigAdapter = new Box2DAdapter({ worldId, pixelsPerMeter: 32 });
        const bigQueue = new DeferredRebuildQueue({ bitmap: big });
        try {
            // Single horizontal bar spanning 4 chunks (cx 0..3, cy 2).
            for (let x = 16; x < 112; x++) for (let y = 64; y < 96; y++) big.setPixel(x, y, 1);
            for (const c of big.chunks) bigQueue.enqueueChunk(c);
            bigQueue.flush(bigAdapter);

            const beforeMap = new Map<string, BodyId>();
            for (const c of big.chunks) {
                const b = bigAdapter.getChunkBody(c);
                if (b !== null) beforeMap.set(`${c.cx},${c.cy}`, b);
            }
            // Bar covers 4 chunks across cy=2 row.
            expect(beforeMap.size).toBe(4);

            // Carve only in the leftmost bar chunk (cx=0). Brush radius
            // 6 keeps the carve away from the cx=1 chunk boundary.
            Carve.circle(big, 24, 80, 6);
            for (const c of big.chunks) {
                if (c.dirty) bigQueue.enqueueChunk(c);
            }
            bigQueue.flush(bigAdapter);

            // Carved chunk's body should be replaced.
            const carvedChunk = big.getChunk(0, 2);
            expect(bigAdapter.getChunkBody(carvedChunk)).not.toBe(beforeMap.get('0,2'));
            expect(b2Body_IsValid(beforeMap.get('0,2')!)).toBe(false);

            // The other bar chunks (cx=1, 2, 3 at cy=2) must retain
            // identical body handles — same Box2D body, contacts on it
            // preserved.
            for (let cx = 1; cx <= 3; cx++) {
                const key = `${cx},2`;
                const bodyBefore = beforeMap.get(key);
                const bodyAfter = bigAdapter.getChunkBody(big.getChunk(cx, 2));
                expect(bodyAfter).toBe(bodyBefore);
                expect(b2Body_IsValid(bodyAfter!)).toBe(true);
            }
        } finally {
            bigAdapter.dispose();
        }
    });
});

describe('Phase 2 pipeline — snapshot/restore across rebuild', () => {
    /**
     * Helper: set up a small rest-on-ground scene and return the
     * dynamic body id for a debris piece. The terrain has a
     * 64-px-wide ground band along the bottom; the body sits well
     * above it (no contact) so the rebuild won't try to resolve a
     * pre-existing penetration that complicates the assertion.
     */
    function setUpSceneWithDynamicBody(): BodyId {
        for (let x = 0; x < 64; x++) for (let y = 60; y < 64; y++) bitmap.setPixel(x, y, 1);
        flushAll();
        const square: Contour = {
            points: [
                { x: 28, y: 30 },
                { x: 36, y: 30 },
                { x: 36, y: 38 },
                { x: 28, y: 38 },
            ],
            closed: true,
        };
        const bodyId = adapter.createDebrisBody(square, dirt);
        if (bodyId === null) throw new Error('failed to create debris body');
        return bodyId;
    }

    it('preserves a dynamic body\'s transform across a terrain rebuild', () => {
        const bodyId = setUpSceneWithDynamicBody();

        const before = b2Body_GetTransform(bodyId);
        const px = before.p.x;
        const py = before.p.y;
        const rc = before.q.c;
        const rs = before.q.s;

        // Carve elsewhere on the terrain so the rebuild fires.
        Carve.circle(bitmap, 10, 62, 2);
        flushAll();

        const after = b2Body_GetTransform(bodyId);
        expect(after.p.x).toBeCloseTo(px, 9);
        expect(after.p.y).toBeCloseTo(py, 9);
        expect(after.q.c).toBeCloseTo(rc, 9);
        expect(after.q.s).toBeCloseTo(rs, 9);
    });

    it('preserves linear and angular velocity across a rebuild', () => {
        const bodyId = setUpSceneWithDynamicBody();
        b2Body_SetLinearVelocity(bodyId, new b2Vec2(1.5, -0.7));
        b2Body_SetAngularVelocity(bodyId, 2.3);

        Carve.circle(bitmap, 10, 62, 2);
        flushAll();

        const v = b2Body_GetLinearVelocity(bodyId);
        const w = b2Body_GetAngularVelocity(bodyId);
        expect(v.x).toBeCloseTo(1.5, 9);
        expect(v.y).toBeCloseTo(-0.7, 9);
        expect(w).toBeCloseTo(2.3, 9);
    });

    it('keeps a sleeping body asleep when it still has support after the rebuild', () => {
        // Set up: solid ground with a body resting on top of it (its
        // AABB touches the ground's AABB). The user carves the LEFT
        // edge of the chunk — far from the body — so the body's
        // support polygon is preserved across the rebuild.
        for (let x = 0; x < 64; x++) for (let y = 56; y < 64; y++) bitmap.setPixel(x, y, 1);
        flushAll();
        // Body footprint: 8x8 square, bottom edge at y=56 (on top of
        // the ground band whose top is also at y=56).
        const restingSquare: Contour = {
            points: [
                { x: 28, y: 48 },
                { x: 36, y: 48 },
                { x: 36, y: 56 },
                { x: 28, y: 56 },
            ],
            closed: true,
        };
        const bodyId = adapter.createDebrisBody(restingSquare, dirt);
        if (bodyId === null) throw new Error('failed to create debris body');

        // Force-sleep the body (in real demos Box2D's sleep timer
        // handles this; we short-circuit it here for determinism).
        b2Body_SetAwake(bodyId, false);
        expect(b2Body_IsAwake(bodyId)).toBe(false);

        // Carve the leftmost ground pixels — the chunk rebuilds, but
        // the polygon under the body remains.
        Carve.circle(bitmap, 4, 60, 2);
        flushAll();

        // Snapshot/restore detected static support under the body's
        // AABB and put it back to sleep.
        expect(b2Body_IsAwake(bodyId)).toBe(false);
    });

    it('wakes a body whose support was carved out (no ghost-float)', () => {
        // Same setup, but this time the user carves DIRECTLY UNDER the
        // body. The support polygon under the body's AABB is gone, so
        // restore must NOT force-sleep — the body has to fall.
        for (let x = 0; x < 64; x++) for (let y = 56; y < 64; y++) bitmap.setPixel(x, y, 1);
        flushAll();
        const restingSquare: Contour = {
            points: [
                { x: 28, y: 48 },
                { x: 36, y: 48 },
                { x: 36, y: 56 },
                { x: 28, y: 56 },
            ],
            closed: true,
        };
        const bodyId = adapter.createDebrisBody(restingSquare, dirt);
        if (bodyId === null) throw new Error('failed to create debris body');
        b2Body_SetAwake(bodyId, false);
        expect(b2Body_IsAwake(bodyId)).toBe(false);

        // Carve a hole spanning the body's footprint. Brush radius 12
        // at (32, 60) wipes out everything under x in [20, 44].
        Carve.circle(bitmap, 32, 60, 12);
        flushAll();

        // Body should be awake (no static under it after the carve).
        expect(b2Body_IsAwake(bodyId)).toBe(true);

        // Step the world to confirm gravity actually moves it.
        const yBefore = b2Body_GetTransform(bodyId).p.y;
        for (let i = 0; i < 5; i++) b2World_Step(worldId, 1 / 60, 4);
        const yAfter = b2Body_GetTransform(bodyId).p.y;
        // Box2D y-up; gravity is negative; a falling body's y decreases.
        expect(yAfter).toBeLessThan(yBefore);
    });

    it('a world step after restore does not crash on the restored rotation', () => {
        // Regression for a real bug seen in demos 03 and 04: passing a
        // plain `{ c, s }` literal to b2Body_SetTransform stuck a
        // clone()-less object into bodySim.transform.q and
        // bodySim.rotation0 (PhaserBox2D.js:10723, 10726). The next
        // WorldStep would crash with "this.q.clone is not a function"
        // inside b2BodySim.copyTo. The fix is to use a real `b2Rot`
        // instance; this test guards against regressing it by actually
        // stepping the world after a restore cycle.
        setUpSceneWithDynamicBody();
        Carve.circle(bitmap, 10, 62, 2);
        flushAll();

        // Two steps — the crash was sometimes one step delayed
        // (b2TrySleepIsland reaches copyTo via the awake-set bookkeeping
        // path, which isn't always exercised every frame).
        expect(() => b2World_Step(worldId, 1 / 60, 4)).not.toThrow();
        expect(() => b2World_Step(worldId, 1 / 60, 4)).not.toThrow();
    });

    it('does not affect static (chunk) bodies', () => {
        // Sanity: snapshot/restore must filter to dynamic bodies.
        // Otherwise we'd be writing transforms back onto our own
        // newly-recreated terrain bodies, which would corrupt them.
        Deposit.circle(bitmap, 32, 32, 20, 1);
        flushAll();
        const chunkBody = adapter.getChunkBody(bitmap.getChunk(0, 0));
        expect(chunkBody).not.toBeNull();
        expect(b2Body_IsValid(chunkBody!)).toBe(true);

        Carve.circle(bitmap, 32, 32, 4);
        flushAll();

        // The chunk's body was destroyed and recreated by the rebuild.
        // The OLD handle should be invalid; the NEW handle valid.
        // (If snapshot/restore included static bodies, we'd have crashed
        // trying to set the old freed transform.)
        expect(b2Body_IsValid(chunkBody!)).toBe(false);
        const newBody = adapter.getChunkBody(bitmap.getChunk(0, 0));
        expect(newBody).not.toBeNull();
        expect(b2Body_IsValid(newBody!)).toBe(true);
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
