import type Phaser from 'phaser';
import type { Chunk, ChunkedBitmap, MaterialRegistry } from '../core/index.js';

/** Construction options for {@link TerrainRenderer}. */
export interface TerrainRendererOptions {
    /** The Phaser scene that owns the visual game objects. */
    scene: Phaser.Scene;
    /** The bitmap to render. */
    bitmap: ChunkedBitmap;
    /** Material registry the bitmap shares (used for color lookup). */
    materials: MaterialRegistry;
    /** World x/y to position the rendered terrain at. Defaults to (0, 0). */
    x?: number;
    /** World y. */
    y?: number;
    /** Texture-key prefix. Each chunk's canvas texture is keyed `${prefix}-${cx}-${cy}`. Defaults to a unique random token. */
    textureKeyPrefix?: string;
}

/**
 * Per-chunk canvas-backed terrain renderer.
 *
 * Each chunk gets its own `<canvas>` element of size `chunkSize ×
 * chunkSize`, registered with Phaser's TextureManager via `addCanvas`,
 * and shown by a Phaser `Image` GameObject placed at the chunk's world
 * position. Repaints update the canvas's `ImageData` and call
 * `texture.refresh()` so the GPU re-uploads the changed pixels.
 *
 * One canvas per chunk (rather than a single world-spanning canvas)
 * keeps each upload bounded to chunk size — chunks that are clean don't
 * pay any GPU cost. The cost is N extra Phaser Image game objects, one
 * per chunk; for the v1 default of 32 chunks per typical world this is
 * negligible.
 */
export class TerrainRenderer {
    private readonly scene: Phaser.Scene;
    private readonly bitmap: ChunkedBitmap;
    private readonly materials: MaterialRegistry;
    private readonly originX: number;
    private readonly originY: number;
    private readonly textureKeyPrefix: string;

    private readonly canvases = new Map<Chunk, HTMLCanvasElement>();
    private readonly imageData = new Map<Chunk, ImageData>();
    private readonly images = new Map<Chunk, Phaser.GameObjects.Image>();

    constructor(options: TerrainRendererOptions) {
        this.scene = options.scene;
        this.bitmap = options.bitmap;
        this.materials = options.materials;
        this.originX = options.x ?? 0;
        this.originY = options.y ?? 0;
        this.textureKeyPrefix =
            options.textureKeyPrefix ??
            `pp-terrain-${Math.random().toString(36).slice(2, 10)}`;

        this.createGameObjects();
        this.repaintAll();
    }

    /**
     * Re-paints every chunk whose `visualDirty` flag is set, then clears
     * the flag. Call from the scene's `update()` (or a `postUpdate`
     * hook); cheap when nothing is dirty.
     */
    repaintDirty(): number {
        let painted = 0;
        for (const chunk of this.bitmap.chunks) {
            if (chunk.visualDirty) {
                this.repaintChunk(chunk);
                this.bitmap.clearVisualDirty(chunk);
                painted++;
            }
        }
        return painted;
    }

    /** Forcibly repaints every chunk regardless of dirty flag. */
    repaintAll(): void {
        for (const chunk of this.bitmap.chunks) {
            this.repaintChunk(chunk);
            this.bitmap.clearVisualDirty(chunk);
        }
    }

    /** Destroys every game object and texture this renderer owns. */
    destroy(): void {
        for (const image of this.images.values()) image.destroy();
        for (const chunk of this.canvases.keys()) {
            const key = this.textureKey(chunk);
            if (this.scene.textures.exists(key)) this.scene.textures.remove(key);
        }
        this.canvases.clear();
        this.imageData.clear();
        this.images.clear();
    }

    private createGameObjects(): void {
        const cs = this.bitmap.chunkSize;
        for (const chunk of this.bitmap.chunks) {
            const canvas = document.createElement('canvas');
            canvas.width = cs;
            canvas.height = cs;
            const ctx = canvas.getContext('2d')!;
            const data = ctx.createImageData(cs, cs);

            const key = this.textureKey(chunk);
            this.scene.textures.addCanvas(key, canvas);

            const image = this.scene.add
                .image(this.originX + chunk.cx * cs, this.originY + chunk.cy * cs, key)
                .setOrigin(0, 0);

            this.canvases.set(chunk, canvas);
            this.imageData.set(chunk, data);
            this.images.set(chunk, image);
        }
    }

    private repaintChunk(chunk: Chunk): void {
        const cs = this.bitmap.chunkSize;
        const canvas = this.canvases.get(chunk)!;
        const data = this.imageData.get(chunk)!;
        const pixels = data.data;
        const bitmap = chunk.bitmap;

        for (let i = 0; i < bitmap.length; i++) {
            const id = bitmap[i]!;
            const pix = i * 4;
            if (id === 0) {
                pixels[pix] = 0;
                pixels[pix + 1] = 0;
                pixels[pix + 2] = 0;
                pixels[pix + 3] = 0;
            } else {
                const m = this.materials.get(id);
                const color = m?.color ?? 0xff00ff; // magenta = unknown id
                pixels[pix] = (color >> 16) & 0xff;
                pixels[pix + 1] = (color >> 8) & 0xff;
                pixels[pix + 2] = color & 0xff;
                pixels[pix + 3] = 0xff;
            }
        }

        canvas.getContext('2d')!.putImageData(data, 0, 0);

        // Tell Phaser the underlying canvas changed so it re-uploads.
        const texture = this.scene.textures.get(this.textureKey(chunk));
        if ('refresh' in texture && typeof texture.refresh === 'function') {
            (texture as { refresh: () => void }).refresh();
        }
        // The CanvasTexture also has the underlying source as dirty:
        const source = texture.source[0];
        if (source !== undefined) {
            (source as { isDirty?: boolean }).isDirty = true;
        }
        // Used parameter to silence the unused-variable warning for `cs`
        // when the loop above doesn't reference it directly.
        void cs;
    }

    private textureKey(chunk: Chunk): string {
        return `${this.textureKeyPrefix}-${chunk.cx}-${chunk.cy}`;
    }
}
