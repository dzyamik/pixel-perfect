/**
 * Pure-function tests for the TerrainRenderer hot loop. Doesn't
 * touch Phaser — the helpers (`buildColorLut`, `paintChunkPixels`)
 * are pure and exported for exactly this kind of verification.
 *
 * Also includes a minimal benchmark of `paintChunkPixels` on a
 * 128×128 chunk so future regressions in the hot path show up
 * here. The bench prints to stdout but doesn't fail unless the
 * loop crashes — perf assertions are too brittle to run in CI.
 */

import { describe, expect, it } from 'vitest';
import { MaterialRegistry } from '../../src/core/index.js';
import type { Material } from '../../src/core/index.js';
import {
    buildColorLut,
    paintChunkPixels,
} from '../../src/phaser/TerrainRenderer.js';

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

const stone: Material = {
    id: 7,
    name: 'stone',
    color: 0x556070,
    density: 2.5,
    friction: 0.9,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0.5,
};

/** Pack four channel bytes the same way the renderer does. */
function packRgba(r: number, g: number, b: number, a: number): number {
    return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

describe('buildColorLut', () => {
    it('air (id 0) is fully transparent black', () => {
        const lut = buildColorLut(new MaterialRegistry([dirt, stone]));
        expect(lut[0]).toBe(0);
    });

    it('registered ids pack their color with alpha 0xff', () => {
        const lut = buildColorLut(new MaterialRegistry([dirt, stone]));
        // dirt is 0x8b5a3c → R=0x8b, G=0x5a, B=0x3c, A=0xff
        expect(lut[1]! >>> 0).toBe(packRgba(0x8b, 0x5a, 0x3c, 0xff) >>> 0);
        // stone at id 7 is 0x556070 → R=0x55, G=0x60, B=0x70, A=0xff
        expect(lut[7]! >>> 0).toBe(packRgba(0x55, 0x60, 0x70, 0xff) >>> 0);
    });

    it('unregistered non-zero ids fall back to magenta (0xff00ff, alpha 0xff)', () => {
        const lut = buildColorLut(new MaterialRegistry([dirt]));
        const expected = packRgba(0xff, 0x00, 0xff, 0xff) >>> 0;
        // id 5 isn't registered, neither are most others.
        expect(lut[5]! >>> 0).toBe(expected);
        expect(lut[200]! >>> 0).toBe(expected);
        expect(lut[255]! >>> 0).toBe(expected);
        // id 1 (dirt) is registered, should NOT be magenta.
        expect(lut[1]! >>> 0).not.toBe(expected);
    });

    it('returns a 256-entry Uint32Array', () => {
        const lut = buildColorLut(new MaterialRegistry());
        expect(lut).toBeInstanceOf(Uint32Array);
        expect(lut.length).toBe(256);
    });
});

describe('paintChunkPixels', () => {
    it('writes the LUT entry for each bitmap byte', () => {
        const bitmap = new Uint8Array([0, 1, 7, 1, 0, 5]);
        const lut = buildColorLut(new MaterialRegistry([dirt, stone]));
        const pixels32 = new Uint32Array(bitmap.length);
        paintChunkPixels(bitmap, pixels32, lut);
        expect(pixels32[0]! >>> 0).toBe(0); // air
        expect(pixels32[1]! >>> 0).toBe(lut[1]! >>> 0); // dirt
        expect(pixels32[2]! >>> 0).toBe(lut[7]! >>> 0); // stone
        expect(pixels32[3]! >>> 0).toBe(lut[1]! >>> 0);
        expect(pixels32[4]! >>> 0).toBe(0);
        expect(pixels32[5]! >>> 0).toBe(lut[5]! >>> 0); // unknown id → magenta
    });

    it('round-trips through a Uint8ClampedArray view as RGBA bytes', () => {
        // Mirror what TerrainRenderer does: ImageData has a
        // Uint8ClampedArray buffer; we view it as Uint32Array for the
        // hot loop. After the loop, the bytes should match RGBA per
        // pixel.
        const bitmap = new Uint8Array([1]); // one dirt pixel
        const buffer = new ArrayBuffer(4);
        const pixels32 = new Uint32Array(buffer);
        const bytes = new Uint8Array(buffer);
        const lut = buildColorLut(new MaterialRegistry([dirt]));
        paintChunkPixels(bitmap, pixels32, lut);
        // dirt 0x8b5a3c → R=0x8b at byte 0, G=0x5a at byte 1, B=0x3c
        // at byte 2, A=0xff at byte 3.
        expect(bytes[0]).toBe(0x8b);
        expect(bytes[1]).toBe(0x5a);
        expect(bytes[2]).toBe(0x3c);
        expect(bytes[3]).toBe(0xff);
    });

    it('handles a 4096-pixel chunk without overflow', () => {
        const bitmap = new Uint8Array(4096).fill(1);
        const pixels32 = new Uint32Array(4096);
        const lut = buildColorLut(new MaterialRegistry([dirt]));
        paintChunkPixels(bitmap, pixels32, lut);
        // All pixels should be the dirt LUT value.
        const expected = lut[1]! >>> 0;
        for (const value of pixels32) {
            expect(value >>> 0).toBe(expected);
        }
    });
});

describe('paintChunkPixels — performance smoke', () => {
    it('completes a 100-iteration 128×128 repaint loop in well under 100 ms', () => {
        // Not a strict perf assertion (CI variance is too high). Just
        // a guard that the hot loop doesn't regress catastrophically.
        // 100 iterations of a 16384-pixel chunk = 1.6M pixel writes;
        // the optimized path runs in low-single-digit ms on a modest
        // dev box.
        const SIZE = 128;
        const PIXELS = SIZE * SIZE;
        const ITERATIONS = 100;
        const bitmap = new Uint8Array(PIXELS);
        for (let i = 0; i < PIXELS; i++) bitmap[i] = (i * 17) % 8 === 0 ? 0 : 1;
        const pixels32 = new Uint32Array(PIXELS);
        const lut = buildColorLut(new MaterialRegistry([dirt]));

        const start = performance.now();
        for (let i = 0; i < ITERATIONS; i++) {
            paintChunkPixels(bitmap, pixels32, lut);
        }
        const elapsed = performance.now() - start;

        // Loose guard: 100ms for 100 iterations = 1ms/iter, way more
        // than the optimized path needs. If we regress past this the
        // test catches it without flaking on CI variance.
        expect(elapsed).toBeLessThan(100);
    });
});
