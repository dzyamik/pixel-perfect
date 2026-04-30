import type { Chunk, Contour, Material } from '../core/index.js';
import {
    b2AABB,
    b2BodyType,
    b2Body_GetAngularVelocity,
    b2Body_GetLinearVelocity,
    b2Body_GetTransform,
    b2Body_GetType,
    b2Body_IsAwake,
    b2Body_SetAngularVelocity,
    b2Body_SetAwake,
    b2Body_SetLinearVelocity,
    b2Body_SetTransform,
    b2CreateBody,
    b2DefaultBodyDef,
    b2DefaultQueryFilter,
    b2DestroyBody,
    b2Shape_GetBody,
    b2Vec2,
    b2World_OverlapAABB,
} from './box2d.js';
import { contourToTriangles } from './ContourToBody.js';
import type { BodyId, WorldId } from './types.js';

/**
 * A frozen copy of one dynamic body's kinematic state at a moment in
 * time. Returned by {@link Box2DAdapter.snapshotDynamicBodies} and
 * consumed by {@link Box2DAdapter.restoreDynamicBodies}.
 *
 * The snapshot is intentionally narrow — only the state that is clobbered
 * when a contact is destroyed and re-resolved across a rebuild. Mass,
 * shapes, joints, etc. are left alone.
 */
export interface BodySnapshot {
    bodyId: BodyId;
    px: number;
    py: number;
    rc: number;
    rs: number;
    vx: number;
    vy: number;
    omega: number;
    awake: boolean;
}

export interface Box2DAdapterOptions {
    /** The Box2D world this adapter creates bodies in. */
    worldId: WorldId;
    /** Pixel-to-meter conversion factor. Default is 32 (Phaser Box2D convention). */
    pixelsPerMeter?: number;
    /**
     * Scene-space pixel offset to apply to every body the adapter
     * creates. The chunk's static body is placed here; debris bodies
     * have this offset added to their pixel-space centroid before
     * conversion to meters.
     *
     * Use this when the rendered terrain is not at scene origin (0, 0)
     * — e.g. a centered terrain at scene `(104, 52)` should pass
     * `originPx: { x: 104, y: 52 }` so that body positions map back to
     * scene coordinates correctly.
     *
     * Default: `{ x: 0, y: 0 }`.
     */
    originPx?: { x: number; y: number };
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
    private readonly originPxX: number;
    private readonly originPxY: number;
    private readonly defaultTerrainFriction: number;
    private readonly defaultTerrainRestitution: number;
    private readonly chunkBodies = new Map<Chunk, BodyId>();

    constructor(options: Box2DAdapterOptions) {
        this.worldId = options.worldId;
        this.pixelsPerMeter = options.pixelsPerMeter ?? 32;
        this.originPxX = options.originPx?.x ?? 0;
        this.originPxY = options.originPx?.y ?? 0;
        this.defaultTerrainFriction = options.defaultTerrainFriction ?? 0.7;
        this.defaultTerrainRestitution = options.defaultTerrainRestitution ?? 0;
    }

    /**
     * Replaces the chunk's terrain body with a fresh static body whose
     * polygon (triangle) shapes match the supplied contours.
     *
     * The previous body (if any) is destroyed first; pass an empty list
     * to clear the chunk entirely. Contours with fewer than 3 vertices
     * are silently skipped. If no contour produced any triangles, no
     * body is created and the map entry is cleared.
     *
     * Why polygons (triangulated via earcut) rather than one-sided
     * `b2ChainShape`: a dynamic body that drifts to the wrong side of
     * a chain seam during a destroy/recreate cycle isn't seen as
     * colliding with the chain (chain normals are one-sided) and falls
     * through. Two-sided polygons resolve penetration regardless of
     * which side the body ended up on, which fixes the tunneling under
     * continuous carving.
     *
     * Note on lifecycle: persistent-body / chain-only-swap was tried
     * and is not viable with `phaser-box2d` 1.1 — its `b2DestroyChain`
     * doesn't unlink the chain from the body's chain list, so a
     * subsequent `b2DestroyBody` double-frees the chain pool. We
     * destroy and recreate the whole body. The
     * {@link DeferredRebuildQueue} skips this rebuild when the contour
     * set is unchanged across frames, which keeps churn down for
     * terrain blobs unaffected by a given carve.
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
        bodyDef.position.x = this.originPxX / this.pixelsPerMeter;
        bodyDef.position.y = -this.originPxY / this.pixelsPerMeter;
        const bodyId = b2CreateBody(this.worldId, bodyDef);

        let attached = 0;
        for (const contour of contours) {
            attached += contourToTriangles(bodyId, contour, {
                pixelsPerMeter: this.pixelsPerMeter,
                friction: this.defaultTerrainFriction,
                restitution: this.defaultTerrainRestitution,
            });
        }

        if (attached === 0) {
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
     * The contour is triangulated via earcut and each triangle becomes
     * its own `b2PolygonShape` on a single dynamic body. This handles
     * non-convex outlines (e.g. an L-shaped piece left over after a
     * carve severs a neck) cleanly without falling back to chain shapes,
     * which behave poorly on dynamic bodies (one-sided collision means
     * the body doesn't act as a solid).
     *
     * Returns `null` if the contour is too small (< 3 vertices) or
     * earcut could not produce any triangles (e.g. all vertices
     * collinear). The body's COM is set to the centroid of the input
     * contour and shape vertices are translated to body-local space;
     * this is what makes the debris rotate naturally about its own
     * center under gravity.
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
        // Origin offset in pixels is added before the meter conversion so
        // dynamic debris bodies use the same scene coordinate space as
        // user-spawned bodies.
        bodyDef.position.x = (cx + this.originPxX) / this.pixelsPerMeter;
        bodyDef.position.y = -(cy + this.originPxY) / this.pixelsPerMeter;
        const bodyId = b2CreateBody(this.worldId, bodyDef);

        const triCount = contourToTriangles(bodyId, localContour, {
            pixelsPerMeter: this.pixelsPerMeter,
            density: material.density,
            friction: material.friction,
            restitution: material.restitution,
        });
        if (triCount === 0) {
            // Contour was too degenerate for any triangle — clean up.
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
     * Captures the kinematic state of every dynamic body whose AABB
     * overlaps the supplied **pixel-space** AABB.
     *
     * Used by {@link DeferredRebuildQueue} to freeze bodies across a
     * terrain-collider rebuild. Box2D's `b2DestroyShapeInternal` wakes
     * bodies whose contacts touch destroyed shapes (PhaserBox2D.js:3173
     * hardcodes `wakeBodies = true`); without snapshot/restore, every
     * carve frame would wake settled bodies, integrate one step of
     * gravity on them, and let the resulting penetration ricochet into
     * a continuous jitter on the body's resting surface.
     *
     * Filtering: only bodies whose `b2Body_GetType` is `b2_dynamicBody`
     * are returned. Static and kinematic bodies are skipped because
     * we never write their state. Bodies are deduped (multiple shapes
     * on the same body produce one snapshot).
     */
    snapshotDynamicBodies(aabbPx: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    }): BodySnapshot[] {
        // Convert pixel AABB to meter AABB with the same origin offset
        // and y-flip the adapter applies to bodies. The result is a
        // valid Box2D AABB (lower < upper after the y-flip-and-swap).
        const ppm = this.pixelsPerMeter;
        const lx = (aabbPx.minX + this.originPxX) / ppm;
        const lyRaw = -(aabbPx.maxY + this.originPxY) / ppm;
        const ux = (aabbPx.maxX + this.originPxX) / ppm;
        const uyRaw = -(aabbPx.minY + this.originPxY) / ppm;
        const aabb = new b2AABB(
            Math.min(lx, ux),
            Math.min(lyRaw, uyRaw),
            Math.max(lx, ux),
            Math.max(lyRaw, uyRaw),
        );

        const seen = new Set<unknown>();
        const snaps: BodySnapshot[] = [];
        const filter = b2DefaultQueryFilter();
        b2World_OverlapAABB(
            this.worldId,
            aabb,
            filter,
            (shapeId): boolean => {
                const bodyId = b2Shape_GetBody(shapeId);
                // The bodyId is an opaque struct of the form
                // `{ index1, world0, revision }`. Dedupe by `index1`
                // since multiple shapes on one body all return the same
                // body record. Cast through `unknown` because BodyId
                // is branded externally; this is the one place the
                // adapter looks at the runtime shape.
                const key = (bodyId as unknown as { index1: number }).index1;
                if (seen.has(key)) return true;
                seen.add(key);
                if (b2Body_GetType(bodyId) !== b2BodyType.b2_dynamicBody) {
                    return true;
                }
                const xf = b2Body_GetTransform(bodyId);
                const v = b2Body_GetLinearVelocity(bodyId);
                snaps.push({
                    bodyId,
                    px: xf.p.x,
                    py: xf.p.y,
                    rc: xf.q.c,
                    rs: xf.q.s,
                    vx: v.x,
                    vy: v.y,
                    omega: b2Body_GetAngularVelocity(bodyId),
                    awake: b2Body_IsAwake(bodyId),
                });
                return true;
            },
            null,
        );
        return snaps;
    }

    /**
     * Restores a previously captured set of body snapshots. Writes the
     * transform, linear/angular velocity, and awake flag back. Bodies
     * whose handle has since gone invalid (e.g. the user destroyed them
     * mid-frame) are silently skipped — the snapshot loop in
     * `DeferredRebuildQueue` runs at end-of-frame after the user's logic.
     *
     * Critically, the awake flag is the last thing restored. `SetTransform`
     * and `SetLinearVelocity` may wake a body internally; restoring
     * `awake = false` after those calls puts settled bodies back to
     * sleep so the next world step skips gravity integration on them.
     */
    restoreDynamicBodies(snapshots: readonly BodySnapshot[]): void {
        for (const s of snapshots) {
            // Skip if the body has been destroyed since snapshot. We can't
            // check b2Body_IsValid here without exposing it everywhere;
            // the cheap proxy is to wrap individual calls in try/catch
            // — but the `phaser-box2d` 1.1 setters throw if the index is
            // freed, so we need to rely on the queue not snapshotting
            // bodies the user is destroying inside the same flush.
            b2Body_SetTransform(
                s.bodyId,
                new b2Vec2(s.px, s.py),
                { c: s.rc, s: s.rs },
            );
            b2Body_SetLinearVelocity(s.bodyId, new b2Vec2(s.vx, s.vy));
            b2Body_SetAngularVelocity(s.bodyId, s.omega);
            b2Body_SetAwake(s.bodyId, s.awake);
        }
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
