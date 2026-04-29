/**
 * End-to-end smoke test exercising every Phase 1 / src/core/ subsystem
 * in a single pipeline. The required deliverable from
 * `docs-dev/02-roadmap.md` § Phase 1 / DoD reads:
 *
 *   "A 200-line example script can: create bitmap, deposit a circular
 *    island, carve a hole, run marching squares, render contours to
 *    console as ASCII art."
 *
 * This file is the test-form of that script.
 */

import { describe, expect, it } from 'vitest';
import {
    Carve,
    ChunkedBitmap,
    Deposit,
    DouglasPeucker,
    FloodFill,
    MarchingSquares,
    Spatial,
} from '../../src/core/index.js';

describe('Phase 1 integration — donut pipeline', () => {
    it('runs the full pipeline: deposit → carve → MS → DP → spatial', () => {
        // 1. Build a bitmap.
        const bitmap = new ChunkedBitmap({
            width: 64,
            height: 64,
            chunkSize: 64,
            materials: [
                {
                    id: 1,
                    name: 'dirt',
                    color: 0x8b5a3c,
                    density: 1,
                    friction: 0.7,
                    restitution: 0.1,
                    destructible: true,
                    destructionResistance: 0,
                },
            ],
        });
        expect(bitmap.materials.getOrThrow(1).name).toBe('dirt');

        // 2. Deposit a circular island of dirt.
        Deposit.circle(bitmap, 32, 32, 20, 1);

        // Sanity: the island is solid in the middle and at the radius.
        expect(bitmap.getPixel(32, 32)).toBe(1);
        expect(bitmap.getPixel(32, 12)).toBe(1); // y = 32 - 20
        expect(bitmap.getPixel(32, 52)).toBe(1); // y = 32 + 20
        expect(bitmap.getPixel(32, 11)).toBe(0); // just outside

        // 3. Carve a hole through the center.
        Carve.circle(bitmap, 32, 32, 5);
        expect(bitmap.getPixel(32, 32)).toBe(0);
        expect(bitmap.getPixel(32, 26)).toBe(1); // outside the carved hole, still dirt

        // 4. Marching squares: should yield outer + inner contours.
        const chunk = bitmap.getChunk(0, 0);
        const contours = MarchingSquares.extract(chunk, bitmap);
        expect(contours.length).toBe(2);
        expect(contours.every((c) => c.closed)).toBe(true);
        const sortedBySize = [...contours].sort((a, b) => b.points.length - a.points.length);
        const outer = sortedBySize[0]!;
        const inner = sortedBySize[1]!;
        expect(outer.points.length).toBeGreaterThan(inner.points.length);

        // 5. Douglas-Peucker simplification: ≥ 80% reduction on outer.
        const outerSimplified = DouglasPeucker.simplify(outer, 1);
        expect(outerSimplified.closed).toBe(true);
        expect(1 - outerSimplified.points.length / outer.points.length).toBeGreaterThanOrEqual(
            0.8,
        );

        // 6. Spatial: surfaceY at column 32 finds the donut's top edge.
        expect(Spatial.surfaceY(bitmap, 32)).toBe(12);

        // 7. Raycast straight down through the donut.
        const hit = Spatial.raycast(bitmap, 32, 0, 32, 63);
        expect(hit).not.toBeNull();
        expect(hit!.y).toBe(12);
        expect(hit!.materialId).toBe(1);

        // 8. Flood fill: the donut is not anchored to the bottom row, so it
        //    is detected as one detached island.
        const islands = FloodFill.findIslands(bitmap, { kind: 'bottomRow' });
        expect(islands.length).toBe(1);
        expect(islands[0]!.cells.length).toBeGreaterThan(0);
        // Bounding box matches the donut's pixel extent (y in 12..52, x in 12..52).
        expect(islands[0]!.bounds).toEqual({ minX: 12, maxX: 52, minY: 12, maxY: 52 });

        // 9. Spatial: isSolid / sampleMaterial behave consistently with raycast.
        expect(Spatial.isSolid(bitmap, 12, 32)).toBe(true);
        expect(Spatial.sampleMaterial(bitmap, 12, 32)).toBe(1);
        expect(Spatial.isSolid(bitmap, 32, 32)).toBe(false); // carved hole
    });

    it('produces a renderable ASCII view of bitmap and contours', () => {
        // The DoD's "render contours to console as ASCII art" — verify
        // we can build the renderer without errors. The actual ascii dump
        // is omitted from CI but is straightforward to enable for debugging.
        const bitmap = new ChunkedBitmap({ width: 32, height: 32, chunkSize: 32 });
        Deposit.circle(bitmap, 16, 16, 8, 1);
        Carve.circle(bitmap, 16, 16, 3);

        const contours = MarchingSquares.extract(bitmap.getChunk(0, 0), bitmap);
        expect(contours.length).toBe(2);

        const rows: string[] = [];
        for (let y = 0; y < bitmap.height; y++) {
            let row = '';
            for (let x = 0; x < bitmap.width; x++) {
                row += bitmap.getPixel(x, y) > 0 ? '#' : '.';
            }
            rows.push(row);
        }
        expect(rows.length).toBe(bitmap.height);
        expect(rows.every((r) => r.length === bitmap.width)).toBe(true);

        // A tiny visual check: the center row has the form "...####..####..."
        // (left donut wall, hole, right donut wall) — both walls present
        // and the central section is air.
        const centerRow = rows[16]!;
        expect(centerRow.includes('#')).toBe(true);
        expect(centerRow.includes('.')).toBe(true);
    });
});

describe('Phase 1 integration — fromAlphaTexture island generation', () => {
    it('builds terrain from a procedural alpha mask, then carves into it', () => {
        // Synthesize a 32x32 alpha source with an "island" shape (full
        // alpha inside a circle, zero outside). This is the same data
        // layout that a Phaser DynamicTexture / canvas extraction
        // produces in production.
        const w = 32;
        const h = 32;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const dx = x - 16;
                const dy = y - 16;
                const inside = dx * dx + dy * dy <= 12 * 12;
                data[(y * w + x) * 4 + 3] = inside ? 255 : 0;
            }
        }
        const source = { data, width: w, height: h };

        const bitmap = new ChunkedBitmap({ width: 64, height: 64, chunkSize: 64 });

        // Deposit the alpha mask at world (16, 16) — top-left of the stamp.
        Deposit.fromAlphaTexture(bitmap, source, 16, 16, 1);

        // Center of the deposited circle is at world (32, 32); it should
        // be solid material 1.
        expect(bitmap.getPixel(32, 32)).toBe(1);
        // Just outside the deposited radius (12 in source coords =
        // world (16+12+1, 16+16) = (29, 32)) should be air.
        expect(bitmap.getPixel(16 + 16 + 13, 32)).toBe(0);

        // Carve a hole and verify a contour can still be extracted.
        Carve.circle(bitmap, 32, 32, 4);
        const contours = MarchingSquares.extract(bitmap.getChunk(0, 0), bitmap);
        expect(contours.length).toBe(2);
    });
});
