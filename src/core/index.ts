// Core: framework-agnostic algorithms and data structures.
// Public API is filled in across Phase 1 (see docs-dev/02-roadmap.md).

export { ChunkedBitmap } from './ChunkedBitmap.js';
export type { ChunkedBitmapOptions } from './ChunkedBitmap.js';
export { MaterialRegistry } from './Materials.js';
export * as Carve from './ops/Carve.js';
export type { Chunk, Contour, HitResult, Material, Point } from './types.js';
