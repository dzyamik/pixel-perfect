import { describe, expect, it } from 'vitest';
import { ChunkedBitmap } from '../../../src/core/ChunkedBitmap.js';
import {
    alphaSourceToMask,
    maskBitmapOverlap,
    maskBitmapOverlapTransformed,
    maskMaskOverlap,
    maskMaskOverlapTransformed,
    maskToContours,
    transformedMaskBounds,
} from '../../../src/core/queries/AlphaOverlap.js';
import type {
    AlphaMask,
    MaskTransform,
} from '../../../src/core/queries/AlphaOverlap.js';

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

describe('maskToContours', () => {
    it('returns no contours for a fully-transparent mask', () => {
        const mask = gridMask(['000', '000', '000']);
        expect(maskToContours(mask)).toEqual([]);
    });

    it('returns one closed contour for a single solid blob', () => {
        // 4x4 solid square in the middle of an 8x8 mask.
        const rows = ['00000000'];
        for (let i = 0; i < 4; i++) rows.push('00111100');
        rows.push('00000000');
        rows.push('00000000');
        rows.push('00000000');
        const mask = gridMask(rows);
        const contours = maskToContours(mask, 0);
        expect(contours).toHaveLength(1);
        expect(contours[0]!.closed).toBe(true);
        // After Douglas-Peucker with epsilon 0 the marching-squares
        // vertices are preserved; a 4x4 axis-aligned square emits at
        // least 4 corner vertices.
        expect(contours[0]!.points.length).toBeGreaterThanOrEqual(4);
    });

    it('returns multiple contours for two disjoint blobs', () => {
        const mask = gridMask([
            '11000011',
            '11000011',
            '00000000',
            '00000000',
            '11000011',
            '11000011',
        ]);
        const contours = maskToContours(mask);
        // Four 2x2 corner blobs → four closed contours.
        expect(contours.length).toBe(4);
        for (const c of contours) expect(c.closed).toBe(true);
    });

    it('coordinates are mask-local (no padding leakage)', () => {
        // Solid cell at exactly (0, 0) of the mask. With 1 px air
        // padding internally, the contour around that cell touches
        // mask-local (0, 0) and (1, 1) corners.
        const mask = gridMask(['100', '000', '000']);
        const contours = maskToContours(mask, 0);
        expect(contours).toHaveLength(1);
        const points = contours[0]!.points;
        const minX = Math.min(...points.map((p) => p.x));
        const minY = Math.min(...points.map((p) => p.y));
        const maxX = Math.max(...points.map((p) => p.x));
        const maxY = Math.max(...points.map((p) => p.y));
        expect(minX).toBeGreaterThanOrEqual(-0.5); // half-pixel margin from MS
        expect(minY).toBeGreaterThanOrEqual(-0.5);
        expect(maxX).toBeLessThanOrEqual(1.5);
        expect(maxY).toBeLessThanOrEqual(1.5);
    });
});

describe('transformedMaskBounds', () => {
    it('returns the axis-aligned rect for an unrotated transform', () => {
        const mask = gridMask(['11', '11']);
        const aabb = transformedMaskBounds(mask, { x: 10, y: 20 });
        expect(aabb.minX).toBe(10);
        expect(aabb.minY).toBe(20);
        expect(aabb.maxX).toBe(12);
        expect(aabb.maxY).toBe(22);
    });

    it('expands the AABB when rotated 45° around the center', () => {
        // 4x4 mask rotated 45° around its center has an AABB of side
        // 4 * sqrt(2) ≈ 5.66.
        const mask = gridMask(['1111', '1111', '1111', '1111']);
        const aabb = transformedMaskBounds(mask, {
            x: 0,
            y: 0,
            pivotX: 2,
            pivotY: 2,
            rotation: Math.PI / 4,
        });
        const w = aabb.maxX - aabb.minX;
        const h = aabb.maxY - aabb.minY;
        expect(w).toBeCloseTo(4 * Math.SQRT2, 5);
        expect(h).toBeCloseTo(4 * Math.SQRT2, 5);
    });

    it('rotates 90° CCW correctly (in screen y-down convention)', () => {
        // 4x2 mask with pivot at (0,0). 90° rotation maps the mask's
        // local +x axis to the scene's +y axis (sin(π/2) = 1 lands on
        // sy from sx in the transform formula).
        const mask = gridMask(['1111', '1111']);
        const aabb = transformedMaskBounds(mask, {
            x: 0,
            y: 0,
            pivotX: 0,
            pivotY: 0,
            rotation: Math.PI / 2,
        });
        // Width 4 in mask → height 4 in scene.
        // Height 2 in mask → width 2 in scene (with negation due to
        // y-down: it lands on the -x side from the pivot).
        const w = aabb.maxX - aabb.minX;
        const h = aabb.maxY - aabb.minY;
        expect(w).toBeCloseTo(2, 5);
        expect(h).toBeCloseTo(4, 5);
    });
});

describe('maskMaskOverlapTransformed', () => {
    it('matches the axis-aligned overlap for identity transforms', () => {
        const a = gridMask(['1111', '1111', '1111', '1111']);
        const b = gridMask(['1111', '1111', '1111', '1111']);
        const ta: MaskTransform = { x: 0, y: 0 };
        const tb: MaskTransform = { x: 2, y: 2 };
        const expected = maskMaskOverlap(a, ta.x, ta.y, b, tb.x, tb.y);
        expect(maskMaskOverlapTransformed(a, ta, b, tb)).toBe(expected);
    });

    it('returns false when rotated AABBs do not overlap', () => {
        const a = gridMask(['1111', '1111', '1111', '1111']);
        const b = gridMask(['1111', '1111', '1111', '1111']);
        const ta: MaskTransform = {
            x: 0,
            y: 0,
            pivotX: 2,
            pivotY: 2,
            rotation: Math.PI / 4,
        };
        const tb: MaskTransform = {
            x: 100,
            y: 100,
            pivotX: 2,
            pivotY: 2,
            rotation: Math.PI / 4,
        };
        expect(maskMaskOverlapTransformed(a, ta, b, tb)).toBe(false);
    });

    it('detects overlap of two rotated masks at a shared point', () => {
        // Two 6x2 horizontal bars; rotate one by 90° so it becomes
        // a vertical bar. Place them so they cross at the origin.
        const bar = gridMask(['111111', '111111']);
        const horizontal: MaskTransform = { x: -3, y: -1 };
        const vertical: MaskTransform = {
            x: 0,
            y: 0,
            pivotX: 3,
            pivotY: 1,
            rotation: Math.PI / 2,
        };
        expect(maskMaskOverlapTransformed(bar, horizontal, bar, vertical)).toBe(true);
    });

    it('a 180° rotation around the center is geometrically a noop for a symmetric mask', () => {
        const a = gridMask(['1111', '1111', '1111', '1111']);
        const ta: MaskTransform = { x: 5, y: 5 };
        const tbBase: MaskTransform = { x: 7, y: 5 };
        const tbRotated: MaskTransform = {
            x: 7 + 2,
            y: 5 + 2,
            pivotX: 2,
            pivotY: 2,
            rotation: Math.PI,
        };
        const expected = maskMaskOverlapTransformed(a, ta, a, tbBase);
        expect(maskMaskOverlapTransformed(a, ta, a, tbRotated)).toBe(expected);
    });
});

describe('maskBitmapOverlapTransformed', () => {
    it('matches the axis-aligned bitmap overlap for an identity transform', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        bitmap.setPixel(10, 10, 1);
        const mask = gridMask(['1']);
        const t: MaskTransform = { x: 10, y: 10 };
        expect(maskBitmapOverlapTransformed(mask, t, bitmap)).toBe(
            maskBitmapOverlap(mask, 10, 10, bitmap),
        );
    });

    it('rotated mask still hits when its solid pixel covers a bitmap solid cell', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        // Solid 4×4 block in the bitmap at (8..11, 10..13) so we have
        // a target zone bigger than a single pixel.
        for (let y = 10; y < 14; y++) {
            for (let x = 8; x < 12; x++) bitmap.setPixel(x, y, 1);
        }
        // 4×1 mask, all solid. Rotated 90° around mask-local (0, 0)
        // and placed with the pivot at scene (10, 10), the mask's
        // unit-thick body extends along x=9 from sy=10..13 — well
        // inside the bitmap solid block.
        const mask = gridMask(['1111']);
        const t: MaskTransform = {
            x: 10,
            y: 10,
            pivotX: 0,
            pivotY: 0,
            rotation: Math.PI / 2,
        };
        expect(maskBitmapOverlapTransformed(mask, t, bitmap)).toBe(true);
    });

    it('returns false when the rotated mask aims away from solid cells', () => {
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        bitmap.setPixel(20, 20, 1);
        const mask = gridMask(['1']);
        const t: MaskTransform = {
            x: 5,
            y: 5,
            pivotX: 0,
            pivotY: 0,
            rotation: Math.PI / 4,
        };
        expect(maskBitmapOverlapTransformed(mask, t, bitmap)).toBe(false);
    });
});
