import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import * as Carve from '../../../src/core/ops/Carve.js';
import * as Deposit from '../../../src/core/ops/Deposit.js';
import type { AlphaSource } from '../../../src/core/ops/raster.js';

/** Build a `width x height` AlphaSource. `alphaAt(sx, sy)` returns 0..255. */
function makeSource(
    width: number,
    height: number,
    alphaAt: (sx: number, sy: number) => number,
): AlphaSource {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            data[i + 3] = alphaAt(x, y);
        }
    }
    return { data, width, height };
}

describe('Deposit.fromAlphaTexture', () => {
    it('stamps a fully-opaque source rectangle as a solid block', () => {
        const bitmap = new ChunkedBitmap({ width: 16, height: 16, chunkSize: 16 });
        const src = makeSource(4, 4, () => 255);
        Deposit.fromAlphaTexture(bitmap, src, 5, 5, 1);
        // Every cell in the 4x4 region at (5,5) is now material 1.
        for (let y = 5; y < 9; y++) {
            for (let x = 5; x < 9; x++) {
                expect(bitmap.getPixel(x, y)).toBe(1);
            }
        }
        // Cells outside the stamp untouched.
        expect(bitmap.getPixel(4, 5)).toBe(0);
        expect(bitmap.getPixel(9, 5)).toBe(0);
    });

    it('only writes cells whose source alpha is ≥ threshold', () => {
        const bitmap = new ChunkedBitmap({ width: 16, height: 16, chunkSize: 16 });
        // Checkerboard alpha: x+y even → 200, odd → 50.
        const src = makeSource(4, 4, (x, y) => ((x + y) % 2 === 0 ? 200 : 50));
        Deposit.fromAlphaTexture(bitmap, src, 0, 0, 1, 100);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                const expected = (x + y) % 2 === 0 ? 1 : 0;
                expect(bitmap.getPixel(x, y)).toBe(expected);
            }
        }
    });

    it('default threshold = 128', () => {
        const bitmap = new ChunkedBitmap({ width: 16, height: 16, chunkSize: 16 });
        const src = makeSource(2, 1, (x) => (x === 0 ? 127 : 128));
        Deposit.fromAlphaTexture(bitmap, src, 0, 0, 1);
        expect(bitmap.getPixel(0, 0)).toBe(0); // alpha 127 < 128
        expect(bitmap.getPixel(1, 0)).toBe(1); // alpha 128 == threshold
    });

    it('clips a source that overhangs the world edges', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        const src = makeSource(4, 4, () => 255);
        // dst (-2, -2): only the lower-right 2x2 of the source falls in the bitmap.
        Deposit.fromAlphaTexture(bitmap, src, -2, -2, 1);
        expect(bitmap.getPixel(0, 0)).toBe(1);
        expect(bitmap.getPixel(1, 1)).toBe(1);
        expect(bitmap.getPixel(2, 2)).toBe(0); // outside the clipped region

        // dst (7, 7): only the top-left 1x1 falls in.
        const bitmap2 = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        Deposit.fromAlphaTexture(bitmap2, src, 7, 7, 2);
        expect(bitmap2.getPixel(7, 7)).toBe(2);
        expect(bitmap2.getPixel(6, 6)).toBe(0);
    });

    it('is a no-op when the source is entirely outside the bitmap', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        const src = makeSource(4, 4, () => 255);
        Deposit.fromAlphaTexture(bitmap, src, 100, 100, 1);
        Deposit.fromAlphaTexture(bitmap, src, -10, -10, 1);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                expect(bitmap.getPixel(x, y)).toBe(0);
            }
        }
    });

    it('is a no-op for a zero-sized source', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        const empty: AlphaSource = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
        expect(() => Deposit.fromAlphaTexture(bitmap, empty, 0, 0, 1)).not.toThrow();
    });

    it('rejects material ids outside 0..255 (via setPixel)', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        const src = makeSource(2, 2, () => 255);
        expect(() => Deposit.fromAlphaTexture(bitmap, src, 0, 0, 256)).toThrow();
    });
});

describe('Carve.fromAlphaTexture', () => {
    it('clears solid bitmap cells where the source is opaque', () => {
        const bitmap = new ChunkedBitmap({ width: 8, height: 8, chunkSize: 8 });
        // Pre-fill a 4x4 solid block.
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) bitmap.setPixel(x, y, 1);

        // Carve a 2x2 hole using fromAlphaTexture.
        const src = makeSource(2, 2, () => 255);
        Carve.fromAlphaTexture(bitmap, src, 1, 1);

        expect(bitmap.getPixel(0, 0)).toBe(1);
        expect(bitmap.getPixel(1, 1)).toBe(0); // carved
        expect(bitmap.getPixel(2, 2)).toBe(0); // carved
        expect(bitmap.getPixel(3, 3)).toBe(1);
    });

    it('respects the threshold parameter', () => {
        const bitmap = new ChunkedBitmap({ width: 4, height: 4, chunkSize: 4 });
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) bitmap.setPixel(x, y, 1);
        // Source: alpha 50 everywhere.
        const src = makeSource(4, 4, () => 50);
        // Threshold 100: source alpha 50 < 100 → no carve.
        Carve.fromAlphaTexture(bitmap, src, 0, 0, 100);
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 4; x++) {
                expect(bitmap.getPixel(x, y)).toBe(1);
            }
        }
    });
});
