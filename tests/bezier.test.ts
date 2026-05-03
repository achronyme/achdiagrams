/**
 * Tests for cubic Bézier geometry primitives in flowchart/bezier.ts.
 *
 * Validates:
 *  - tight bbox via root-finding equals or contains the curve at sampled points
 *  - tight bbox is strictly smaller than convex-hull bbox on non-monotone curves
 *  - self-intersection discriminant agrees with manual cases
 */

import { describe, expect, it } from 'vitest';
import {
  bezierBoundsTight,
  bezierSelfIntersects,
  cubicAt,
  findExtremaRoots1D,
} from '../src/flowchart/bezier.js';

describe('findExtremaRoots1D', () => {
  it('returns no roots for monotone increasing component', () => {
    expect(findExtremaRoots1D(0, 10, 20, 30)).toEqual([]);
  });

  it('returns no roots for monotone decreasing component', () => {
    expect(findExtremaRoots1D(100, 80, 50, 0)).toEqual([]);
  });

  it('returns one root for a single hump (parabola-like)', () => {
    const roots = findExtremaRoots1D(0, 100, 100, 0);
    expect(roots).toHaveLength(1);
    const t = roots[0];
    if (t === undefined) throw new Error('expected one root');
    expect(t).toBeGreaterThan(0.4);
    expect(t).toBeLessThan(0.6);
  });

  it('returns no roots for a constant component', () => {
    expect(findExtremaRoots1D(50, 50, 50, 50)).toEqual([]);
  });
});

describe('bezierBoundsTight', () => {
  it('matches sampled curve max within 1e-6 on a swing curve', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 100, y: 0 };
    const p2 = { x: 100, y: 100 };
    const p3 = { x: 0, y: 100 };
    const tight = bezierBoundsTight(p0, p1, p2, p3);

    // Sample densely; tight bbox must contain every sample.
    let maxX = Number.NEGATIVE_INFINITY;
    let minX = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 1000; i++) {
      const t = i / 1000;
      const p = cubicAt(t, p0, p1, p2, p3);
      if (p.x > maxX) maxX = p.x;
      if (p.x < minX) minX = p.x;
      if (p.y > maxY) maxY = p.y;
      if (p.y < minY) minY = p.y;
    }
    // Tight bbox derived from exact roots should match the sampled extrema.
    expect(tight.maxX).toBeCloseTo(maxX, 4);
    expect(tight.minX).toBeCloseTo(minX, 4);
    expect(tight.maxY).toBeCloseTo(maxY, 4);
    expect(tight.minY).toBeCloseTo(minY, 4);
  });

  it('reduces to {P0, P3} extent for a straight diagonal Bezier', () => {
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 33, y: 33 };
    const p2 = { x: 66, y: 66 };
    const p3 = { x: 100, y: 100 };
    const tight = bezierBoundsTight(p0, p1, p2, p3);
    expect(tight.minX).toBeCloseTo(0, 4);
    expect(tight.minY).toBeCloseTo(0, 4);
    expect(tight.maxX).toBeCloseTo(100, 4);
    expect(tight.maxY).toBeCloseTo(100, 4);
  });

  it('is strictly tighter than convex-hull bbox on non-monotone curve', () => {
    // A side-loop-style curve where P1, P2 push out far past P0..P3 column.
    const p0 = { x: 0, y: 0 };
    const p1 = { x: 200, y: 0 };
    const p2 = { x: 200, y: 100 };
    const p3 = { x: 0, y: 100 };
    const tight = bezierBoundsTight(p0, p1, p2, p3);
    const hullMaxX = Math.max(p0.x, p1.x, p2.x, p3.x);
    // Curve never reaches the control point's x extent (cubic Bezier
    // weighted average dampens the control point pull).
    expect(tight.maxX).toBeLessThan(hullMaxX);
    // …but the curve does extend past P0/P3 column.
    expect(tight.maxX).toBeGreaterThan(0);
  });
});

describe('bezierSelfIntersects', () => {
  it('classifies a clean S-curve as simple', () => {
    expect(
      bezierSelfIntersects({ x: 0, y: 0 }, { x: 30, y: 100 }, { x: 70, y: -100 }, { x: 100, y: 0 }),
    ).toBe('simple');
  });

  it('classifies a perfectly collinear curve as cusp (D = 0 by definition)', () => {
    // All cross-products vanish so the discriminant collapses to zero —
    // this is the cusp class even though visually the curve is a line.
    expect(
      bezierSelfIntersects({ x: 0, y: 0 }, { x: 33, y: 0 }, { x: 66, y: 0 }, { x: 100, y: 0 }),
    ).toBe('cusp');
  });

  it('classifies a near-straight curve with small lateral wiggle as simple', () => {
    expect(
      bezierSelfIntersects({ x: 0, y: 0 }, { x: 33, y: 1 }, { x: 66, y: -1 }, { x: 100, y: 0 }),
    ).toBe('simple');
  });

  it('classifies a closed loop (P0 = P3 with crossed controls) as loop', () => {
    // Both endpoints at origin, control points push out asymmetrically — typical
    // pattern that produces a loop on a short chord.
    expect(
      bezierSelfIntersects({ x: 0, y: 0 }, { x: 100, y: 100 }, { x: -100, y: 100 }, { x: 0, y: 0 }),
    ).toBe('loop');
  });
});
