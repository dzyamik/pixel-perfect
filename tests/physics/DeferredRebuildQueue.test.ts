import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChunkedBitmap, Deposit } from '../../src/core/index.js';
import type { Contour, Material } from '../../src/core/index.js';
import { Box2DAdapter } from '../../src/physics/Box2DAdapter.js';
import {
    b2Body_GetShapeCount,
    b2CreateWorld,
    b2CreateWorldArray,
    b2DefaultWorldDef,
    b2DestroyWorld,
} from '../../src/physics/box2d.js';
import { DeferredRebuildQueue } from '../../src/physics/DeferredRebuildQueue.js';
import type { BodyId, WorldId } from '../../src/physics/types.js';

beforeAll(() => {
    b2CreateWorldArray();
});

let worldId: WorldId;
let bitmap: ChunkedBitmap;
let adapter: Box2DAdapter;
let queue: DeferredRebuildQueue;

beforeEach(() => {
    worldId = b2CreateWorld(b2DefaultWorldDef());
    bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
    adapter = new Box2DAdapter({ worldId, pixelsPerMeter: 32 });
    queue = new DeferredRebuildQueue({ bitmap });
});

afterEach(() => {
    adapter.dispose();
    b2DestroyWorld(worldId);
});

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

describe('DeferredRebuildQueue.enqueueChunk + flush', () => {
    it('flushes nothing on an empty queue', () => {
        expect(() => queue.flush(adapter)).not.toThrow();
        expect(queue.pendingChunkCount()).toBe(0);
    });

    it('rebuilds a single enqueued chunk', () => {
        // Paint a solid block in chunk (0, 0) and enqueue it.
        Deposit.circle(bitmap, 16, 16, 6, 1);
        const chunk = bitmap.getChunk(0, 0);
        queue.enqueueChunk(chunk);
        queue.flush(adapter);
        const bodyId = adapter.getChunkBody(chunk);
        expect(bodyId).not.toBeNull();
        expect(b2Body_GetShapeCount(bodyId!)).toBeGreaterThan(0);
    });

    it('clears the chunk\'s collider dirty flag after rebuild', () => {
        Deposit.circle(bitmap, 16, 16, 6, 1);
        const chunk = bitmap.getChunk(0, 0);
        // Deposit set chunk.dirty = true; enqueue + flush should clear it.
        expect(chunk.dirty).toBe(true);
        queue.enqueueChunk(chunk);
        queue.flush(adapter);
        expect(chunk.dirty).toBe(false);
        // visualDirty is independent and is left untouched (the renderer
        // owns it).
        expect(chunk.visualDirty).toBe(true);
    });

    it('deduplicates: enqueueing the same chunk twice yields one rebuild', () => {
        Deposit.circle(bitmap, 16, 16, 6, 1);
        const chunk = bitmap.getChunk(0, 0);
        queue.enqueueChunk(chunk);
        queue.enqueueChunk(chunk);
        expect(queue.pendingChunkCount()).toBe(1);
    });

    it('respects perFrameBudget: budget = 1 with 3 dirty chunks leaves 2 pending', () => {
        // Three chunks dirty.
        Deposit.circle(bitmap, 16, 16, 4, 1);
        Deposit.circle(bitmap, 48, 16, 4, 1);
        Deposit.circle(bitmap, 16, 48, 4, 1);
        const chunks = [
            bitmap.getChunk(0, 0),
            bitmap.getChunk(1, 0),
            bitmap.getChunk(0, 1),
        ];
        for (const c of chunks) queue.enqueueChunk(c);
        queue.flush(adapter, { perFrameBudget: 1 });
        expect(queue.pendingChunkCount()).toBe(2);
        // Subsequent flushes drain the rest.
        queue.flush(adapter, { perFrameBudget: 10 });
        expect(queue.pendingChunkCount()).toBe(0);
    });

    it('drains chunks in stable (cy, cx) row-major order regardless of insertion order', () => {
        // Make 4 chunks dirty.
        Deposit.circle(bitmap, 48, 48, 4, 1); // (1, 1)
        Deposit.circle(bitmap, 16, 48, 4, 1); // (0, 1)
        Deposit.circle(bitmap, 48, 16, 4, 1); // (1, 0)
        Deposit.circle(bitmap, 16, 16, 4, 1); // (0, 0)
        // Enqueue in scrambled order.
        queue.enqueueChunk(bitmap.getChunk(1, 1));
        queue.enqueueChunk(bitmap.getChunk(0, 0));
        queue.enqueueChunk(bitmap.getChunk(0, 1));
        queue.enqueueChunk(bitmap.getChunk(1, 0));
        const visited: [number, number][] = [];
        queue.flush(adapter, {
            perFrameBudget: 4,
            onChunkRebuilt: (chunk) => visited.push([chunk.cx, chunk.cy]),
        });
        expect(visited).toEqual([
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
        ]);
    });

    it('rebuilding a chunk whose contours simplified to nothing destroys its body', () => {
        // Build a body, then carve everything in the chunk to air. The
        // queue should rebuild and discover no contours, dropping the body.
        Deposit.circle(bitmap, 16, 16, 6, 1);
        const chunk = bitmap.getChunk(0, 0);
        queue.enqueueChunk(chunk);
        queue.flush(adapter);
        expect(adapter.getChunkBody(chunk)).not.toBeNull();

        // Erase everything.
        for (let y = 0; y < 32; y++) {
            for (let x = 0; x < 32; x++) {
                bitmap.setPixel(x, y, 0);
            }
        }
        queue.enqueueChunk(chunk);
        queue.flush(adapter);
        expect(adapter.getChunkBody(chunk)).toBeNull();
    });
});

describe('DeferredRebuildQueue.enqueueDebris + flush', () => {
    const debrisContour: Contour = {
        points: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 },
        ],
        closed: true,
    };

    it('creates a body and reports it via onDebrisCreated', () => {
        const onDebrisCreated = vi.fn();
        queue.enqueueDebris(debrisContour, dirt);
        queue.flush(adapter, { onDebrisCreated });
        expect(onDebrisCreated).toHaveBeenCalledTimes(1);
        const [bodyId, contour, material] = onDebrisCreated.mock.calls[0]!;
        expect(bodyId).toBeDefined();
        expect(contour).toBe(debrisContour);
        expect(material).toBe(dirt);
    });

    it('processes all queued debris regardless of perFrameBudget', () => {
        const onDebrisCreated = vi.fn();
        for (let i = 0; i < 5; i++) {
            queue.enqueueDebris(debrisContour, dirt);
        }
        queue.flush(adapter, { onDebrisCreated, perFrameBudget: 1 });
        // Budget caps chunk rebuilds; debris is processed unconditionally.
        expect(onDebrisCreated).toHaveBeenCalledTimes(5);
    });

    it('skips debris whose contour cannot become a body (returns null)', () => {
        const tooFew: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ],
            closed: true,
        };
        const onDebrisCreated = vi.fn();
        queue.enqueueDebris(tooFew, dirt);
        queue.flush(adapter, { onDebrisCreated });
        expect(onDebrisCreated).not.toHaveBeenCalled();
    });

    it('clears the debris queue after flushing', () => {
        queue.enqueueDebris(debrisContour, dirt);
        queue.flush(adapter);
        expect(queue.pendingDebrisCount()).toBe(0);
    });
});

describe('DeferredRebuildQueue — combined chunk + debris flush', () => {
    it('processes both queues in a single flush', () => {
        Deposit.circle(bitmap, 16, 16, 6, 1);
        const chunk = bitmap.getChunk(0, 0);
        queue.enqueueChunk(chunk);
        queue.enqueueDebris(
            {
                points: [
                    { x: 40, y: 40 },
                    { x: 50, y: 40 },
                    { x: 50, y: 50 },
                    { x: 40, y: 50 },
                ],
                closed: true,
            },
            dirt,
        );
        const bodies: BodyId[] = [];
        queue.flush(adapter, {
            onDebrisCreated: (bodyId) => bodies.push(bodyId),
        });
        expect(adapter.getChunkBody(chunk)).not.toBeNull();
        expect(bodies.length).toBe(1);
    });
});
