import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import {
    alphaSourceToMask,
    maskBitmapOverlap,
    maskMaskOverlap,
} from '../../../src/core/queries/AlphaOverlap.js';
import type { AlphaMask } from '../../../src/core/queries/AlphaOverlap.js';

/** Build a tiny mask from a `0`/`1` grid string for readable test setup. */
function gridMask(rows: string[]): AlphaMask {
    const height = rows.length;
    const width = rows[0]!.length;
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
        const row = rows[y]!;
        for (let x = 0; x < width; x++) {
            data[y * width + x] = row[x] === '1' ? 1 : 0;
        }
    }
    return { data, width, height };
}

describe('alphaSourceToMask', () => {
    it('thresholds an RGBA buffer at the default 128', () => {
        // 2x1 source: pixel 0 alpha 200 (solid), pixel 1 alpha 50 (transparent).
        const data = new Uint8ClampedArray([0, 0, 0, 200, 0, 0, 0, 50]);
        const mask = alphaSourceToMask({ data, width: 2, height: 1 });
        expect(Array.from(mask.data)).toEqual([1, 0]);
    });

    it('respects a custom threshold', () => {
        const data = new Uint8ClampedArray([0, 0, 0, 100, 0, 0, 0, 200]);
        const masked50 = alphaSourceToMask({ data, width: 2, height: 1 }, 50);
        const masked150 = alphaSourceToMask({ data, width: 2, height: 1 }, 150);
        expect(Array.from(masked50.data)).toEqual([1, 1]);
        expect(Array.from(masked150.data)).toEqual([0, 1]);
    });

    it('produces a mask with the same width and height as the source', () => {
        const data = new Uint8ClampedArray(8 * 4);
        const mask = alphaSourceToMask({ data, width: 4, height: 2 });
        expect(mask.width).toBe(4);
        expect(mask.height).toBe(2);
        expect(mask.data.length).toBe(8);
    });

    it('treats fully-transparent pixels as 0 and fully-opaque as 1', () => {
        const data = new Uint8ClampedArray([
            255, 255, 255, 255, // opaque white
            0, 0, 0, 0, // fully transparent
        ]);
        const mask = alphaSourceToMask({ data, width: 2, height: 1 });
        expect(Array.from(mask.data)).toEqual([1, 0]);
    });
});

describe('maskMaskOverlap', () => {
    it('returns false for fully disjoint AABBs (early cull)', () => {
        const a = gridMask(['1']);
        const b = gridMask(['1']);
        expect(maskMaskOverlap(a, 0, 0, b, 10, 10)).toBe(false);
    });

    it('returns true when a single solid pixel of each lines up', () => {
        const a = gridMask(['1']);
        const b = gridMask(['1']);
        expect(maskMaskOverlap(a, 5, 5, b, 5, 5)).toBe(true);
    });

    it('returns false when AABBs overlap but the solid pixels do not', () => {
        // 2x2 each, solid pixels in opposite corners.
        // aTR has solid only at (1, 0) (top-right).
        // bBL has solid only at (0, 1) (bottom-left).
        // Place aTR at (0, 0) and bBL at (-1, -1):
        //   AABB overlap region is the 1x1 pixel at world (0, 0).
        //   aTR's local (0, 0) = transparent.
        //   bBL's local (1, 1) = transparent.
        //   No solid coincidence in the overlap → false.
        const aTR = gridMask(['01', '00']);
        const bBL = gridMask(['00', '10']);
        expect(maskMaskOverlap(aTR, 0, 0, bBL, -1, -1)).toBe(false);
    });

    it('returns true when the masks fully overlap and both are fully solid', () => {
        const a = gridMask(['111', '111', '111']);
        const b = gridMask(['111', '111', '111']);
        expect(maskMaskOverlap(a, 0, 0, b, 0, 0)).toBe(true);
    });

    it('handles partial AABB overlap with solid pixels in the overlap region', () => {
        // 4x4 each, partial overlap.
        const a = gridMask(['1111', '1111', '1111', '1111']);
        const b = gridMask(['1111', '1111', '1111', '1111']);
        // a at (0,0), b at (2,2): overlap rect (2..3, 2..3) = 2x2 pixels, all solid.
        expect(maskMaskOverlap(a, 0, 0, b, 2, 2)).toBe(true);
    });

    it('handles checkerboard masks where AABBs overlap but solids alternate', () => {
        const checker1 = gridMask(['10', '01']);
        const checker2 = gridMask(['01', '10']);
        // Same position → solids never align (full alternation).
        expect(maskMaskOverlap(checker1, 0, 0, checker2, 0, 0)).toBe(false);
    });

    it('mirrors are commutative (AB) ↔ (BA)', () => {
        const a = gridMask(['10', '11']);
        const b = gridMask(['01', '11']);
        expect(maskMaskOverlap(a, 3, 4, b, 4, 5)).toBe(maskMaskOverlap(b, 4, 5, a, 3, 4));
    });
});

describe('maskBitmapOverlap', () => {
    it('returns false for a sprite floating in air over an empty bitmap', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        const mask = gridMask(['1111', '1111', '1111', '1111']);
        expect(maskBitmapOverlap(mask, 5, 5, bitmap)).toBe(false);
    });

    it('returns true when a solid mask pixel lands on a solid bitmap cell', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1);
        const mask = gridMask(['1']);
        expect(maskBitmapOverlap(mask, 10, 10, bitmap)).toBe(true);
    });

    it('returns false when the mask is solid but the bitmap region beneath is air', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        // Solid block far from the mask placement.
        for (let x = 20; x < 25; x++) for (let y = 20; y < 25; y++) bitmap.setPixel(x, y, 1);
        const mask = gridMask(['11', '11']);
        expect(maskBitmapOverlap(mask, 0, 0, bitmap)).toBe(false);
    });

    it('skips transparent mask pixels even if the bitmap below is solid', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        // 2x2 solid block in bitmap.
        bitmap.setPixel(5, 5, 1);
        bitmap.setPixel(6, 5, 1);
        bitmap.setPixel(5, 6, 1);
        bitmap.setPixel(6, 6, 1);
        // Mask whose only solid pixel is at (1, 1) — that lands at bitmap (6, 6).
        const mask = gridMask(['00', '01']);
        expect(maskBitmapOverlap(mask, 5, 5, bitmap)).toBe(true);
        // Move the mask one pixel up-left so its solid pixel lands at bitmap (5, 5).
        expect(maskBitmapOverlap(mask, 4, 4, bitmap)).toBe(true);
        // Move it so the solid pixel lands in air at (10, 10).
        expect(maskBitmapOverlap(mask, 9, 9, bitmap)).toBe(false);
    });

    it('treats out-of-bounds mask placements as air (no false positive)', () => {
        const bitmap = new ChunkedBitmap({ width: 16, height: 16, chunkSize: 16 });
        bitmap.setPixel(0, 0, 1); // single solid cell at origin
        const mask = gridMask(['1']);
        // Mask placed entirely off the world (negative coords).
        expect(maskBitmapOverlap(mask, -100, -100, bitmap)).toBe(false);
        // Mask placed past the world's far corner.
        expect(maskBitmapOverlap(mask, 1000, 1000, bitmap)).toBe(false);
    });
});
