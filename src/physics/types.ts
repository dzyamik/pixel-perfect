/**
 * Physics-layer structural types.
 *
 * The core layer (`src/core/`) is intentionally unaware of Box2D — it
 * exposes contours and chunks as plain data. The physics layer adds
 * Box2D-specific types here, owns the bidirectional pixel-to-meter
 * coordinate conversion, and is the only layer that imports from
 * `phaser-box2d`.
 */

/**
 * Opaque handle identifying a Box2D body that this adapter created.
 *
 * The runtime value is whatever phaser-box2d returns from `b2CreateBody`
 * (an object with `index1` / `world0` / `revision` numbers); from this
 * library's perspective it is an opaque token to be passed back to the
 * adapter for destruction.
 */
export type BodyId = unknown & { readonly __brand: 'BodyId' };

/** Mirror of `BodyId` for chain shapes — opaque, returned by `b2CreateChain`. */
export type ChainId = unknown & { readonly __brand: 'ChainId' };

/** Mirror of `BodyId` for the world handle — opaque, returned by `b2CreateWorld`. */
export type WorldId = unknown & { readonly __brand: 'WorldId' };
