/**
 * Shared utilities for the example demos. These are NOT part of the
 * library — they're convenience wrappers so each demo can stay terse and
 * focus on what it's exercising.
 */

import * as Phaser from 'phaser';

import { PixelPerfectPlugin } from '../../src/index.js';

/** Default game config used by the demos. Override per-demo as needed. */
export interface SandboxConfig {
    /** Logical render width. Defaults to 640. */
    width?: number;
    /** Logical render height. Defaults to 360. */
    height?: number;
    /** Background color (0xRRGGBB). Defaults to dark blue-grey. */
    background?: number;
    /** Container element id. Defaults to 'app'. */
    parent?: string;
    /** A Phaser scene class or scene config. */
    scene: Phaser.Types.Scenes.SceneType | Phaser.Types.Scenes.SceneType[];
}

/**
 * Boots a Phaser game with sensible demo defaults. Returns the `Game`
 * instance so the demo can manage its lifecycle if needed.
 */
export function bootSandbox(config: SandboxConfig): Phaser.Game {
    return new Phaser.Game({
        type: Phaser.AUTO,
        parent: config.parent ?? 'app',
        width: config.width ?? 640,
        height: config.height ?? 360,
        backgroundColor: config.background ?? 0x1a1d23,
        pixelArt: true,
        scene: config.scene,
        plugins: {
            scene: [
                {
                    key: 'PixelPerfectPlugin',
                    plugin: PixelPerfectPlugin,
                    mapping: 'pixelPerfect',
                },
            ],
        },
    });
}

/**
 * Drop-in FPS / chunk-rebuild counter overlay. Add to any scene by
 * calling `attachStats(scene, terrain?)`. Renders top-left.
 *
 * The terrain reference is optional; when provided the overlay also
 * tracks pending-rebuild and chunk-dirty counts.
 */
export interface StatsHandle {
    /** Update the displayed values. Call from `update()`. */
    update(extras?: Record<string, string | number>): void;
    /** Remove the overlay from the scene. */
    destroy(): void;
}

export function attachStats(scene: Phaser.Scene): StatsHandle {
    const text = scene.add
        .text(8, 6, '', {
            fontSize: '12px',
            fontFamily: 'monospace',
            color: '#cfd6e0',
            backgroundColor: 'rgba(0,0,0,0.5)',
            padding: { x: 6, y: 4 },
        })
        .setScrollFactor(0)
        .setDepth(10000);

    const fpsHistory: number[] = [];
    const HISTORY = 30;

    return {
        update(extras: Record<string, string | number> = {}) {
            const fps = scene.game.loop.actualFps;
            fpsHistory.push(fps);
            if (fpsHistory.length > HISTORY) fpsHistory.shift();
            const avgFps =
                fpsHistory.reduce((a, b) => a + b, 0) / Math.max(1, fpsHistory.length);

            const lines = [`fps ${avgFps.toFixed(1)} (${fps.toFixed(0)})`];
            for (const [k, v] of Object.entries(extras)) {
                lines.push(`${k} ${v}`);
            }
            text.setText(lines.join('\n'));
        },
        destroy() {
            text.destroy();
        },
    };
}

/**
 * Show a transient toast message. Useful for demo callouts ("click to
 * carve", "press R to reset", etc.). Returns a function to dismiss early.
 */
export function showHint(scene: Phaser.Scene, message: string, durationMs = 4000): () => void {
    const w = scene.scale.width;
    const text = scene.add
        .text(w / 2, 12, message, {
            fontSize: '13px',
            fontFamily: 'monospace',
            color: '#ffffff',
            backgroundColor: 'rgba(20,30,40,0.85)',
            padding: { x: 10, y: 6 },
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setDepth(10001);

    const timer = scene.time.delayedCall(durationMs, () => text.destroy());
    return () => {
        timer.remove();
        text.destroy();
    };
}
