import earcut from 'earcut';

import type { Contour } from '../core/index.js';
import {
    b2ComputeHull,
    b2CreateChain,
    b2CreatePolygonShape,
    b2DefaultChainDef,
    b2DefaultShapeDef,
    b2MakePolygon,
    b2Vec2,
} from './box2d.js';
import type { ChainId, BodyId } from './types.js';

/** Maximum vertex count Box2D's `b2PolygonShape` accepts. */
const B2_MAX_POLYGON_VERTICES = 8;

/** Common physical parameters shared by chain and polygon creation. */
export interface BaseShapeOptions {
    /** Conversion factor: 1 meter = `pixelsPerMeter` pixels. */
    pixelsPerMeter: number;
    /** Surface friction (Coulomb), 0..1+. Default 0.7. */
    friction?: number;
    /** Restitution (bounciness), 0..1. Default 0. */
    restitution?: number;
    /** Optional per-shape user data (echoed back from Box2D collision events). */
    userData?: unknown;
}

/** Options for {@link contourToChain}. Chain shapes are static-only by design. */
export type ChainOptions = BaseShapeOptions;

/** Options for {@link contourToPolygon}. Polygon shapes are typically dynamic. */
export interface PolygonOptions extends BaseShapeOptions {
    /** Mass density in kg/m². Required for dynamic bodies; default 1. */
    density?: number;
}

/**
 * Converts a `Contour` (world-space pixel coordinates) into Box2D-space
 * `b2Vec2`s.
 *
 * Box2D works in meters and uses a y-up coordinate system; our bitmap
 * (and Phaser) use pixels and y-down. The conversion negates `y` and
 * scales by `1 / pixelsPerMeter`.
 */
function pointsToBox2D(contour: Contour, ppm: number) {
    const out: { x: number; y: number }[] = [];
    for (const p of contour.points) {
        out.push(new b2Vec2(p.x / ppm, -p.y / ppm));
    }
    return out;
}

/**
 * Attaches a `b2ChainShape` to `bodyId` representing the contour outline.
 *
 * Closed contours produce a `b2ChainShape` with `isLoop = true`; open
 * contours produce a polyline with ghost-vertex handling on each end.
 * Returns the new chain id, or `null` if the contour is too short to
 * produce a valid chain:
 *
 *   - Closed (loop) chains require at least 3 vertices.
 *   - Open chains require at least 4 vertices because Box2D needs both
 *     end edges plus an additional vertex on each side to derive ghost
 *     vertices. Shorter open chains are silently dropped by Box2D
 *     (no shape is attached even though the call returns an id), so
 *     this function refuses them up front.
 *
 * Chain shapes are one-sided by design: the collision normal points to
 * the right of segment direction. Marching-squares output uses
 * solid-on-visual-LEFT in y-down coordinates; after the y-flip applied
 * by this function the winding is preserved as math-CCW around solid in
 * Box2D's y-up coordinates, which puts the collision normal on the
 * outside of solid blobs (correct for terrain).
 */
export function contourToChain(
    bodyId: BodyId,
    contour: Contour,
    options: ChainOptions,
): ChainId | null {
    const minPoints = contour.closed ? 3 : 4;
    if (contour.points.length < minPoints) return null;
    const points = pointsToBox2D(contour, options.pixelsPerMeter);
    const def = b2DefaultChainDef();
    def.points = points;
    def.count = points.length;
    def.isLoop = contour.closed;
    if (options.friction !== undefined) def.friction = options.friction;
    if (options.restitution !== undefined) def.restitution = options.restitution;
    if (options.userData !== undefined) def.userData = options.userData;
    return b2CreateChain(bodyId, def);
}

/**
 * Squared cross-product test for convex polygon. Returns `true` if every
 * consecutive edge turns the same direction (all signs of the cross
 * product agree). Collinear vertices are tolerated.
 */
function isConvex(contour: Contour): boolean {
    const points = contour.points;
    const n = points.length;
    if (n < 3) return false;
    let sign = 0;
    for (let i = 0; i < n; i++) {
        const a = points[i]!;
        const b = points[(i + 1) % n]!;
        const c = points[(i + 2) % n]!;
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        if (cross !== 0) {
            const s = cross > 0 ? 1 : -1;
            if (sign === 0) sign = s;
            else if (s !== sign) return false;
        }
    }
    return true;
}

/**
 * Attempts to attach a convex `b2PolygonShape` to `bodyId`.
 *
 * Returns the new shape id on success, or `null` if the contour is not
 * eligible. Eligibility:
 * - At least 3 vertices.
 * - At most 8 vertices (Box2D's `b2PolygonShape` cap).
 * - Convex (all consecutive cross products have the same sign).
 *
 * Callers (typically the debris path of {@link Box2DAdapter}) should
 * fall back to {@link contourToChain} when this returns `null`.
 */
export function contourToPolygon(
    bodyId: BodyId,
    contour: Contour,
    options: PolygonOptions,
): unknown | null {
    if (contour.points.length < 3) return null;
    if (contour.points.length > B2_MAX_POLYGON_VERTICES) return null;
    if (!isConvex(contour)) return null;

    const points = pointsToBox2D(contour, options.pixelsPerMeter);
    const hull = b2ComputeHull(points, points.length);
    const polygon = b2MakePolygon(hull, 0);

    const shapeDef = b2DefaultShapeDef();
    shapeDef.density = options.density ?? 1;
    if (options.friction !== undefined) shapeDef.friction = options.friction;
    if (options.restitution !== undefined) shapeDef.restitution = options.restitution;
    if (options.userData !== undefined) shapeDef.userData = options.userData;

    return b2CreatePolygonShape(bodyId, shapeDef, polygon);
}

/**
 * Attaches a triangulated polygon collider to `bodyId`. Each triangle
 * becomes its own `b2PolygonShape` (3 verts, two-sided collision).
 *
 * This is the preferred path for both terrain and debris bodies because
 * polygon shapes resolve penetration on either side, unlike one-sided
 * `b2ChainShape`. Non-convex contours (e.g. an L-shaped piece left after
 * a carve) are handled directly by the triangulator — no convex check
 * or fallback is needed.
 *
 * Returns the number of triangle shapes successfully attached. `0` means
 * the contour was too short or earcut produced no triangles (e.g. all
 * vertices collinear). Callers that need a body-creation gate should
 * check for `> 0`.
 *
 * Vertex direction does not affect correctness — earcut handles either
 * winding — but we still flip y at the same place chain conversion does
 * so that pixel-space (y-down) contours land in Box2D meter-space (y-up).
 */
export function contourToTriangles(
    bodyId: BodyId,
    contour: Contour,
    options: PolygonOptions,
): number {
    if (contour.points.length < 3) return 0;

    // earcut wants a flat [x0, y0, x1, y1, ...] in target (Box2D) coords.
    const ppm = options.pixelsPerMeter;
    const flat = new Array<number>(contour.points.length * 2);
    for (let i = 0; i < contour.points.length; i++) {
        const p = contour.points[i]!;
        flat[i * 2] = p.x / ppm;
        flat[i * 2 + 1] = -p.y / ppm;
    }

    const indices = earcut(flat);
    if (indices.length === 0) return 0;

    const shapeDef = b2DefaultShapeDef();
    shapeDef.density = options.density ?? 1;
    if (options.friction !== undefined) shapeDef.friction = options.friction;
    if (options.restitution !== undefined) shapeDef.restitution = options.restitution;
    if (options.userData !== undefined) shapeDef.userData = options.userData;

    let attached = 0;
    for (let i = 0; i < indices.length; i += 3) {
        const i0 = indices[i]! * 2;
        const i1 = indices[i + 1]! * 2;
        const i2 = indices[i + 2]! * 2;
        const tri = [
            new b2Vec2(flat[i0]!, flat[i0 + 1]!),
            new b2Vec2(flat[i1]!, flat[i1 + 1]!),
            new b2Vec2(flat[i2]!, flat[i2 + 1]!),
        ];
        const hull = b2ComputeHull(tri, 3);
        // Degenerate triangle (collinear): b2ComputeHull may return an
        // unusable hull. Trust b2MakePolygon to no-op on those rather
        // than introducing our own area threshold here.
        const polygon = b2MakePolygon(hull, 0);
        b2CreatePolygonShape(bodyId, shapeDef, polygon);
        attached++;
    }
    return attached;
}
