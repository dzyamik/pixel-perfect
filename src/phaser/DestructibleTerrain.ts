import type Phaser from 'phaser';
import {
    Carve,
    ChunkedBitmap,
    Deposit,
    MaterialRegistry,
    Spatial,
} from '../core/index.js';
import type {
    AlphaSource,
    Material,
    Point,
    HitResult,
} from '../core/index.js';
import { TerrainRenderer } from './TerrainRenderer.js';

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

    private readonly originX: number;
    private readonly originY: number;

    constructor(options: DestructibleTerrainOptions) {
        const chunkSize = options.chunkSize ?? 64;
        this.originX = options.x ?? 0;
        this.originY = options.y ?? 0;

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
    }

    /** Material registry shared with the bitmap. */
    get materials(): MaterialRegistry {
        return this.bitmap.materials;
    }

    /**
     * Call once per frame from the scene's `update()`. Repaints any
     * chunks that were carved / deposited since last frame.
     */
    update(): void {
        this.renderer.repaintDirty();
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

    /** Tears down the terrain's render objects. Idempotent-ish. */
    destroy(): void {
        this.renderer.destroy();
    }
}
