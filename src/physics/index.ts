// Physics: Box2D adapter.
// Public API will continue to grow across Phase 2 (see docs-dev/02-roadmap.md).

export { Box2DAdapter } from './Box2DAdapter.js';
export type { Box2DAdapterOptions } from './Box2DAdapter.js';
export { contourToChain, contourToPolygon } from './ContourToBody.js';
export type { ChainOptions, PolygonOptions } from './ContourToBody.js';
export { DeferredRebuildQueue } from './DeferredRebuildQueue.js';
export type {
    DeferredRebuildQueueOptions,
    FlushOptions,
} from './DeferredRebuildQueue.js';
export type { BodyId, ChainId, WorldId } from './types.js';
