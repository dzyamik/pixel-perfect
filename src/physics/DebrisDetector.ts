import { FloodFill } from '../core/index.js';
import type { ChunkedBitmap, Contour, Island } from '../core/index.js';
import { componentToContours } from './ContourExtractor.js';

/** Default anchor: every solid cell on the world's bottom row is static. */
const DEFAULT_ANCHOR: FloodFill.AnchorStrategy = { kind: 'bottomRow' };

/**
 * One detached connected component plus the data needed to convert it
 * into a dynamic Box2D body.
 */
export interface DebrisInfo {
    /** The connected component (cells + bounds) found by flood fill. */
    island: Island;
    /**
     * Contours extracted from the island, with vertices in the source
     * bitmap's world coordinates. Multiple contours appear when an
     * island has holes (donut-shaped debris produces an outer contour
     * plus one inner contour per hole). Closed contours come first.
     */
    contours: Contour[];
    /**
     * Most-frequent material id across the island's cells. Used by the
     * physics adapter to look up density / friction / restitution for
     * the resulting dynamic body.
     */
    dominantMaterial: number;
}

/** Options for {@link detect} and {@link detectAndRemove}. */
export interface DetectOptions {
    /** Flood-fill anchor set. Defaults to `{ kind: 'bottomRow' }`. */
    anchor?: FloodFill.AnchorStrategy;
    /** Douglas-Peucker epsilon (in pixels) for the extracted contours. Default 1. */
    simplificationEpsilon?: number;
}

/**
 * Identifies every connected component of solid cells that is not
 * anchored, extracts its contour(s), and returns them as `DebrisInfo`s.
 *
 * Pure observation: the source bitmap is not modified. Use
 * {@link detectAndRemove} to also carve the debris cells out of the
 * static terrain.
 */
export function detect(bitmap: ChunkedBitmap, options: DetectOptions = {}): DebrisInfo[] {
    const anchor = options.anchor ?? DEFAULT_ANCHOR;
    const epsilon = options.simplificationEpsilon ?? 1;

    const islands = FloodFill.findIslands(bitmap, anchor);
    return islands.map((island) => ({
        island,
        contours: componentToContours(island, bitmap, epsilon),
        dominantMaterial: dominantMaterial(island, bitmap),
    }));
}

/**
 * Same as {@link detect}, but additionally writes `0` (air) to every
 * detected debris cell in the source bitmap. The cells' chunks are
 * dirtied so the next collider rebuild reflects the carved state.
 *
 * The contour and material info captured in each `DebrisInfo` is taken
 * before the carve, so callers can reliably use it to spawn replacement
 * dynamic bodies without re-sampling.
 */
export function detectAndRemove(
    bitmap: ChunkedBitmap,
    options: DetectOptions = {},
): DebrisInfo[] {
    const debris = detect(bitmap, options);
    for (const info of debris) {
        for (const cell of info.island.cells) {
            bitmap.setPixel(cell.x, cell.y, 0);
        }
    }
    return debris;
}

function dominantMaterial(island: Island, bitmap: ChunkedBitmap): number {
    const counts = new Map<number, number>();
    for (const cell of island.cells) {
        const m = bitmap.getPixel(cell.x, cell.y);
        if (m === 0) continue;
        counts.set(m, (counts.get(m) ?? 0) + 1);
    }
    let bestId = 0;
    let bestCount = 0;
    for (const [id, count] of counts) {
        if (count > bestCount) {
            bestId = id;
            bestCount = count;
        }
    }
    return bestId;
}
