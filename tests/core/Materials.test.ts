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

        // ── v2.6.1 timer-uint8 range checks ──
        // The cellTimers Uint8Array saturates at 255, so any
        // threshold above 256 would silently be unreachable. The
        // registry rejects out-of-range values up front so users
        // can't ship a fire that burns forever or a sand that never
        // promotes. See docs-dev/04-tuning-research.md.

        const fireBase: Material = {
            id: 7, name: 'fire', color: 0xff7030,
            density: 0, friction: 0, restitution: 0,
            destructible: true, destructionResistance: 0,
            simulation: 'fire',
        };

        it('accepts burnDuration in 1..256', () => {
            for (const d of [1, 40, 256]) {
                const r = new MaterialRegistry();
                expect(() =>
                    r.register({ ...fireBase, burnDuration: d }),
                ).not.toThrow();
            }
        });

        it('rejects fire material with no burnDuration', () => {
            const r = new MaterialRegistry();
            expect(() => r.register(fireBase)).toThrow(/burnDuration/i);
        });

        it('rejects burnDuration <= 0', () => {
            const r = new MaterialRegistry();
            expect(() =>
                r.register({ ...fireBase, burnDuration: 0 }),
            ).toThrow(/burnDuration.*1\.\.256/i);
            expect(() =>
                r.register({ ...fireBase, id: 8, burnDuration: -1 }),
            ).toThrow(/burnDuration/i);
        });

        it('rejects burnDuration > 256 (uint8 saturation gotcha)', () => {
            const r = new MaterialRegistry();
            expect(() =>
                r.register({ ...fireBase, burnDuration: 257 }),
            ).toThrow(/burnDuration.*1\.\.256/i);
            expect(() =>
                r.register({ ...fireBase, id: 8, burnDuration: 1000 }),
            ).toThrow(/burnDuration/i);
        });

        it('rejects non-integer burnDuration', () => {
            const r = new MaterialRegistry();
            expect(() =>
                r.register({ ...fireBase, burnDuration: 40.5 }),
            ).toThrow(/burnDuration/i);
        });

        const sandBase: Material = {
            id: 5, name: 'sand', color: 0xd4b06a,
            density: 1, friction: 0.5, restitution: 0.05,
            destructible: true, destructionResistance: 0,
            simulation: 'sand',
        };

        it('accepts settleAfterTicks in 1..256 when settlesTo is set', () => {
            for (const t of [1, 30, 256]) {
                const r = new MaterialRegistry();
                expect(() =>
                    r.register({
                        ...sandBase,
                        settlesTo: 99,
                        settleAfterTicks: t,
                    }),
                ).not.toThrow();
            }
        });

        it('rejects settlesTo without settleAfterTicks', () => {
            const r = new MaterialRegistry();
            expect(() =>
                r.register({ ...sandBase, settlesTo: 99 }),
            ).toThrow(/settleAfterTicks/i);
        });

        it('rejects settleAfterTicks <= 0', () => {
            const r = new MaterialRegistry();
            expect(() =>
                r.register({
                    ...sandBase,
                    settlesTo: 99,
                    settleAfterTicks: 0,
                }),
            ).toThrow(/settleAfterTicks.*1\.\.256/i);
        });

        it('rejects settleAfterTicks > 256 (uint8 saturation gotcha)', () => {
            const r = new MaterialRegistry();
            expect(() =>
                r.register({
                    ...sandBase,
                    settlesTo: 99,
                    settleAfterTicks: 257,
                }),
            ).toThrow(/settleAfterTicks.*1\.\.256/i);
        });

        it('skips settleAfterTicks check when settlesTo is undefined', () => {
            // Plain sand with no settling configured — no validation
            // applies. (The check only fires when the user opts into
            // settling by setting settlesTo.)
            const r = new MaterialRegistry();
            expect(() => r.register(sandBase)).not.toThrow();
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
