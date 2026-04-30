// Physics: Box2D adapter and the body lifecycle layer.
// All consumer-facing physics types live here.

export { Box2DAdapter } from './Box2DAdapter.js';
export type { Box2DAdapterOptions, BodySnapshot } from './Box2DAdapter.js';
export { chunkToContours, componentToContours } from './ContourExtractor.js';
export {
    contourToChain,
    contourToPolygon,
    contourToTriangles,
} from './ContourToBody.js';
export type {
    BaseShapeOptions,
    ChainOptions,
    PolygonOptions,
} from './ContourToBody.js';
export * as DebrisDetector from './DebrisDetector.js';
export { DeferredRebuildQueue } from './DeferredRebuildQueue.js';
export type {
    DeferredRebuildQueueOptions,
    FlushOptions,
} from './DeferredRebuildQueue.js';
export type { BodyId, ChainId, WorldId } from './types.js';
