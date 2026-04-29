import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    b2BodyType,
    b2CreateBody,
    b2CreateChain,
    b2CreateWorld,
    b2CreateWorldArray,
    b2DefaultBodyDef,
    b2DefaultChainDef,
    b2DefaultWorldDef,
    b2DestroyBody,
    b2DestroyWorld,
    b2Body_GetShapeCount,
    b2Body_IsValid,
    b2Vec2,
    b2World_Step,
} from '../../src/physics/box2d.js';
import type { WorldId } from '../../src/physics/types.js';

describe('phaser-box2d binding', () => {
    beforeAll(() => {
        // Initialize the world pool exactly once. Idempotent for testing
        // purposes, but the binding contract is "call this before any
        // CreateWorld."
        b2CreateWorldArray();
    });

    let worldId: WorldId;

    beforeEach(() => {
        worldId = b2CreateWorld(b2DefaultWorldDef());
    });

    afterEach(() => {
        b2DestroyWorld(worldId);
    });

    it('creates and destroys a static body', () => {
        const def = b2DefaultBodyDef();
        def.type = b2BodyType.b2_staticBody;
        const bodyId = b2CreateBody(worldId, def);
        expect(b2Body_IsValid(bodyId)).toBe(true);
        b2DestroyBody(bodyId);
        expect(b2Body_IsValid(bodyId)).toBe(false);
    });

    it('attaches a closed-loop chain shape to a static body', () => {
        const def = b2DefaultBodyDef();
        def.type = b2BodyType.b2_staticBody;
        const bodyId = b2CreateBody(worldId, def);

        const chainDef = b2DefaultChainDef();
        chainDef.points = [
            new b2Vec2(0, 0),
            new b2Vec2(1, 0),
            new b2Vec2(1, 1),
            new b2Vec2(0, 1),
        ];
        chainDef.count = 4;
        chainDef.isLoop = true;
        b2CreateChain(bodyId, chainDef);

        // A loop chain produces one shape per edge — 4 in this case.
        expect(b2Body_GetShapeCount(bodyId)).toBe(4);

        b2DestroyBody(bodyId);
    });

    it('steps a world without throwing', () => {
        expect(() => b2World_Step(worldId, 1 / 60, 4)).not.toThrow();
    });
});
