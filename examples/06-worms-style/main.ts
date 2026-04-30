/**
 * Demo 06 — Worms-style.
 *
 * The "trailer piece" from the roadmap. A simple platformer where:
 *
 *   - The terrain is a destructible chunked bitmap (a wide hill).
 *   - You play a small circle character (programmer art is fine —
 *     the library is the product, not the demo).
 *   - F throws a fused grenade in the cursor direction; on detonation
 *     it carves a crater and applies a radial impulse to nearby
 *     dynamic bodies (the player and any debris).
 *   - When a carve detaches a chunk of terrain, `extractDebris()`
 *     detects it and the queue spawns a dynamic body so the chunk
 *     falls naturally.
 *
 *   ←/→ or A/D    walk
 *   ↑/W/space      jump (only when grounded)
 *   F              throw a grenade toward the cursor
 *   D (debug)      toggle collider outline overlay (lowercase d)
 *   R              reset
 *
 * What this demonstrates from the library:
 *
 *   - End-to-end pipeline: bitmap mutation → marching-squares contour
 *     extraction → triangulation → live Box2D bodies, all per-chunk
 *     and snapshot/restored across rebuilds so the player doesn't
 *     jitter when the terrain near them changes.
 *   - DebrisDetector + dynamic-body spawning for cliff slabs.
 *   - Spatial.surfaceY-style queries (we use a simple downward
 *     raycast against the bitmap) for the "is the player grounded?"
 *     check.
 */

import * as Phaser from 'phaser';
import * as b2 from 'phaser-box2d/dist/PhaserBox2D.js';
import type {
    Contour,
    DestructibleTerrain,
    Material,
    Point,
} from '../../src/index.js';
import type { BodyId, WorldId } from '../../src/physics/index.js';
import { attachStats, bootSandbox, showHint } from '../_shared/sandbox.js';

const WORLD_W = 1024;
const WORLD_H = 320;
const CHUNK_SIZE = 64;
const PIXELS_PER_METER = 32;

const DIRT: Material = {
    id: 1,
    name: 'dirt',
    color: 0x8b5a3c,
    density: 1,
    friction: 0.7,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0,
};

const STONE: Material = {
    id: 2,
    name: 'stone',
    color: 0x556070,
    density: 2.5,
    friction: 0.9,
    restitution: 0.05,
    destructible: true,
    destructionResistance: 0.5,
};

const PLAYER_RADIUS_PX = 8;
const PLAYER_DENSITY = 1;
const PLAYER_FRICTION = 0.9;
const PLAYER_MOVE_SPEED = 5; // m/s
const PLAYER_JUMP_SPEED = 8; // m/s

const GRENADE_RADIUS_PX = 4;
const GRENADE_DENSITY = 2;
const GRENADE_FUSE_MS = 1800;
const GRENADE_THROW_SPEED = 9; // m/s
const EXPLOSION_RADIUS_PX = 28;
const EXPLOSION_IMPULSE = 6; // peak impulse magnitude in Box2D N·s

interface Grenade {
    bodyId: BodyId;
    image: Phaser.GameObjects.Image;
    fuseRemainingMs: number;
}

interface Debris {
    bodyId: BodyId;
    graphics: Phaser.GameObjects.Graphics;
}

class WormsScene extends Phaser.Scene {
    private terrain!: DestructibleTerrain;
    private worldId!: WorldId;
    private terrainOriginX = 0;
    private terrainOriginY = 0;

    private playerBodyId!: BodyId;
    private playerImage!: Phaser.GameObjects.Image;

    private readonly grenades: Grenade[] = [];
    private readonly debris: Debris[] = [];

    private cursor!: Phaser.GameObjects.Graphics;
    private debug!: Phaser.GameObjects.Graphics;
    private debugOn = false;
    private stats!: ReturnType<typeof attachStats>;

    private keys!: {
        left: Phaser.Input.Keyboard.Key;
        right: Phaser.Input.Keyboard.Key;
        up: Phaser.Input.Keyboard.Key;
        a: Phaser.Input.Keyboard.Key;
        d: Phaser.Input.Keyboard.Key;
        w: Phaser.Input.Keyboard.Key;
        space: Phaser.Input.Keyboard.Key;
        f: Phaser.Input.Keyboard.Key;
        debug: Phaser.Input.Keyboard.Key;
        reset: Phaser.Input.Keyboard.Key;
    };

    constructor() {
        super('worms-style');
    }

    preload(): void {
        // Programmer-art textures: a yellow disc for the player and a
        // small red disc for the grenade. Keep it simple.
        const player = this.make.graphics({}, false);
        player.fillStyle(0xffe680, 1);
        player.fillCircle(PLAYER_RADIUS_PX, PLAYER_RADIUS_PX, PLAYER_RADIUS_PX);
        player.lineStyle(1, 0x000000, 0.6);
        player.strokeCircle(PLAYER_RADIUS_PX, PLAYER_RADIUS_PX, PLAYER_RADIUS_PX);
        // Eye marker so rotation is visible.
        player.fillStyle(0x000000, 1);
        player.fillCircle(PLAYER_RADIUS_PX + 3, PLAYER_RADIUS_PX - 1, 1.2);
        player.generateTexture('player', PLAYER_RADIUS_PX * 2, PLAYER_RADIUS_PX * 2);
        player.destroy();

        const grenade = this.make.graphics({}, false);
        grenade.fillStyle(0xc24545, 1);
        grenade.fillCircle(GRENADE_RADIUS_PX, GRENADE_RADIUS_PX, GRENADE_RADIUS_PX);
        grenade.lineStyle(1, 0x000000, 0.7);
        grenade.strokeCircle(GRENADE_RADIUS_PX, GRENADE_RADIUS_PX, GRENADE_RADIUS_PX);
        grenade.generateTexture(
            'grenade',
            GRENADE_RADIUS_PX * 2,
            GRENADE_RADIUS_PX * 2,
        );
        grenade.destroy();
    }

    create(): void {
        this.cameras.main.setBackgroundColor(0x1c2a3b);

        // Box2D world.
        b2.SetWorldScale(PIXELS_PER_METER);
        b2.b2CreateWorldArray();
        const worldDef = b2.b2DefaultWorldDef();
        worldDef.gravity.y = -18;
        this.worldId = b2.b2CreateWorld(worldDef);

        // Terrain. Centered horizontally; vertically offset so there's
        // sky above the hill.
        this.terrainOriginX = (this.scale.width - WORLD_W) / 2;
        this.terrainOriginY = (this.scale.height - WORLD_H) / 2;

        this.terrain = this.pixelPerfect.terrain({
            width: WORLD_W,
            height: WORLD_H,
            chunkSize: CHUNK_SIZE,
            x: this.terrainOriginX,
            y: this.terrainOriginY,
            worldId: this.worldId,
            pixelsPerMeter: PIXELS_PER_METER,
            materials: [DIRT, STONE],
            onDebrisCreated: ({ bodyId, contour, material }) => {
                this.spawnDebrisVisual(bodyId, contour, material);
            },
        });
        this.regenerateTerrain();

        // Player at the leftmost flat-ish spot.
        const spawnSceneX = this.terrainOriginX + 80;
        const surfaceBitmapY = this.surfaceYBitmap(80) - PLAYER_RADIUS_PX - 1;
        const spawnSceneY = this.terrainOriginY + surfaceBitmapY;
        // Player body must not rotate freely — Worms-style movement
        // wants the eye marker to stay roughly upright while we're
        // walking. `phaser-box2d`'s `CreateCircle` helper only forwards
        // `type` + `position` to the bodyDef, so we build our own with
        // `fixedRotation = true` and pass it via `bodyDef`.
        const playerBodyDef = b2.b2DefaultBodyDef();
        playerBodyDef.type = b2.DYNAMIC;
        playerBodyDef.position = new b2.b2Vec2(
            spawnSceneX / PIXELS_PER_METER,
            -spawnSceneY / PIXELS_PER_METER,
        );
        playerBodyDef.fixedRotation = true;
        const playerResult = b2.CreateCircle({
            worldId: this.worldId,
            bodyDef: playerBodyDef,
            radius: PLAYER_RADIUS_PX / PIXELS_PER_METER,
            density: PLAYER_DENSITY,
            friction: PLAYER_FRICTION,
            restitution: 0.0,
        });
        this.playerBodyId = playerResult.bodyId;
        this.playerImage = this.add.image(spawnSceneX, spawnSceneY, 'player').setDepth(50);

        // Cosmetic / overlay layers.
        this.debug = this.add.graphics().setDepth(9990);
        this.cursor = this.add.graphics().setDepth(9999);

        // Camera: follow the player horizontally, clamp to world bounds.
        this.cameras.main.setBounds(
            this.terrainOriginX - 40,
            this.terrainOriginY - 40,
            WORLD_W + 80,
            WORLD_H + 80,
        );
        this.cameras.main.startFollow(this.playerImage, true, 0.15, 0.05);

        // Input wiring.
        this.input.mouse?.disableContextMenu();
        const Keys = Phaser.Input.Keyboard.KeyCodes;
        this.keys = {
            left: this.input.keyboard!.addKey(Keys.LEFT),
            right: this.input.keyboard!.addKey(Keys.RIGHT),
            up: this.input.keyboard!.addKey(Keys.UP),
            a: this.input.keyboard!.addKey(Keys.A),
            d: this.input.keyboard!.addKey(Keys.D),
            w: this.input.keyboard!.addKey(Keys.W),
            space: this.input.keyboard!.addKey(Keys.SPACE),
            f: this.input.keyboard!.addKey(Keys.F),
            debug: this.input.keyboard!.addKey(Keys.G),
            reset: this.input.keyboard!.addKey(Keys.R),
        };

        // F (down event) → throw grenade.
        this.keys.f.on('down', () => this.throwGrenade());
        this.keys.debug.on('down', () => {
            this.debugOn = !this.debugOn;
            if (!this.debugOn) this.debug.clear();
        });
        this.keys.reset.on('down', () => this.resetScene());

        // Cursor preview.
        this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
            this.cursor.clear();
            this.cursor.lineStyle(1, 0xffffff, 0.55);
            this.cursor.strokeCircle(p.worldX, p.worldY, 4);
        });

        this.stats = attachStats(this);
        showHint(
            this,
            'arrows / WASD walk + jump · F throws a grenade toward the cursor · G debug · R reset',
            7000,
        );
    }

    override update(_time: number, deltaMs: number): void {
        // 1) Player movement: read input, set linear velocity X.
        const left = this.keys.left.isDown || this.keys.a.isDown;
        const right = this.keys.right.isDown || this.keys.d.isDown;
        const jumpPressed =
            Phaser.Input.Keyboard.JustDown(this.keys.up) ||
            Phaser.Input.Keyboard.JustDown(this.keys.w) ||
            Phaser.Input.Keyboard.JustDown(this.keys.space);

        const v = b2.b2Body_GetLinearVelocity(this.playerBodyId);
        let vx = 0;
        if (left) vx = -PLAYER_MOVE_SPEED;
        if (right) vx = PLAYER_MOVE_SPEED;
        // Preserve current vy unless we're jumping.
        let vy = v.y;
        if (jumpPressed && this.isPlayerGrounded()) {
            vy = PLAYER_JUMP_SPEED;
        }
        b2.b2Body_SetLinearVelocity(this.playerBodyId, new b2.b2Vec2(vx, vy));

        // 2) Tick grenade fuses.
        for (let i = this.grenades.length - 1; i >= 0; i--) {
            const g = this.grenades[i]!;
            g.fuseRemainingMs -= deltaMs;
            if (g.fuseRemainingMs <= 0) {
                this.detonateGrenade(g);
                this.grenades.splice(i, 1);
            }
        }

        // 3) Debris extraction. Cheap (O(W·H) flood fill, but only when
        //    something detached). Run every frame so cliff slabs detach
        //    the moment a grenade severs them.
        this.terrain.extractDebris();

        // 4) Terrain rebuild + visual repaint MUST happen before the
        //    world step so the step sees fresh polygons. The plugin
        //    auto-flushes on POST_UPDATE which is too late for the
        //    same-frame WorldStep we run here.
        this.terrain.update();

        // 5) Step physics.
        b2.WorldStep({ worldId: this.worldId, deltaTime: deltaMs / 1000 });

        // 6) Sync sprites with bodies.
        this.syncSprite(this.playerImage, this.playerBodyId);
        for (const g of this.grenades) this.syncSprite(g.image, g.bodyId);
        for (let i = this.debris.length - 1; i >= 0; i--) {
            const d = this.debris[i]!;
            this.syncSprite(d.graphics, d.bodyId);
            // Cull debris that fell off-world.
            if (d.graphics.y > this.terrainOriginY + WORLD_H + 200) {
                b2.b2DestroyBody(d.bodyId);
                d.graphics.destroy();
                this.debris.splice(i, 1);
            }
        }

        if (this.debugOn) this.drawDebug();
        this.stats.update({
            grenades: this.grenades.length,
            debris: this.debris.length,
            v: `${v.x.toFixed(1)}, ${v.y.toFixed(1)}`,
        });
    }

    private syncSprite(
        obj: Phaser.GameObjects.Image | Phaser.GameObjects.Graphics,
        bodyId: BodyId,
    ): void {
        const pos = b2.b2Body_GetPosition(bodyId);
        const rot = b2.b2Body_GetRotation(bodyId);
        obj.x = pos.x * PIXELS_PER_METER;
        obj.y = -pos.y * PIXELS_PER_METER;
        obj.rotation = -Math.atan2(rot.s, rot.c);
    }

    /**
     * Scene -> bitmap Y of the first solid pixel below `bitmapX`. Used
     * to spawn the player and to detect "grounded" via a tiny
     * downward probe.
     */
    private surfaceYBitmap(bitmapX: number): number {
        const bm = this.terrain.bitmap;
        for (let y = 0; y < WORLD_H; y++) {
            if (bm.getPixel(bitmapX, y) > 0) return y;
        }
        return WORLD_H;
    }

    /**
     * "Grounded" check: read the player's current scene-space position,
     * convert to bitmap coords, sample a couple of pixels just below
     * the player's feet. If any of them are solid, we're grounded.
     * Avoids a Box2D contact listener.
     */
    private isPlayerGrounded(): boolean {
        const pos = b2.b2Body_GetPosition(this.playerBodyId);
        const sceneX = pos.x * PIXELS_PER_METER;
        const sceneY = -pos.y * PIXELS_PER_METER;
        // Foot is at sceneY + radius; sample 1-2 pixels below that.
        const bm = this.terrain.bitmap;
        const footBitmapY = Math.round(sceneY - this.terrainOriginY + PLAYER_RADIUS_PX);
        const cx = Math.round(sceneX - this.terrainOriginX);
        for (let dx = -2; dx <= 2; dx++) {
            for (let dy = 0; dy <= 2; dy++) {
                if (bm.getPixel(cx + dx, footBitmapY + dy) > 0) return true;
            }
        }
        return false;
    }

    private throwGrenade(): void {
        const playerPos = b2.b2Body_GetPosition(this.playerBodyId);
        const playerSceneX = playerPos.x * PIXELS_PER_METER;
        const playerSceneY = -playerPos.y * PIXELS_PER_METER;
        const target = this.input.activePointer;
        const dx = target.worldX - playerSceneX;
        const dy = target.worldY - playerSceneY;
        const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        // Box2D y is inverted vs scene y, so the y component of the
        // velocity flips sign relative to the scene-space direction.
        const vx = (dx / len) * GRENADE_THROW_SPEED;
        const vyScene = (dy / len) * GRENADE_THROW_SPEED;

        // Spawn slightly in front of the player so the grenade isn't
        // born inside the player's circle.
        const spawnSceneX = playerSceneX + (dx / len) * (PLAYER_RADIUS_PX + GRENADE_RADIUS_PX + 1);
        const spawnSceneY = playerSceneY + (dy / len) * (PLAYER_RADIUS_PX + GRENADE_RADIUS_PX + 1);

        const result = b2.CreateCircle({
            worldId: this.worldId,
            type: b2.DYNAMIC,
            position: new b2.b2Vec2(
                spawnSceneX / PIXELS_PER_METER,
                -spawnSceneY / PIXELS_PER_METER,
            ),
            radius: GRENADE_RADIUS_PX / PIXELS_PER_METER,
            density: GRENADE_DENSITY,
            friction: 0.4,
            restitution: 0.45,
        });
        b2.b2Body_SetLinearVelocity(result.bodyId, new b2.b2Vec2(vx, -vyScene));

        const image = this.add.image(spawnSceneX, spawnSceneY, 'grenade').setDepth(60);
        this.grenades.push({ bodyId: result.bodyId, image, fuseRemainingMs: GRENADE_FUSE_MS });
    }

    private detonateGrenade(g: Grenade): void {
        const pos = b2.b2Body_GetPosition(g.bodyId);
        const sceneX = pos.x * PIXELS_PER_METER;
        const sceneY = -pos.y * PIXELS_PER_METER;

        // Carve the crater.
        this.terrain.carve.circle(sceneX, sceneY, EXPLOSION_RADIUS_PX);

        // Apply radial impulse to dynamic bodies in blast range. We
        // walk the player + all debris + remaining grenades.
        const blastMeters = (EXPLOSION_RADIUS_PX + 16) / PIXELS_PER_METER;
        const candidates: BodyId[] = [this.playerBodyId];
        for (const d of this.debris) candidates.push(d.bodyId);
        for (const other of this.grenades) {
            if (other.bodyId !== g.bodyId) candidates.push(other.bodyId);
        }
        for (const bodyId of candidates) {
            const p = b2.b2Body_GetPosition(bodyId);
            const dxM = p.x - pos.x;
            const dyM = p.y - pos.y;
            const distM = Math.sqrt(dxM * dxM + dyM * dyM);
            if (distM === 0 || distM > blastMeters) continue;
            // Linear falloff from 1 at center to 0 at the blast edge.
            const falloff = 1 - distM / blastMeters;
            const impulse = EXPLOSION_IMPULSE * falloff;
            const ix = (dxM / distM) * impulse;
            const iy = (dyM / distM) * impulse;
            b2.b2Body_ApplyLinearImpulseToCenter(bodyId, new b2.b2Vec2(ix, iy), true);
        }

        // Brief flash for visual feedback.
        const flash = this.add
            .circle(sceneX, sceneY, EXPLOSION_RADIUS_PX, 0xfff2a1, 0.65)
            .setDepth(70);
        this.tweens.add({
            targets: flash,
            alpha: 0,
            scale: 1.4,
            duration: 220,
            onComplete: () => flash.destroy(),
        });

        // Cleanup grenade.
        b2.b2DestroyBody(g.bodyId);
        g.image.destroy();
    }

    private spawnDebrisVisual(
        bodyId: BodyId,
        contour: Contour,
        material: Material,
    ): void {
        let sumX = 0;
        let sumY = 0;
        for (const p of contour.points) {
            sumX += p.x;
            sumY += p.y;
        }
        const cx = sumX / contour.points.length;
        const cy = sumY / contour.points.length;
        const localPoints: Point[] = contour.points.map((p) => ({
            x: p.x - cx,
            y: p.y - cy,
        }));

        const g = this.add.graphics().setDepth(40);
        g.fillStyle(material.color, 1);
        g.lineStyle(1, 0x000000, 0.4);
        g.beginPath();
        const first = localPoints[0]!;
        g.moveTo(first.x, first.y);
        for (let i = 1; i < localPoints.length; i++) {
            g.lineTo(localPoints[i]!.x, localPoints[i]!.y);
        }
        g.closePath();
        g.fillPath();
        g.strokePath();

        this.debris.push({ bodyId, graphics: g });
    }

    private drawDebug(): void {
        this.debug.clear();
        this.debug.lineStyle(1, 0x4ec9b0, 0.85);
        for (const chunk of this.terrain.bitmap.chunks) {
            if (chunk.contours === null) continue;
            for (const contour of chunk.contours) {
                if (contour.points.length < 2) continue;
                this.debug.beginPath();
                const first = contour.points[0]!;
                this.debug.moveTo(
                    first.x + this.terrainOriginX,
                    first.y + this.terrainOriginY,
                );
                for (let i = 1; i < contour.points.length; i++) {
                    const p = contour.points[i]!;
                    this.debug.lineTo(p.x + this.terrainOriginX, p.y + this.terrainOriginY);
                }
                if (contour.closed) this.debug.closePath();
                this.debug.strokePath();
            }
        }
    }

    /**
     * Hilly procedural terrain: a chunky low-frequency surface plus
     * a higher-frequency wiggle. Top 12 px are dirt, below that is
     * stone — gives the demo two materials so debris visuals vary.
     */
    private regenerateTerrain(): void {
        const bm = this.terrain.bitmap;
        for (let y = 0; y < WORLD_H; y++) {
            for (let x = 0; x < WORLD_W; x++) {
                bm.setPixel(x, y, 0);
            }
        }
        const surface = (x: number) => {
            const t = x / WORLD_W;
            const low = Math.sin(t * Math.PI * 2) * 32;
            const mid = Math.sin(t * Math.PI * 5) * 12;
            const high = Math.sin(t * Math.PI * 13) * 4;
            return Math.floor(WORLD_H * 0.55 + low + mid + high);
        };
        for (let x = 0; x < WORLD_W; x++) {
            const sy = surface(x);
            for (let y = sy; y < WORLD_H; y++) {
                bm.setPixel(x, y, y - sy < 12 ? 1 : 2);
            }
        }
    }

    private resetScene(): void {
        // Cleanest: rebuild terrain + reset player to spawn + clear
        // grenades and debris. The plugin auto-destroys the terrain on
        // scene shutdown, but we're not shutting down the scene — just
        // resetting state.
        this.regenerateTerrain();
        for (const g of this.grenades) {
            b2.b2DestroyBody(g.bodyId);
            g.image.destroy();
        }
        this.grenades.length = 0;
        for (const d of this.debris) {
            b2.b2DestroyBody(d.bodyId);
            d.graphics.destroy();
        }
        this.debris.length = 0;

        const bitmapX = 80;
        const surfaceBitmapY = this.surfaceYBitmap(bitmapX) - PLAYER_RADIUS_PX - 1;
        const sceneX = this.terrainOriginX + bitmapX;
        const sceneY = this.terrainOriginY + surfaceBitmapY;
        b2.b2Body_SetTransform(
            this.playerBodyId,
            new b2.b2Vec2(sceneX / PIXELS_PER_METER, -sceneY / PIXELS_PER_METER),
            new b2.b2Rot(1, 0),
        );
        b2.b2Body_SetLinearVelocity(this.playerBodyId, new b2.b2Vec2(0, 0));
    }
}

bootSandbox({
    width: 720,
    height: 360,
    scene: WormsScene,
});
