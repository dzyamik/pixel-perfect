import type Phaser from 'phaser';
import {
    Carve,
    CellularAutomaton,
    ChunkedBitmap,
    Deposit,
    Spatial,
} from '../core/index.js';
import type {
    AlphaSource,
    Contour,
    HitResult,
    Material,
    MaterialRegistry,
    Point,
} from '../core/index.js';
import { Box2DAdapter, DebrisDetector, DeferredRebuildQueue } from '../physics/index.js';
import type { BodyId, WorldId } from '../physics/index.js';
import { TerrainRenderer } from './TerrainRenderer.js';

/** Debris event payload — passed to {@link DestructibleTerrainOptions.onDebrisCreated}. */
export interface DebrisCreatedEvent {
    /** The dynamic Box2D body the queue created. The caller owns its lifetime. */
    bodyId: BodyId;
    /** Outer contour passed to the queue, in **bitmap** coordinates. */
    contour: Contour;
    /** Material used for the body's density / friction / restitution. */
    material: Material;
}

/** Construction options for {@link DestructibleTerrain}. */
export interface DestructibleTerrainOptions {
    scene: Phaser.Scene;
    /** World width in pixels. Must be divisible by `chunkSize`. */
    width: number;
    /** World height in pixels. Must be divisible by `chunkSize`. */
    height: number;
    /** Edge length of each chunk in pixels. Default 64. */
    chunkSize?: number;
    /** Where to place the terrain's top-left in scene coordinates. Defaults to (0, 0). */
    x?: number;
    /** Scene Y offset. */
    y?: number;
    /** Materials to register up-front. */
    materials?: readonly Material[];
    /**
     * Box2D world to attach colliders to. Optional — terrain works
     * purely visually if you don't need physics. When provided, the
     * terrain manages chunk collider lifecycle internally; carve /
     * deposit calls dirty chunks and the next `update()` flushes the
     * deferred queue.
     */
    worldId?: WorldId;
    /** Pixels per Box2D meter. Defaults to 32 (Phaser Box2D convention). */
    pixelsPerMeter?: number;
    /** Douglas-Peucker simplification epsilon for collider contours. Default 1. */
    simplificationEpsilon?: number;
    /**
     * Called once per dynamic debris body the queue creates during a
     * flush. The handler receives the body id, the bitmap-space outer
     * contour the body was built from, and the material used for its
     * physical properties. Use this to spawn a sprite or graphics for
     * the debris.
     *
     * Body lifetime is the caller's responsibility — debris bodies are
     * not destroyed by the terrain itself.
     */
    onDebrisCreated?: (event: DebrisCreatedEvent) => void;
    /**
     * When `true`, `update()` runs one cellular-automaton tick before
     * the renderer/physics flush. Default `false` for back-compat —
     * v1.x users get the same behavior they had. Enable when any
     * registered material has `simulation: 'sand'` (or other future
     * fluid kinds) so the bitmap is stepped automatically each frame.
     *
     * The simulation tick is `O(width × height)` per call. For very
     * large bitmaps without fluid materials in flight, leaving this
     * `false` and calling `terrain.simStep()` manually only when you
     * know fluid pixels exist is a worthwhile optimization.
     */
    autoSimulate?: boolean;
}

/**
 * The user-facing destructible-terrain GameObject (Phase 3 minimum).
 *
 * This first iteration owns:
 *  - a {@link ChunkedBitmap} (state)
 *  - a {@link TerrainRenderer} (visuals)
 *  - thin facades over `Carve` / `Deposit` / `Spatial` queries
 *
 * Box2D physics integration (chunk colliders, debris bodies) is wired in
 * by the next iteration. The renderer-only path in this iteration is
 * useful on its own — for purely visual destructible terrain (no
 * collision), or for early-development debugging while the physics
 * setup is being staged.
 *
 * Use `update()` from the scene's update loop. Carve/deposit operations
 * mutate the bitmap synchronously; the renderer repaints dirty chunks
 * on the next `update()`.
 */
export class DestructibleTerrain {
    /** The underlying bitmap. Most users won't need direct access. */
    readonly bitmap: ChunkedBitmap;

    /** The render layer. Exposed for advanced use (e.g. parallax). */
    readonly renderer: TerrainRenderer;

    /** Carve facade: writes air into the bitmap. */
    readonly carve = {
        circle: (cx: number, cy: number, r: number): void =>
            Carve.circle(this.bitmap, cx - this.originX, cy - this.originY, r),
        polygon: (points: readonly Point[]): void =>
            Carve.polygon(
                this.bitmap,
                points.map((p) => ({ x: p.x - this.originX, y: p.y - this.originY })),
            ),
        fromAlphaTexture: (
            source: AlphaSource,
            dstX: number,
            dstY: number,
            threshold?: number,
        ): void =>
            Carve.fromAlphaTexture(
                this.bitmap,
                source,
                dstX - this.originX,
                dstY - this.originY,
                threshold,
            ),
    };

    /** Deposit facade: writes a material id into the bitmap. */
    readonly deposit = {
        circle: (cx: number, cy: number, r: number, materialId: number): void =>
            Deposit.circle(this.bitmap, cx - this.originX, cy - this.originY, r, materialId),
        polygon: (points: readonly Point[], materialId: number): void =>
            Deposit.polygon(
                this.bitmap,
                points.map((p) => ({ x: p.x - this.originX, y: p.y - this.originY })),
                materialId,
            ),
        fromAlphaTexture: (
            source: AlphaSource,
            dstX: number,
            dstY: number,
            materialId: number,
            threshold?: number,
        ): void =>
            Deposit.fromAlphaTexture(
                this.bitmap,
                source,
                dstX - this.originX,
                dstY - this.originY,
                materialId,
                threshold,
            ),
    };

    /**
     * Physics integration. `null` when no `worldId` was supplied at
     * construction (visual-only terrain).
     */
    readonly physics: TerrainPhysics | null;

    /**
     * Top-left of the terrain in **scene coordinates**. Public-readable
     * so consumers can convert between scene space and bitmap space
     * (e.g. {@link PixelPerfectSprite} does this on overlap checks).
     */
    readonly originX: number;
    readonly originY: number;
    private readonly onDebrisCreated:
        | ((event: DebrisCreatedEvent) => void)
        | undefined;
    private readonly autoSimulate: boolean;
    /** Tick counter for the cellular-automaton step; flips L/R bias. */
    private simTick = 0;

    constructor(options: DestructibleTerrainOptions) {
        const chunkSize = options.chunkSize ?? 64;
        this.originX = options.x ?? 0;
        this.originY = options.y ?? 0;
        this.onDebrisCreated = options.onDebrisCreated;
        this.autoSimulate = options.autoSimulate ?? false;

        this.bitmap = new ChunkedBitmap(
            options.materials !== undefined
                ? {
                      width: options.width,
                      height: options.height,
                      chunkSize,
                      materials: options.materials,
                  }
                : { width: options.width, height: options.height, chunkSize },
        );
        this.renderer = new TerrainRenderer({
            scene: options.scene,
            bitmap: this.bitmap,
            materials: this.bitmap.materials,
            x: this.originX,
            y: this.originY,
        });

        if (options.worldId !== undefined) {
            const adapter = new Box2DAdapter({
                worldId: options.worldId,
                pixelsPerMeter: options.pixelsPerMeter ?? 32,
                originPx: { x: this.originX, y: this.originY },
            });
            const queue = new DeferredRebuildQueue(
                options.simplificationEpsilon !== undefined
                    ? {
                          bitmap: this.bitmap,
                          simplificationEpsilon: options.simplificationEpsilon,
                      }
                    : { bitmap: this.bitmap },
            );
            this.physics = { worldId: options.worldId, adapter, queue };
        } else {
            this.physics = null;
        }
    }

    /** Material registry shared with the bitmap. */
    get materials(): MaterialRegistry {
        return this.bitmap.materials;
    }

    /**
     * Runs one cellular-automaton tick over the bitmap. Materials with
     * `simulation: 'sand'` (and any future fluid kinds) move; static
     * materials don't. The tick counter is auto-incremented so
     * successive calls alternate L/R bias.
     *
     * Cost: `O(width × height)` per call. For very large bitmaps,
     * consider gating on a "are there any fluid pixels in flight?"
     * flag.
     */
    simStep(): void {
        CellularAutomaton.step(this.bitmap, this.simTick);
        this.simTick++;
    }

    /**
     * Call once per frame from the scene's `update()`. Flushes pending
     * collider rebuilds (if physics is enabled) and repaints any chunks
     * carved / deposited since last frame.
     *
     * If `autoSimulate` was enabled at construction, runs one
     * cellular-automaton tick BEFORE the rebuild flush so the static
     * collider snapshot reflects the post-tick bitmap.
     *
     * The physics flush runs BEFORE the visual repaint because rebuilds
     * only clear `dirty` (collider) and visuals only clear
     * `visualDirty` — the order matters only insofar as it affects
     * which dirty flag is read by which step. With both flushes per
     * frame, the order is moot but documenting it for clarity.
     */
    update(): void {
        if (this.autoSimulate) this.simStep();
        if (this.physics !== null) {
            this.bitmap.forEachDirtyChunk((chunk) => this.physics!.queue.enqueueChunk(chunk));
            this.physics.queue.flush(
                this.physics.adapter,
                this.onDebrisCreated !== undefined
                    ? {
                          onDebrisCreated: (bodyId, contour, material) =>
                              this.onDebrisCreated!({ bodyId, contour, material }),
                      }
                    : undefined,
            );
        }
        this.renderer.repaintDirty();
    }

    /**
     * Detect every connected solid component that is not anchored,
     * remove its cells from the bitmap, and (when physics is enabled)
     * enqueue a dynamic body for each. Returns the detected debris with
     * scene-coordinate contours and bounds so the caller can spawn
     * visuals.
     *
     * Bodies appear on the next {@link update}() — the queue holds them
     * until end-of-frame. The {@link DestructibleTerrainOptions.onDebrisCreated}
     * callback fires once per body created.
     *
     * @param anchor Flood-fill anchor strategy. Default: bottom row.
     * @param simplificationEpsilon Douglas-Peucker epsilon for the
     *                              extracted contours. Defaults to the
     *                              terrain's `simplificationEpsilon`.
     */
    extractDebris(
        anchor: DebrisDetector.DetectOptions['anchor'] = { kind: 'bottomRow' },
        simplificationEpsilon = 1,
    ): DebrisDetector.DebrisInfo[] {
        const detectOptions: DebrisDetector.DetectOptions =
            anchor !== undefined
                ? { anchor, simplificationEpsilon }
                : { simplificationEpsilon };
        const raw = DebrisDetector.detectAndRemove(this.bitmap, detectOptions);

        if (this.physics !== null) {
            for (const info of raw) {
                const outer = info.contours.find((c) => c.closed);
                if (outer === undefined) continue;
                const material = this.bitmap.materials.get(info.dominantMaterial);
                if (material === undefined) continue;
                this.physics.queue.enqueueDebris(outer, material);
            }
        }

        // Translate contours and bounds into scene coordinates for the
        // caller's convenience (every other public DestructibleTerrain
        // surface uses scene coords).
        return raw.map((info) => ({
            island: {
                cells: info.island.cells.map((p) => ({
                    x: p.x + this.originX,
                    y: p.y + this.originY,
                })),
                bounds: {
                    minX: info.island.bounds.minX + this.originX,
                    maxX: info.island.bounds.maxX + this.originX,
                    minY: info.island.bounds.minY + this.originY,
                    maxY: info.island.bounds.maxY + this.originY,
                },
            },
            contours: info.contours.map((c) => ({
                points: c.points.map((p) => ({
                    x: p.x + this.originX,
                    y: p.y + this.originY,
                })),
                closed: c.closed,
            })),
            dominantMaterial: info.dominantMaterial,
        }));
    }

    /** Spatial query: is the cell at scene coords solid? */
    isSolid(x: number, y: number): boolean {
        return Spatial.isSolid(this.bitmap, x - this.originX, y - this.originY);
    }

    /** Material id at scene coords. */
    sampleMaterial(x: number, y: number): number {
        return Spatial.sampleMaterial(this.bitmap, x - this.originX, y - this.originY);
    }

    /** Bresenham raycast in scene coords. */
    raycast(x1: number, y1: number, x2: number, y2: number): HitResult | null {
        const hit = Spatial.raycast(
            this.bitmap,
            x1 - this.originX,
            y1 - this.originY,
            x2 - this.originX,
            y2 - this.originY,
        );
        if (hit === null) return null;
        return {
            ...hit,
            x: hit.x + this.originX,
            y: hit.y + this.originY,
        };
    }

    /** First solid cell in column `x` (scene coords). Returns the world Y. */
    surfaceY(x: number): number {
        return Spatial.surfaceY(this.bitmap, x - this.originX) + this.originY;
    }

    /** Tears down the terrain's render objects and physics bodies. */
    destroy(): void {
        this.renderer.destroy();
        this.physics?.adapter.dispose();
    }
}

/** The physics integration of a {@link DestructibleTerrain}. */
export interface TerrainPhysics {
    /** Box2D world the terrain attaches its bodies to. */
    readonly worldId: WorldId;
    /**
     * The body lifecycle adapter. Exposed so users can read the chunk
     * body map or create their own (debris) bodies in the same world.
     */
    readonly adapter: Box2DAdapter;
    /**
     * The deferred rebuild queue. Exposed so users can `enqueueDebris`
     * with their own contours when they detect detached chunks.
     */
    readonly queue: DeferredRebuildQueue;
}
