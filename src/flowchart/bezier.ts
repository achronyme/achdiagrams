/**
 * Cubic Bézier geometry primitives.
 *
 * Provides:
 *  - `cubicAt`: point on curve at parameter t
 *  - `findExtremaRoots1D`: roots of B'(t) = 0 in (0,1) for one component
 *  - `bezierBoundsTight`: exact axis-aligned bbox via root-finding
 *  - `bezierSelfIntersects`: cusp/loop discriminant
 *
 * Math derived in `.claude/research/external/gemini-2026-05-02-bezier-q3.md`.
 * Coefficients re-derived locally from B'(t) expansion of cubic Bézier.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const EPS = 1e-9;

export function cubicAt(t: number, p0: Point, p1: Point, p2: Point, p3: Point): Point {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
    y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
  };
}

/**
 * Roots of B'_c(t) = 0 in (0, 1) for a single component c ∈ {x, y}.
 *
 * Coefficients of the quadratic at² + bt + c = 0:
 *   a = 3·(P3 − 3·P2 + 3·P1 − P0)
 *   b = 6·(P2 − 2·P1 + P0)
 *   c = 3·(P1 − P0)
 *
 * Degenerate cases: |a| ≈ 0 (linear), |b| ≈ 0 too (constant), Δ < 0 (monotone).
 */
export function findExtremaRoots1D(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = 3 * (p3 - 3 * p2 + 3 * p1 - p0);
  const b = 6 * (p2 - 2 * p1 + p0);
  const c = 3 * (p1 - p0);

  if (Math.abs(a) < EPS) {
    if (Math.abs(b) < EPS) return [];
    const t = -c / b;
    return t > EPS && t < 1 - EPS ? [t] : [];
  }

  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];

  const sq = Math.sqrt(disc);
  const t1 = (-b + sq) / (2 * a);
  const t2 = (-b - sq) / (2 * a);

  const out: number[] = [];
  if (t1 > EPS && t1 < 1 - EPS) out.push(t1);
  if (t2 > EPS && t2 < 1 - EPS) out.push(t2);
  return out;
}

/**
 * Exact axis-aligned bounding box of a cubic Bézier defined by P0..P3.
 *
 * Always includes endpoints (t=0, t=1) plus interior extrema for both components.
 */
export function bezierBoundsTight(p0: Point, p1: Point, p2: Point, p3: Point): Bounds {
  const ts = new Set<number>([0, 1]);
  for (const t of findExtremaRoots1D(p0.x, p1.x, p2.x, p3.x)) ts.add(t);
  for (const t of findExtremaRoots1D(p0.y, p1.y, p2.y, p3.y)) ts.add(t);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const t of ts) {
    const p = cubicAt(t, p0, p1, p2, p3);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Loop / cusp discriminant for a planar cubic Bézier.
 *
 *   d0 = P1 − P0,  d1 = P2 − P1,  d2 = P3 − P2
 *   k1 = cross(d0, d2),  k2 = cross(d0, d1),  k3 = cross(d1, d2)
 *   D  = k1² − 4·k2·k3
 *
 * Returns 'loop' (D < 0), 'cusp' (D ≈ 0), or 'simple' (D > 0).
 */
export type CubicShape = 'loop' | 'cusp' | 'simple';

export function bezierSelfIntersects(p0: Point, p1: Point, p2: Point, p3: Point): CubicShape {
  const d0 = { x: p1.x - p0.x, y: p1.y - p0.y };
  const d1 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const d2 = { x: p3.x - p2.x, y: p3.y - p2.y };

  const k1 = d0.x * d2.y - d0.y * d2.x;
  const k2 = d0.x * d1.y - d0.y * d1.x;
  const k3 = d1.x * d2.y - d1.y * d2.x;

  const disc = k1 * k1 - 4 * k2 * k3;
  if (disc < -EPS) return 'loop';
  if (disc > EPS) return 'simple';
  return 'cusp';
}
