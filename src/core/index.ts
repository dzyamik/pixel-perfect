// Core: framework-agnostic algorithms and data structures.
// Public API is filled in across Phase 1 (see docs-dev/02-roadmap.md).

export { ChunkedBitmap } from './ChunkedBitmap.js';
export type { ChunkedBitmapOptions } from './ChunkedBitmap.js';
export { MaterialRegistry } from './Materials.js';
export * as Carve from './ops/Carve.js';
export * as Deposit from './ops/Deposit.js';
export type { AlphaSource } from './ops/raster.js';
export * as DouglasPeucker from './algorithms/DouglasPeucker.js';
export * as FloodFill from './algorithms/FloodFill.js';
export * as MarchingSquares from './algorithms/MarchingSquares.js';
export * as AlphaOverlap from './queries/AlphaOverlap.js';
export type { AlphaMask } from './queries/AlphaOverlap.js';
export * as CellularAutomaton from './algorithms/CellularAutomaton.js';
export * as Spatial from './queries/Spatial.js';
export type {
    Chunk,
    Contour,
    HitResult,
    Island,
    Material,
    Point,
    SimulationKind,
} from './types.js';
