import type { Chunk, Contour, Material } from '../core/index.js';
import {
    b2BodyType,
    b2CreateBody,
    b2DefaultBodyDef,
    b2DestroyBody,
} from './box2d.js';
import { contourToChain, contourToPolygon } from './ContourToBody.js';
import type { BodyId, WorldId } from './types.js';

export interface Box2DAdapterOptions {
    /** The Box2D world this adapter creates bodies in. */
    worldId: WorldId;
    /** Pixel-to-meter conversion factor. Default is 32 (Phaser Box2D convention). */
    pixelsPerMeter?: number;
    /** Default friction for terrain chain shapes (overridable per material). */
    defaultTerrainFriction?: number;
    /** Default restitution for terrain chain shapes. */
    defaultTerrainRestitution?: number;
}

/**
 * Owns the lifecycle of Box2D bodies derived from `ChunkedBitmap` data.
 *
 * Two body categories are managed here:
 *
 *  - **Terrain bodies** — one static `b2Body` per chunk, with one or more
 *    `b2ChainShape`s attached (one per contour). Created and destroyed
 *    via {@link Box2DAdapter.rebuildChunk} / `destroyChunk`. Tracked
 *    internally in a `Map<Chunk, BodyId>`.
 *  - **Debris bodies** — dynamic bodies, one shape each. Created via
 *    {@link Box2DAdapter.createDebrisBody}; the caller owns the returned
 *    handle and is responsible for `destroyBody` (typically when the
 *    debris settles or leaves the world).
 *
 * Per CLAUDE.md hard rule #3 the adapter must NOT be invoked from inside
 * a Box2D step. The intended caller is the {@link DeferredRebuildQueue},
 * drained at end-of-frame.
 */
export class Box2DAdapter {
    private readonly worldId: WorldId;
    private readonly pixelsPerMeter: number;
    private readonly defaultTerrainFriction: number;
    private readonly defaultTerrainRestitution: number;
    private readonly chunkBodies = new Map<Chunk, BodyId>();

    constructor(options: Box2DAdapterOptions) {
        this.worldId = options.worldId;
        this.pixelsPerMeter = options.pixelsPerMeter ?? 32;
        this.defaultTerrainFriction = options.defaultTerrainFriction ?? 0.7;
        this.defaultTerrainRestitution = options.defaultTerrainRestitution ?? 0;
    }

    /**
     * Replaces the chunk's terrain body with a fresh static body whose
     * chain shapes match the supplied contours.
     *
     * The previous body (if any) is destroyed first; pass an empty list
     * to clear the chunk entirely. Contours that would produce
     * insufficient-vertex chains (closed < 3, open < 4) are silently
     * skipped. If no contour was valid, no body is created and the map
     * entry is cleared.
     */
    rebuildChunk(chunk: Chunk, contours: readonly Contour[]): void {
        const existing = this.chunkBodies.get(chunk);
        if (existing !== undefined) {
            b2DestroyBody(existing);
            this.chunkBodies.delete(chunk);
        }
        if (contours.length === 0) return;

        const bodyDef = b2DefaultBodyDef();
        bodyDef.type = b2BodyType.b2_staticBody;
        const bodyId = b2CreateBody(this.worldId, bodyDef);

        let attached = 0;
        for (const contour of contours) {
            const chainId = contourToChain(bodyId, contour, {
                pixelsPerMeter: this.pixelsPerMeter,
                friction: this.defaultTerrainFriction,
                restitution: this.defaultTerrainRestitution,
            });
            if (chainId !== null) attached++;
        }

        if (attached === 0) {
            // Every contour was rejected (e.g., all degenerate); leave the
            // body slot clean.
            b2DestroyBody(bodyId);
            return;
        }

        this.chunkBodies.set(chunk, bodyId);
    }

    /**
     * Destroys the chunk's terrain body and removes the map entry.
     * No-op if the chunk has no body.
     */
    destroyChunk(chunk: Chunk): void {
        const bodyId = this.chunkBodies.get(chunk);
        if (bodyId === undefined) return;
        b2DestroyBody(bodyId);
        this.chunkBodies.delete(chunk);
    }

    /** Returns the chunk's current terrain body, or `null` if none. */
    getChunkBody(chunk: Chunk): BodyId | null {
        return this.chunkBodies.get(chunk) ?? null;
    }

    /**
     * Iterates the chunks that currently have a terrain body. Used by the
     * deferred queue to find bodies that should be destroyed when their
     * chunk no longer hosts any contours after a global rebuild.
     */
    trackedChunks(): Iterable<Chunk> {
        return this.chunkBodies.keys();
    }

    /**
     * Creates a dynamic body for a detached island contour.
     *
     * Tries `b2PolygonShape` first (for convex contours with ≤ 8
     * vertices); falls back to a closed `b2ChainShape` for everything
     * else. Returns `null` if the contour is too small to form any
     * shape (< 3 vertices for a closed contour).
     *
     * The body's COM is set to the centroid of the input contour and the
     * shape vertices are translated to body-local space; this is what
     * makes the debris rotate naturally about its own center under gravity.
     */
    createDebrisBody(contour: Contour, material: Material): BodyId | null {
        if (contour.points.length < 3) return null;

        // Compute centroid (in pixels). Plain average — fine for chunks of
        // pixels with roughly uniform vertex density. A future v1.1
        // could use the area-weighted centroid for asymmetric shapes.
        let sumX = 0;
        let sumY = 0;
        for (const p of contour.points) {
            sumX += p.x;
            sumY += p.y;
        }
        const cx = sumX / contour.points.length;
        const cy = sumY / contour.points.length;

        // Translate the contour into body-local pixel space.
        const localContour: Contour = {
            points: contour.points.map((p) => ({ x: p.x - cx, y: p.y - cy })),
            closed: contour.closed,
        };

        const bodyDef = b2DefaultBodyDef();
        bodyDef.type = b2BodyType.b2_dynamicBody;
        // Position is in meters with y-flip (screen y-down → Box2D y-up).
        bodyDef.position.x = cx / this.pixelsPerMeter;
        bodyDef.position.y = -cy / this.pixelsPerMeter;
        const bodyId = b2CreateBody(this.worldId, bodyDef);

        const polygonId = contourToPolygon(bodyId, localContour, {
            pixelsPerMeter: this.pixelsPerMeter,
            density: material.density,
            friction: material.friction,
            restitution: material.restitution,
        });
        if (polygonId !== null) return bodyId;

        const chainId = contourToChain(bodyId, localContour, {
            pixelsPerMeter: this.pixelsPerMeter,
            friction: material.friction,
            restitution: material.restitution,
        });
        if (chainId === null) {
            // Contour was too degenerate for any shape — clean up.
            b2DestroyBody(bodyId);
            return null;
        }
        return bodyId;
    }

    /** Destroys a body the adapter previously created. */
    destroyBody(bodyId: BodyId): void {
        b2DestroyBody(bodyId);
    }

    /**
     * Destroys every chunk body the adapter still holds and clears the
     * internal map. Call this when the owning terrain GameObject is
     * destroyed; unattached debris bodies (created via
     * {@link createDebrisBody}) are not tracked here and must be cleaned
     * up by the caller.
     */
    dispose(): void {
        for (const bodyId of this.chunkBodies.values()) {
            b2DestroyBody(bodyId);
        }
        this.chunkBodies.clear();
    }
}
