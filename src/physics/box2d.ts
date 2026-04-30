/**
 * Typed binding to the subset of `phaser-box2d` we use.
 *
 * `phaser-box2d` ships as plain JS with no `.d.ts` declarations. Rather
 * than typing the entire 100+-symbol surface, this module imports the
 * runtime once and re-exports the small subset the adapter needs, with
 * minimal-but-honest types. Every other file in `src/physics/` should
 * import from here, never directly from `phaser-box2d`.
 */

import * as raw from 'phaser-box2d/dist/PhaserBox2D.js';

import type { BodyId, ChainId, WorldId } from './types.js';

interface Vec2 {
    x: number;
    y: number;
}

interface BodyDef {
    type: number;
    position: Vec2;
    rotation: { c: number; s: number };
    linearDamping: number;
    angularDamping: number;
    fixedRotation: boolean;
}

interface ChainDef {
    points: Vec2[];
    count: number;
    isLoop: boolean;
    friction: number;
    restitution: number;
    userData: unknown;
}

interface ShapeDef {
    density: number;
    friction: number;
    restitution: number;
    userData: unknown;
}

interface BodyTypeEnum {
    b2_staticBody: number;
    b2_kinematicBody: number;
    b2_dynamicBody: number;
}

interface AABB {
    lowerBoundX: number;
    lowerBoundY: number;
    upperBoundX: number;
    upperBoundY: number;
}

interface QueryFilter {
    categoryBits: number;
    maskBits: number;
}

interface Rotation {
    c: number;
    s: number;
}

interface Transform {
    p: Vec2;
    q: Rotation;
}

/** A `b2ShapeId` opaque handle. */
type ShapeId = unknown;

/** Callback signature for {@link b2World_OverlapAABB}. Return `true` to continue iteration, `false` to stop. */
type OverlapCallback = (shapeId: ShapeId, context: unknown) => boolean;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const r = raw as any;

/** Shared b2Vec2 constructor. Construct with `new b2Vec2(x, y)`. */
export const b2Vec2: new (x: number, y: number) => Vec2 = r.b2Vec2;

/**
 * `b2Rot` constructor. Construct with `new b2Rot(c, s)` where
 * `c = Math.cos(angle)` and `s = Math.sin(angle)`. Default
 * `(c=1, s=0)` is the identity rotation.
 *
 * IMPORTANT: pass a real `b2Rot` instance (not a `{ c, s }` literal)
 * to `b2Body_SetTransform`. The setter writes the object straight
 * into `bodySim.transform.q` and `bodySim.rotation0`; the next world
 * step calls `.clone()` on it via `b2BodySim.copyTo`, and a plain
 * literal would crash with "this.q.clone is not a function".
 */
export const b2Rot: new (c?: number, s?: number) => Rotation = r.b2Rot;

/** b2BodyType enum: `.b2_staticBody`, `.b2_dynamicBody`, etc. */
export const b2BodyType: BodyTypeEnum = r.b2BodyType;

/** Initialize the world pool. Must be called once before {@link b2CreateWorld}. */
export const b2CreateWorldArray: () => void = r.b2CreateWorldArray;

export const b2DefaultWorldDef: () => unknown = r.b2DefaultWorldDef;
export const b2CreateWorld: (def: unknown) => WorldId = r.b2CreateWorld;
export const b2DestroyWorld: (worldId: WorldId) => void = r.b2DestroyWorld;
export const b2World_Step: (worldId: WorldId, dt: number, subSteps: number) => void =
    r.b2World_Step;

export const b2DefaultBodyDef: () => BodyDef = r.b2DefaultBodyDef;
export const b2CreateBody: (worldId: WorldId, def: BodyDef) => BodyId = r.b2CreateBody;
export const b2DestroyBody: (bodyId: BodyId) => void = r.b2DestroyBody;
export const b2Body_GetShapeCount: (bodyId: BodyId) => number = r.b2Body_GetShapeCount;
export const b2Body_IsValid: (bodyId: BodyId) => boolean = r.b2Body_IsValid;
export const b2Body_GetType: (bodyId: BodyId) => number = r.b2Body_GetType;
export const b2Body_GetTransform: (bodyId: BodyId) => Transform = r.b2Body_GetTransform;
export const b2Body_SetTransform: (
    bodyId: BodyId,
    position: Vec2,
    rotation: Rotation,
) => void = r.b2Body_SetTransform;
export const b2Body_GetLinearVelocity: (bodyId: BodyId) => Vec2 = r.b2Body_GetLinearVelocity;
export const b2Body_SetLinearVelocity: (bodyId: BodyId, v: Vec2) => void =
    r.b2Body_SetLinearVelocity;
export const b2Body_GetAngularVelocity: (bodyId: BodyId) => number = r.b2Body_GetAngularVelocity;
export const b2Body_SetAngularVelocity: (bodyId: BodyId, w: number) => void =
    r.b2Body_SetAngularVelocity;
export const b2Body_IsAwake: (bodyId: BodyId) => boolean = r.b2Body_IsAwake;
export const b2Body_SetAwake: (bodyId: BodyId, awake: boolean) => void = r.b2Body_SetAwake;
export const b2Body_ComputeAABB: (bodyId: BodyId) => AABB = r.b2Body_ComputeAABB;

export const b2DefaultChainDef: () => ChainDef = r.b2DefaultChainDef;
export const b2CreateChain: (bodyId: BodyId, def: ChainDef) => ChainId = r.b2CreateChain;
export const b2DestroyChain: (chainId: ChainId) => void = r.b2DestroyChain;

export const b2DefaultShapeDef: () => ShapeDef = r.b2DefaultShapeDef;
export const b2CreatePolygonShape: (
    bodyId: BodyId,
    def: ShapeDef,
    polygon: unknown,
) => unknown = r.b2CreatePolygonShape;

export const b2ComputeHull: (points: Vec2[], count: number) => unknown = r.b2ComputeHull;
export const b2MakePolygon: (hull: unknown, radius: number) => unknown = r.b2MakePolygon;

/** AABB constructor: `new b2AABB(lowerX, lowerY, upperX, upperY)`. */
export const b2AABB: new (lx: number, ly: number, ux: number, uy: number) => AABB = r.b2AABB;
export const b2DefaultQueryFilter: () => QueryFilter = r.b2DefaultQueryFilter;

/**
 * Iterates every shape whose AABB overlaps the query AABB. The callback
 * receives a `b2ShapeId` and the user `context`; return `true` to keep
 * iterating, `false` to stop early.
 *
 * Note: `phaser-box2d` 1.1's implementation queries all body-type trees
 * (static + kinematic + dynamic) without filtering by body type — the
 * caller has to filter via {@link b2Body_GetType} on the resulting
 * shapes' bodies.
 */
export const b2World_OverlapAABB: (
    worldId: WorldId,
    aabb: AABB,
    filter: QueryFilter,
    fcn: OverlapCallback,
    context: unknown,
) => void = r.b2World_OverlapAABB;

export const b2Shape_GetBody: (shapeId: ShapeId) => BodyId = r.b2Shape_GetBody;

export type { Vec2, BodyDef, ChainDef, ShapeDef, AABB, QueryFilter, Rotation, Transform, ShapeId };
