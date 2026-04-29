// Core: framework-agnostic algorithms and data structures.
// Public API is filled in across Phase 1 (see docs-dev/02-roadmap.md).

export { ChunkedBitmap } from './ChunkedBitmap.js';
export type { ChunkedBitmapOptions } from './ChunkedBitmap.js';
export { MaterialRegistry } from './Materials.js';
export * as Carve from './ops/Carve.js';
export * as Deposit from './ops/Deposit.js';
export * as MarchingSquares from './algorithms/MarchingSquares.js';
export type { Chunk, Contour, HitResult, Material, Point } from './types.js';
