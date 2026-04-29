import type { Contour, Point } from '../types.js';

/**
 * Simplifies a {@link Contour} using the Ramer-Douglas-Peucker algorithm.
 *
 * Marching squares emits one vertex per pixel-edge crossing, which is far
 * more than Box2D `b2ChainShape` can stably consume (manifold bugs above
 * ~16 vertices per chain, plus collinear-vertex degeneracies). RDP
 * removes interior points that lie within `epsilon` of the chord between
 * their kept neighbors. Default-tuned `epsilon ≈ 1.0` pixel typically
 * achieves ≥ 80% vertex reduction on circle contours with no visible
 * loss.
 *
 * Closed contours
 * ---------------
 * A closed contour is split at the vertex farthest from `points[0]` so
 * RDP has two stable endpoints to anchor each half-polyline. The two
 * simplified halves are then re-joined and the original "closure" is
 * preserved. If simplification would reduce a closed contour below 3
 * vertices (e.g. degenerate / collinear inputs), the original is
 * returned unchanged so consumers can keep treating it as a polygon.
 *
 * Determinism
 * -----------
 * For identical inputs and the same epsilon, the algorithm produces
 * bitwise-identical output. (The architecture doc § Determinism flags
 * this as the "residual non-determinism source" only across hardware
 * platforms with floating-point divergence; same-architecture replay is
 * reliable.)
 */
export function simplify(contour: Contour, epsilon: number): Contour {
    const { points, closed } = contour;
    if (points.length < 3) {
        return { points: [...points], closed };
    }

    if (!closed) {
        return { points: simplifyOpen(points, epsilon), closed: false };
    }

    // Closed: split at the vertex farthest from points[0] so each open
    // half has two well-separated endpoints.
    let pivot = 1;
    let pivotDistSq = -1;
    const p0 = points[0]!;
    for (let i = 1; i < points.length; i++) {
        const p = points[i]!;
        const dx = p.x - p0.x;
        const dy = p.y - p0.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > pivotDistSq) {
            pivotDistSq = distSq;
            pivot = i;
        }
    }

    const firstHalf = points.slice(0, pivot + 1);
    // Second half loops back to points[0] explicitly so simplifyOpen has
    // a closing endpoint to anchor against.
    const secondHalf = [...points.slice(pivot), points[0]!];

    const s1 = simplifyOpen(firstHalf, epsilon);
    const s2 = simplifyOpen(secondHalf, epsilon);

    // s1 ends at points[pivot]; s2 starts at points[pivot] (drop duplicate)
    // and ends at points[0] (drop, since closure is implicit).
    const combined = [...s1, ...s2.slice(1, -1)];

    if (combined.length < 3) {
        return { points: [...points], closed: true };
    }
    return { points: combined, closed: true };
}

/**
 * RDP for an open polyline. Always preserves the first and last vertex.
 */
function simplifyOpen(points: readonly Point[], epsilon: number): Point[] {
    if (points.length < 3) return [...points];

    const eps2 = epsilon * epsilon;
    const keep = new Array<boolean>(points.length).fill(false);
    keep[0] = true;
    keep[points.length - 1] = true;

    // Iterative stack to avoid blowing the call stack on long contours.
    const stack: [number, number][] = [[0, points.length - 1]];
    while (stack.length > 0) {
        const [start, end] = stack.pop()!;
        if (end - start < 2) continue;

        let maxDistSq = -1;
        let maxIdx = -1;
        const a = points[start]!;
        const b = points[end]!;
        for (let i = start + 1; i < end; i++) {
            const d = perpendicularDistanceSquared(points[i]!, a, b);
            if (d > maxDistSq) {
                maxDistSq = d;
                maxIdx = i;
            }
        }

        if (maxIdx >= 0 && maxDistSq > eps2) {
            keep[maxIdx] = true;
            stack.push([start, maxIdx], [maxIdx, end]);
        }
    }

    const out: Point[] = [];
    for (let i = 0; i < points.length; i++) {
        if (keep[i]) out.push(points[i]!);
    }
    return out;
}

/**
 * Squared perpendicular distance from `p` to the line through `a` and `b`.
 * If `a === b` (zero-length chord), falls back to squared point-to-point
 * distance.
 */
function perpendicularDistanceSquared(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) {
        const ex = p.x - a.x;
        const ey = p.y - a.y;
        return ex * ex + ey * ey;
    }
    const num = dy * (p.x - a.x) - dx * (p.y - a.y);
    return (num * num) / lenSq;
}
