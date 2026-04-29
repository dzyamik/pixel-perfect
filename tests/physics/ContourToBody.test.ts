import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contourToChain, contourToPolygon } from '../../src/physics/ContourToBody.js';
import {
    b2BodyType,
    b2Body_GetShapeCount,
    b2CreateBody,
    b2CreateWorld,
    b2CreateWorldArray,
    b2DefaultBodyDef,
    b2DefaultWorldDef,
    b2DestroyBody,
    b2DestroyWorld,
} from '../../src/physics/box2d.js';
import type { Contour, Point } from '../../src/core/index.js';
import type { BodyId, WorldId } from '../../src/physics/types.js';

beforeAll(() => {
    b2CreateWorldArray();
});

let worldId: WorldId;
let bodyId: BodyId;

beforeEach(() => {
    worldId = b2CreateWorld(b2DefaultWorldDef());
    const def = b2DefaultBodyDef();
    def.type = b2BodyType.b2_staticBody;
    bodyId = b2CreateBody(worldId, def);
});

afterEach(() => {
    b2DestroyBody(bodyId);
    b2DestroyWorld(worldId);
});

const PPM = 32;

describe('contourToChain', () => {
    it('attaches a closed-loop chain with one edge per vertex for a closed contour', () => {
        const square: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const chainId = contourToChain(bodyId, { points: square, closed: true }, {
            pixelsPerMeter: PPM,
        });
        expect(chainId).toBeDefined();
        // Loop chain: one shape per vertex (= one edge per vertex).
        expect(b2Body_GetShapeCount(bodyId)).toBe(4);
    });

    it('attaches an open chain (single chain shape) for a 4+ vertex polyline', () => {
        const polyline: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const chainId = contourToChain(
            bodyId,
            { points: polyline, closed: false },
            { pixelsPerMeter: PPM },
        );
        expect(chainId).not.toBeNull();
        // Open chain reports as a single chain shape, not per-edge.
        expect(b2Body_GetShapeCount(bodyId)).toBe(1);
    });

    it('rejects closed contours with fewer than 3 vertices', () => {
        const tooFew: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
            ],
            closed: true,
        };
        const result = contourToChain(bodyId, tooFew, { pixelsPerMeter: PPM });
        expect(result).toBeNull();
        expect(b2Body_GetShapeCount(bodyId)).toBe(0);
    });

    it('rejects open contours with fewer than 4 vertices (Box2D ghost-vertex requirement)', () => {
        const tooFewOpen: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
                { x: 2, y: 0 },
            ],
            closed: false,
        };
        const result = contourToChain(bodyId, tooFewOpen, { pixelsPerMeter: PPM });
        expect(result).toBeNull();
        expect(b2Body_GetShapeCount(bodyId)).toBe(0);
    });

    it('honors friction and restitution overrides', () => {
        // Smoke: passing physical params doesn't throw and a chain is still created.
        const square: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const chainId = contourToChain(
            bodyId,
            { points: square, closed: true },
            { pixelsPerMeter: PPM, friction: 0.9, restitution: 0.4 },
        );
        expect(chainId).toBeDefined();
    });
});

describe('contourToPolygon', () => {
    it('creates a polygon shape for a small convex contour', () => {
        const triangle: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 5, y: 10 },
        ];
        const result = contourToPolygon(bodyId, { points: triangle, closed: true }, {
            pixelsPerMeter: PPM,
            density: 1,
        });
        expect(result).not.toBeNull();
        expect(b2Body_GetShapeCount(bodyId)).toBe(1);
    });

    it('returns null for a contour with more than 8 vertices', () => {
        const points: Point[] = [];
        for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2;
            points.push({ x: 10 + 5 * Math.cos(angle), y: 10 + 5 * Math.sin(angle) });
        }
        const result = contourToPolygon(bodyId, { points, closed: true }, {
            pixelsPerMeter: PPM,
            density: 1,
        });
        expect(result).toBeNull();
        expect(b2Body_GetShapeCount(bodyId)).toBe(0);
    });

    it('returns null for a non-convex contour', () => {
        // L-shape: 6 vertices, non-convex.
        const lShape: Point[] = [
            { x: 0, y: 0 },
            { x: 20, y: 0 },
            { x: 20, y: 10 },
            { x: 10, y: 10 },
            { x: 10, y: 20 },
            { x: 0, y: 20 },
        ];
        const result = contourToPolygon(bodyId, { points: lShape, closed: true }, {
            pixelsPerMeter: PPM,
            density: 1,
        });
        expect(result).toBeNull();
        expect(b2Body_GetShapeCount(bodyId)).toBe(0);
    });

    it('returns null for fewer than 3 vertices', () => {
        const tooFew: Contour = {
            points: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
            ],
            closed: true,
        };
        const result = contourToPolygon(bodyId, tooFew, {
            pixelsPerMeter: PPM,
            density: 1,
        });
        expect(result).toBeNull();
    });

    it('handles a square (convex with collinear-free vertices)', () => {
        const square: Point[] = [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ];
        const result = contourToPolygon(bodyId, { points: square, closed: true }, {
            pixelsPerMeter: PPM,
            density: 1,
        });
        expect(result).not.toBeNull();
        expect(b2Body_GetShapeCount(bodyId)).toBe(1);
    });
});
