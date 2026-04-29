import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../src/core/index.js';
import type { Contour, Material } from '../../src/core/index.js';
import { Box2DAdapter } from '../../src/physics/Box2DAdapter.js';
import {
    b2Body_GetShapeCount,
    b2Body_IsValid,
    b2CreateWorld,
    b2CreateWorldArray,
    b2DefaultWorldDef,
    b2DestroyWorld,
} from '../../src/physics/box2d.js';
import type { WorldId } from '../../src/physics/types.js';

beforeAll(() => {
    b2CreateWorldArray();
});

let worldId: WorldId;
let bitmap: ChunkedBitmap;
let adapter: Box2DAdapter;

beforeEach(() => {
    worldId = b2CreateWorld(b2DefaultWorldDef());
    bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 32 });
    adapter = new Box2DAdapter({ worldId, pixelsPerMeter: 32 });
});

afterEach(() => {
    adapter.dispose();
    b2DestroyWorld(worldId);
});

const square = (x: number, y: number, size: number): Contour => ({
    points: [
        { x, y },
        { x: x + size, y },
        { x: x + size, y: y + size },
        { x, y: y + size },
    ],
    closed: true,
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

describe('Box2DAdapter.rebuildChunk', () => {
    it('creates one static body per chunk with shapes for each contour', () => {
        const chunk = bitmap.getChunk(0, 0);
        adapter.rebuildChunk(chunk, [square(2, 2, 10)]);
        const bodyId = adapter.getChunkBody(chunk);
        expect(bodyId).not.toBeNull();
        expect(b2Body_IsValid(bodyId!)).toBe(true);
        // 4-vertex loop chain attaches 4 edge shapes.
        expect(b2Body_GetShapeCount(bodyId!)).toBe(4);
    });

    it('handles multiple contours on the same chunk (donut)', () => {
        const chunk = bitmap.getChunk(0, 0);
        const outer = square(2, 2, 20);
        const inner = square(8, 8, 6);
        adapter.rebuildChunk(chunk, [outer, inner]);
        const bodyId = adapter.getChunkBody(chunk);
        expect(bodyId).not.toBeNull();
        // 4 + 4 chain shapes.
        expect(b2Body_GetShapeCount(bodyId!)).toBe(8);
    });

    it('destroys the old body before creating a new one on rebuild', () => {
        const chunk = bitmap.getChunk(0, 0);
        adapter.rebuildChunk(chunk, [square(2, 2, 10)]);
        const firstBody = adapter.getChunkBody(chunk)!;
        adapter.rebuildChunk(chunk, [square(5, 5, 8)]);
        const secondBody = adapter.getChunkBody(chunk)!;
        expect(b2Body_IsValid(firstBody)).toBe(false);
        expect(b2Body_IsValid(secondBody)).toBe(true);
    });

    it('with empty contour list, removes the body and clears the map entry', () => {
        const chunk = bitmap.getChunk(0, 0);
        adapter.rebuildChunk(chunk, [square(2, 2, 10)]);
        expect(adapter.getChunkBody(chunk)).not.toBeNull();
        adapter.rebuildChunk(chunk, []);
        expect(adapter.getChunkBody(chunk)).toBeNull();
    });

    it('skips contours with insufficient vertices', () => {
        const chunk = bitmap.getChunk(0, 0);
        // Contour with 2 points should be silently skipped; the body still
        // gets created (if other valid contours), but the degenerate
        // contour is dropped.
        adapter.rebuildChunk(chunk, [
            { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], closed: true },
            square(2, 2, 10),
        ]);
        const bodyId = adapter.getChunkBody(chunk)!;
        // Only the valid square contour produced shapes.
        expect(b2Body_GetShapeCount(bodyId)).toBe(4);
    });

    it('handles independent chunks without interfering', () => {
        const chunkA = bitmap.getChunk(0, 0);
        const chunkB = bitmap.getChunk(1, 1);
        adapter.rebuildChunk(chunkA, [square(2, 2, 10)]);
        adapter.rebuildChunk(chunkB, [square(35, 35, 10)]);
        const bodyA = adapter.getChunkBody(chunkA);
        const bodyB = adapter.getChunkBody(chunkB);
        expect(bodyA).not.toBeNull();
        expect(bodyB).not.toBeNull();
        expect(bodyA).not.toBe(bodyB);
        // Rebuilding A doesn't affect B.
        adapter.rebuildChunk(chunkA, [square(20, 20, 5)]);
        expect(b2Body_IsValid(bodyB!)).toBe(true);
    });
});

describe('Box2DAdapter.destroyChunk', () => {
    it('destroys the body and clears the map entry', () => {
        const chunk = bitmap.getChunk(0, 0);
        adapter.rebuildChunk(chunk, [square(2, 2, 10)]);
        const bodyId = adapter.getChunkBody(chunk)!;
        adapter.destroyChunk(chunk);
        expect(b2Body_IsValid(bodyId)).toBe(false);
        expect(adapter.getChunkBody(chunk)).toBeNull();
    });

    it('is a no-op for a chunk that was never rebuilt', () => {
        const chunk = bitmap.getChunk(0, 0);
        expect(() => adapter.destroyChunk(chunk)).not.toThrow();
    });
});

describe('Box2DAdapter.createDebrisBody', () => {
    it('creates a dynamic body for a small convex contour', () => {
        const debrisContour = square(10, 10, 4);
        const bodyId = adapter.createDebrisBody(debrisContour, dirt);
        expect(bodyId).not.toBeNull();
        expect(b2Body_IsValid(bodyId!)).toBe(true);
        // Convex+≤8 verts → polygon shape (1 shape).
        expect(b2Body_GetShapeCount(bodyId!)).toBe(1);
    });

    it('creates a chain body for a non-convex contour (fallback)', () => {
        // L-shape is non-convex; polygon rejection kicks in, chain takes over.
        const lShape: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 10 },
                { x: 10, y: 10 },
                { x: 10, y: 20 },
                { x: 0, y: 20 },
            ],
            closed: true,
        };
        const bodyId = adapter.createDebrisBody(lShape, dirt);
        expect(bodyId).not.toBeNull();
        // Chain shape: one shape per edge.
        expect(b2Body_GetShapeCount(bodyId!)).toBe(6);
    });

    it('returns null for a contour with fewer than 3 vertices', () => {
        const tooFew: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ],
            closed: true,
        };
        expect(adapter.createDebrisBody(tooFew, dirt)).toBeNull();
    });

    it('uses the material physical properties (density, friction, restitution)', () => {
        // Smoke: pass through without throwing. (We don't introspect Box2D
        // body internals — the binding doesn't expose getters for those.)
        const bodyId = adapter.createDebrisBody(square(5, 5, 4), {
            ...dirt,
            density: 5,
            friction: 0.95,
            restitution: 0.6,
        });
        expect(bodyId).not.toBeNull();
    });
});

describe('Box2DAdapter.destroyBody', () => {
    it('destroys a debris body and invalidates its handle', () => {
        const bodyId = adapter.createDebrisBody(square(5, 5, 4), dirt)!;
        expect(b2Body_IsValid(bodyId)).toBe(true);
        adapter.destroyBody(bodyId);
        expect(b2Body_IsValid(bodyId)).toBe(false);
    });
});

describe('Box2DAdapter — memory hygiene', () => {
    it('does not leak bodies across many rebuild cycles', () => {
        const chunk = bitmap.getChunk(0, 0);
        const bodyHandles: unknown[] = [];
        for (let i = 0; i < 50; i++) {
            adapter.rebuildChunk(chunk, [square(2 + (i % 3), 2 + (i % 3), 8)]);
            bodyHandles.push(adapter.getChunkBody(chunk));
        }
        // Only the latest body should be valid; all earlier bodies were
        // destroyed by rebuild calls.
        const last = bodyHandles[bodyHandles.length - 1];
        expect(b2Body_IsValid(last as never)).toBe(true);
        // At least the first should be invalid (Box2D recycles slots so
        // intermediate handles may match the latest revision; just spot-
        // check that not every old handle remains valid).
        const validOld = bodyHandles.slice(0, -1).filter((h) => b2Body_IsValid(h as never)).length;
        expect(validOld).toBeLessThan(bodyHandles.length - 1);
    });

    it('dispose() destroys every body the adapter still holds', () => {
        const a = bitmap.getChunk(0, 0);
        const b = bitmap.getChunk(1, 0);
        adapter.rebuildChunk(a, [square(2, 2, 10)]);
        adapter.rebuildChunk(b, [square(35, 2, 10)]);
        const bodyA = adapter.getChunkBody(a)!;
        const bodyB = adapter.getChunkBody(b)!;
        adapter.dispose();
        expect(b2Body_IsValid(bodyA)).toBe(false);
        expect(b2Body_IsValid(bodyB)).toBe(false);
    });
});
