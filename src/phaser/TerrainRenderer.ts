import type Phaser from 'phaser';
import type { Chunk, ChunkedBitmap, MaterialRegistry } from '../core/index.js';

/** Packed-RGBA value for unknown material ids (magenta, fully opaque). */
const UNKNOWN_PACKED = packRGBA(0xff, 0x00, 0xff, 0xff);

/**
 * Packs four 0..255 channel values into a single Uint32 in
 * little-endian byte order — matching what `ImageData.data` expects
 * when read through a `Uint32Array` view on a little-endian host
 * (every browser this library targets).
 *
 * Layout in memory: byte 0 = R, byte 1 = G, byte 2 = B, byte 3 = A.
 * As a Uint32 on little-endian: `0xAABBGGRR`.
 */
function packRGBA(r: number, g: number, b: number, a: number): number {
    return ((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff);
}

/**
 * Per-pixel render of one chunk into a packed-RGBA pixel buffer.
 *
 * Hot path. Exposed for testing and for advanced consumers that want
 * to drive their own DynamicTexture / canvas pipeline. Each pixel
 * costs one byte read from `bitmapData`, one indexed read from
 * `colorLut`, and one 32-bit write to `pixels32` — vs the naive
 * 1 Map.get + 4 byte writes per pixel that this replaced.
 *
 * `bitmapData` and `pixels32` must have the same length (number of
 * pixels in the chunk). `colorLut` is indexed by material id (256
 * entries; `colorLut[0]` is air = `0`, `colorLut[id > 0]` is the
 * packed-RGBA value for that material).
 */
export function paintChunkPixels(
    bitmapData: Uint8Array,
    pixels32: Uint32Array,
    colorLut: Uint32Array,
): void {
    for (let i = 0; i < bitmapData.length; i++) {
        pixels32[i] = colorLut[bitmapData[i]!]!;
    }
}

/**
 * Builds a 256-entry packed-RGBA LUT from the supplied
 * {@link MaterialRegistry}. Air (id 0) is `0` (transparent black);
 * registered materials get their `color`-derived RGBA; unregistered
 * non-zero ids fall back to magenta so they stand out visually.
 *
 * Allocates a fresh `Uint32Array(256)`. Cheap — 256 ops per call,
 * amortized over the 4 K – 16 K pixels of a chunk repaint. Callers
 * that want to skip the rebuild can cache the result for as long
 * as the registry is stable.
 */
export function buildColorLut(materials: MaterialRegistry): Uint32Array {
    const lut = new Uint32Array(256);
    // 0 (air) defaults to 0 — fully transparent.
    for (let id = 1; id < 256; id++) {
        const m = materials.get(id);
        if (m === undefined) {
            lut[id] = UNKNOWN_PACKED;
        } else {
            const r = (m.color >> 16) & 0xff;
            const g = (m.color >> 8) & 0xff;
            const b = m.color & 0xff;
            lut[id] = packRGBA(r, g, b, 0xff);
        }
    }
    return lut;
}

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
    /**
     * Uint32 view onto each chunk's `ImageData.data` buffer. Cached
     * once at construction so the per-repaint hot loop can do
     * `pixels32[i] = packed` in a single 32-bit write per pixel
     * instead of four byte writes through the Uint8ClampedArray.
     */
    private readonly pixels32 = new Map<Chunk, Uint32Array>();
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
        this.pixels32.clear();
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
            const pixels32 = new Uint32Array(data.data.buffer);

            const key = this.textureKey(chunk);
            this.scene.textures.addCanvas(key, canvas);

            const image = this.scene.add
                .image(this.originX + chunk.cx * cs, this.originY + chunk.cy * cs, key)
                .setOrigin(0, 0);

            this.canvases.set(chunk, canvas);
            this.imageData.set(chunk, data);
            this.pixels32.set(chunk, pixels32);
            this.images.set(chunk, image);
        }
    }

    private repaintChunk(chunk: Chunk): void {
        const canvas = this.canvases.get(chunk)!;
        const data = this.imageData.get(chunk)!;
        const pixels32 = this.pixels32.get(chunk)!;

        // Rebuild the LUT each repaint. 256 ops; negligible compared to
        // the 4 K – 16 K pixel writes that follow, and means materials
        // registered after construction are reflected automatically.
        const lut = buildColorLut(this.materials);
        paintChunkPixels(chunk.bitmap, pixels32, lut);

        canvas.getContext('2d')!.putImageData(data, 0, 0);

        // Tell Phaser the underlying canvas changed so it re-uploads.
        const texture = this.scene.textures.get(this.textureKey(chunk));
        if ('refresh' in texture && typeof texture.refresh === 'function') {
            (texture as { refresh: () => void }).refresh();
        }
        // The CanvasTexture's source also tracks dirty state; flip it
        // so renderers that haven't called refresh-equivalents still
        // pick up the change.
        const source = texture.source[0];
        if (source !== undefined) {
            (source as { isDirty?: boolean }).isDirty = true;
        }
    }

    private textureKey(chunk: Chunk): string {
        return `${this.textureKeyPrefix}-${chunk.cx}-${chunk.cy}`;
    }
}
