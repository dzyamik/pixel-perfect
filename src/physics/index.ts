// Physics: Box2D adapter and the body lifecycle layer.
// All consumer-facing physics types live here.

export { Box2DAdapter } from './Box2DAdapter.js';
export type { Box2DAdapterOptions } from './Box2DAdapter.js';
export { contourToChain, contourToPolygon } from './ContourToBody.js';
export type { ChainOptions, PolygonOptions } from './ContourToBody.js';
export * as DebrisDetector from './DebrisDetector.js';
export { DeferredRebuildQueue } from './DeferredRebuildQueue.js';
export type {
    DeferredRebuildQueueOptions,
    FlushOptions,
} from './DeferredRebuildQueue.js';
export type { BodyId, ChainId, WorldId } from './types.js';
