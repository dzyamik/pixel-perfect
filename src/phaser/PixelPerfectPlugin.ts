import * as Phaser from 'phaser';

import { DestructibleTerrain } from './DestructibleTerrain.js';
import type { DestructibleTerrainOptions } from './DestructibleTerrain.js';
import { PixelPerfectSprite } from './PixelPerfectSprite.js';

/**
 * Per-scene Phaser plugin and the public entry point for the library
 * inside a Phaser game.
 *
 * Register the plugin once at game creation:
 *
 * ```ts
 * import * as Phaser from 'phaser';
 * import { PixelPerfectPlugin } from 'pixel-perfect';
 *
 * const game = new Phaser.Game({
 *     // ...
 *     plugins: {
 *         scene: [
 *             {
 *                 key: 'PixelPerfectPlugin',
 *                 plugin: PixelPerfectPlugin,
 *                 mapping: 'pixelPerfect',
 *             },
 *         ],
 *     },
 * });
 * ```
 *
 * After registration, `scene.pixelPerfect.terrain(options)` is
 * available inside any scene the plugin is mapped into. The factory
 * supplies the scene to {@link DestructibleTerrain} automatically and
 * registers the returned terrain for **automatic update**: the plugin
 * subscribes to the scene's `POST_UPDATE` event and calls
 * `terrain.update()` on every terrain it owns. Users do not need to
 * wire the per-frame flush themselves.
 *
 * Lifecycle: terrain bodies/render layers created via this plugin are
 * destroyed when the scene shuts down or the scene is destroyed.
 * User-spawned dynamic bodies (debris, balls, etc.) are *not* the
 * plugin's responsibility — the caller still owns those, same as
 * before.
 *
 * Phaser-side type augmentation is included in this module so that
 * `scene.pixelPerfect` is typed correctly without each downstream
 * consumer having to write their own `declare global` block. Importing
 * this file from anywhere in the project is enough.
 */
export class PixelPerfectPlugin extends Phaser.Plugins.ScenePlugin {
    /**
     * Terrains owned by this plugin instance. The plugin auto-updates
     * each entry on `POST_UPDATE` and destroys them on shutdown.
     */
    private readonly terrains: DestructibleTerrain[] = [];

    /**
     * Called once when the scene boots. Wires up the auto-update and
     * shutdown handlers; users should not need to override or invoke
     * this directly.
     */
    override boot(): void {
        const events = this.systems!.events;
        events.on(Phaser.Scenes.Events.POST_UPDATE, this.onPostUpdate, this);
        events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
        events.once(Phaser.Scenes.Events.DESTROY, this.onShutdown, this);
    }

    /**
     * Creates a destructible terrain for this scene.
     *
     * Same options as `new DestructibleTerrain({ scene, ...options })`
     * but `scene` is supplied automatically. The returned terrain is
     * tracked by the plugin and `update()` is called on it once per
     * frame at `POST_UPDATE`. Callers can still call `update()`
     * manually if they need a flush at a different time.
     */
    terrain(options: Omit<DestructibleTerrainOptions, 'scene'>): DestructibleTerrain {
        if (this.scene === null) {
            // ScenePlugin guarantees `scene` is set before `boot()`,
            // and users only call `terrain()` from inside scene
            // lifecycle methods. If we hit this it's a user-error path
            // (e.g. holding a plugin reference after scene shutdown).
            throw new Error(
                'PixelPerfectPlugin.terrain() called before the plugin booted ' +
                    'or after the scene was shut down.',
            );
        }
        const terrain = new DestructibleTerrain({
            scene: this.scene,
            ...options,
        });
        this.terrains.push(terrain);
        return terrain;
    }

    /**
     * Creates an alpha-aware {@link PixelPerfectSprite} attached to
     * this scene's display list. Same arguments as the Phaser
     * `Sprite` constructor minus the scene (which is supplied
     * automatically). Sprites are not tracked for auto-destroy by
     * the plugin — Phaser's regular GameObject lifecycle handles
     * that on scene shutdown.
     */
    sprite(
        x: number,
        y: number,
        textureKey: string,
        frame?: string | number,
    ): PixelPerfectSprite {
        if (this.scene === null) {
            throw new Error(
                'PixelPerfectPlugin.sprite() called before the plugin booted ' +
                    'or after the scene was shut down.',
            );
        }
        return new PixelPerfectSprite(this.scene, x, y, textureKey, frame);
    }

    /**
     * Removes a terrain from the plugin's auto-update set and destroys
     * it. Callers can also let scene shutdown handle cleanup, which
     * destroys every tracked terrain in one pass.
     */
    destroyTerrain(terrain: DestructibleTerrain): void {
        const idx = this.terrains.indexOf(terrain);
        if (idx === -1) return;
        this.terrains.splice(idx, 1);
        terrain.destroy();
    }

    /**
     * Per-frame hook. Iterates owned terrains in insertion order and
     * calls `update()` on each (which flushes the deferred queue and
     * repaints dirty chunks). Snapshot the list before iterating so a
     * carve handler that destroys a terrain mid-update can't corrupt
     * the loop.
     */
    private onPostUpdate(): void {
        const snapshot = this.terrains.slice();
        for (const terrain of snapshot) {
            terrain.update();
        }
    }

    /**
     * Tears down every terrain the plugin owns. Called on `SHUTDOWN`
     * (when the scene stops) and `DESTROY` (when the scene is
     * permanently removed). Both events fire once at most, so the
     * second handler is a no-op.
     */
    private onShutdown(): void {
        for (const terrain of this.terrains) {
            terrain.destroy();
        }
        this.terrains.length = 0;
    }
}

// `namespace Phaser` is the only way to augment Phaser v4's d.ts —
// its types are written that way (see `phaser/types/phaser.d.ts`),
// and there's no equivalent `interface` declaration to merge into
// from a flat `declare module 'phaser'` block. The eslint disable
// is local and intentional.
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Phaser {
        interface Scene {
            /**
             * Pixel-Perfect plugin, available when the
             * {@link PixelPerfectPlugin} is registered with mapping
             * `'pixelPerfect'`.
             */
            pixelPerfect: PixelPerfectPlugin;
        }
    }
}
