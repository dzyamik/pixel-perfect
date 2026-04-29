/**
 * Shared structural types for the `pixel-perfect` core module.
 *
 * These types are intentionally framework-agnostic. They form the contract
 * between the bitmap layer (this module) and the physics / Phaser layers
 * that consume contours and chunks.
 */

/**
 * 2D integer point in world or chunk-local coordinates.
 *
 * The coordinate space is determined by the producing function. By
 * convention, marching-squares output and public APIs use world
 * coordinates; internal chunk math may use chunk-local coordinates.
 */
export interface Point {
    /** X coordinate. */
    x: number;
    /** Y coordinate. */
    y: number;
}

/**
 * Description of a material that can occupy a bitmap cell.
 *
 * Material id `0` is reserved for air and is never registered. Registered
 * material ids must be in the range `1..255` so they fit in one byte.
 */
export interface Material {
    /** Stable id stored in the bitmap. Must be in the range 1..255. */
    id: number;
    /** Human-readable name. Used for debugging and material lookup. */
    name: string;
    /** Fallback flat color, packed as `0xRRGGBB`. Used when no texture is set. */
    color: number;
    /** Optional Phaser texture key for tiled rendering. */
    textureKey?: string;
    /** Mass density for derived debris bodies. */
    density: number;
    /** Friction coefficient applied to debris bodies. */
    friction: number;
    /** Restitution (bounciness) applied to debris bodies. */
    restitution: number;
    /** When false, the material cannot be carved (indestructible bedrock). */
    destructible: boolean;
    /** 0..1, scales destruction radius for carve operations on this material. */
    destructionResistance: number;
}

/**
 * A polyline in world coordinates produced by marching squares and/or
 * simplified by Douglas-Peucker.
 *
 * Closed contours connect `points[points.length - 1]` back to `points[0]`
 * implicitly; the closing vertex is not duplicated in the array.
 */
export interface Contour {
    /** Ordered vertices of the polyline. */
    points: Point[];
    /** True if the last and first vertices are joined by an implicit edge. */
    closed: boolean;
}

/**
 * One fixed-size tile of the world bitmap.
 *
 * Chunks are the unit of dirty tracking, GPU texture upload, and Box2D
 * collider rebuild. They are owned by `ChunkedBitmap` and exposed
 * read-mostly to higher layers; only the dirty flags and `contours`
 * cache may be mutated from outside core.
 */
export interface Chunk {
    /** Chunk-grid X coordinate. */
    readonly cx: number;
    /** Chunk-grid Y coordinate. */
    readonly cy: number;
    /** Row-major byte grid of material ids. Length is `chunkSize * chunkSize`. */
    readonly bitmap: Uint8Array;
    /** Set when the chunk's bitmap changed and colliders need rebuild. */
    dirty: boolean;
    /** Set when the chunk's bitmap changed and the visual texture needs upload. */
    visualDirty: boolean;
    /** Cached marching-squares output, or `null` if not yet computed or invalidated. */
    contours: Contour[] | null;
}

/**
 * Result of a raycast or spatial probe against a chunked bitmap.
 *
 * Coordinates are in world (bitmap) space; `distance` is in the same units.
 */
export interface HitResult {
    /** World X of the hit cell. */
    x: number;
    /** World Y of the hit cell. */
    y: number;
    /** Material id of the cell that was hit. */
    materialId: number;
    /** Distance from the ray origin to the hit cell, in world units. */
    distance: number;
}

/**
 * A connected component of solid cells that is not anchored.
 *
 * Produced by flood-fill island detection: solid cells reachable from
 * the anchor set (e.g. the bottom row of the world) are considered part
 * of the static terrain; everything else forms one or more `Island`s
 * that the physics layer can promote into dynamic debris bodies.
 */
export interface Island {
    /** Cells belonging to this island in BFS visitation order. */
    cells: Point[];
    /** Tight bounding box of the island, inclusive on both axes. */
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
}
