/**
 * Ambient declaration for the `phaser-box2d` module.
 *
 * The package ships as plain JS without `.d.ts`. We declare it as
 * `unknown` here; the typed surface is built up explicitly in
 * `src/physics/box2d.ts` so the rest of the codebase can rely on
 * concrete types.
 */
declare module 'phaser-box2d/dist/PhaserBox2D.js';
