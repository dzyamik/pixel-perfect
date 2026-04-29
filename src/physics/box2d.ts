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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const r = raw as any;

/** Shared b2Vec2 constructor. Construct with `new b2Vec2(x, y)`. */
export const b2Vec2: new (x: number, y: number) => Vec2 = r.b2Vec2;

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

export const b2DefaultChainDef: () => ChainDef = r.b2DefaultChainDef;
export const b2CreateChain: (bodyId: BodyId, def: ChainDef) => ChainId = r.b2CreateChain;

export const b2DefaultShapeDef: () => ShapeDef = r.b2DefaultShapeDef;
export const b2CreatePolygonShape: (
    bodyId: BodyId,
    def: ShapeDef,
    polygon: unknown,
) => unknown = r.b2CreatePolygonShape;

export const b2ComputeHull: (points: Vec2[], count: number) => unknown = r.b2ComputeHull;
export const b2MakePolygon: (hull: unknown, radius: number) => unknown = r.b2MakePolygon;

export type { Vec2, BodyDef, ChainDef, ShapeDef };
