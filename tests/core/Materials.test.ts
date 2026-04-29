import { describe, expect, it } from 'vitest';
import { MaterialRegistry } from '../../src/core/Materials.js';
import type { Material } from '../../src/core/types.js';

const dirt: Material = {
    id: 1,
    name: 'dirt',
    color: 0x8b5a3c,
    density: 1.0,
    friction: 0.7,
    restitution: 0.1,
    destructible: true,
    destructionResistance: 0,
};

const stone: Material = {
    id: 2,
    name: 'stone',
    color: 0x666666,
    density: 2.5,
    friction: 0.9,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0.5,
};

describe('MaterialRegistry', () => {
    describe('construction', () => {
        it('starts empty when no materials supplied', () => {
            const registry = new MaterialRegistry();
            expect(registry.get(1)).toBeUndefined();
        });

        it('accepts a list of materials in the constructor', () => {
            const registry = new MaterialRegistry([dirt, stone]);
            expect(registry.get(1)).toEqual(dirt);
            expect(registry.get(2)).toEqual(stone);
        });

        it('rejects duplicate ids in the constructor', () => {
            expect(() => new MaterialRegistry([dirt, { ...stone, id: 1 }])).toThrow(
                /duplicate.*id.*1/i,
            );
        });
    });

    describe('register', () => {
        it('adds a material that can be looked up by id', () => {
            const registry = new MaterialRegistry();
            registry.register(dirt);
            expect(registry.get(1)).toEqual(dirt);
        });

        it('rejects id 0 (reserved for air)', () => {
            const registry = new MaterialRegistry();
            expect(() => registry.register({ ...dirt, id: 0 })).toThrow(
                /reserved|air|0/i,
            );
        });

        it('rejects ids outside the 1..255 range', () => {
            const registry = new MaterialRegistry();
            expect(() => registry.register({ ...dirt, id: -1 })).toThrow();
            expect(() => registry.register({ ...dirt, id: 256 })).toThrow();
            expect(() => registry.register({ ...dirt, id: 1.5 })).toThrow();
        });

        it('rejects re-registering an existing id', () => {
            const registry = new MaterialRegistry([dirt]);
            expect(() => registry.register({ ...stone, id: 1 })).toThrow(
                /duplicate|already/i,
            );
        });
    });

    describe('get vs getOrThrow', () => {
        it('get returns undefined for unknown ids', () => {
            const registry = new MaterialRegistry([dirt]);
            expect(registry.get(99)).toBeUndefined();
        });

        it('getOrThrow returns the material for known ids', () => {
            const registry = new MaterialRegistry([dirt]);
            expect(registry.getOrThrow(1)).toEqual(dirt);
        });

        it('getOrThrow throws for unknown ids', () => {
            const registry = new MaterialRegistry([dirt]);
            expect(() => registry.getOrThrow(99)).toThrow(/99|unknown|not.*registered/i);
        });

        it('get(0) is undefined (air is implicit, not in the registry)', () => {
            const registry = new MaterialRegistry([dirt]);
            expect(registry.get(0)).toBeUndefined();
        });
    });
});
