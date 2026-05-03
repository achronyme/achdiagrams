/**
 * Flowchart layout — TB by default, supports cycles via DFS back-edge reversal.
 *
 * Strategy:
 * 1. Detect back-edges via DFS (graph may have cycles in flowcharts; loop-back
 *    from a decision is canonical).
 * 2. Layer the resulting DAG with longest-path on the forward edges.
 * 3. Within each layer, order by declaration.
 * 4. Position nodes; edges keep their original from/to but track whether they
 *    were reversed for layering (the renderer routes them differently).
 */

import type { FlowEdge, FlowNode, FlowchartDiagram } from '../types.js';
import { bezierBoundsTight, bezierSelfIntersects } from './bezier.js';
import { type FlowShape, widthFactorFor } from './shapes.js';

export interface FlowLayoutOptions {
  direction?: 'TB' | 'LR';
  nodeHeight?: number;
  layerSpacing?: number;
  withinLayerSpacing?: number;
  padding?: number;
  charWidth?: number;
  minNodeWidth?: number;
}

export interface PositionedFlowNode {
  id: string;
  label: string;
  shape: FlowShape;
  x: number;
  y: number;
  width: number;
  height: number;
  subtitle?: string;
}

export type EdgeRouting = 'direct' | 'side-loop';

export interface PositionedFlowEdge {
  from: string;
  to: string;
  label?: string;
  routing: EdgeRouting;
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  fromAnchor: 'top' | 'right' | 'bottom' | 'left';
  toAnchor: 'top' | 'right' | 'bottom' | 'left';
  // Cubic Bézier control points; the renderer uses them directly and the
  // layout includes them in `bounds` so detoured side-loops never clip.
  c1: { x: number; y: number };
  c2: { x: number; y: number };
}

const ARROW_INSET = 8;

export interface FlowchartLayout {
  direction: 'TB' | 'LR';
  nodes: PositionedFlowNode[];
  edges: PositionedFlowEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const DEFAULTS = {
  direction: 'TB' as const,
  nodeHeight: 56,
  layerSpacing: 56,
  withinLayerSpacing: 32,
  padding: 24,
  charWidth: 7.5,
  textPaddingX: 28,
  minNodeWidth: 96,
};

export function layoutFlowchart(
  ir: FlowchartDiagram,
  options: FlowLayoutOptions = {},
): FlowchartLayout {
  const direction = options.direction ?? DEFAULTS.direction;
  const nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
  const layerSpacing = options.layerSpacing ?? DEFAULTS.layerSpacing;
  const withinLayerSpacing = options.withinLayerSpacing ?? DEFAULTS.withinLayerSpacing;
  const padding = options.padding ?? DEFAULTS.padding;
  const charWidth = options.charWidth ?? DEFAULTS.charWidth;
  const minNodeWidth = options.minNodeWidth ?? DEFAULTS.minNodeWidth;

  const reversed = detectBackEdges(ir);

  const layers = assignLayers(ir, reversed);
  const layersByIndexRaw = groupByLayer(ir, layers);
  const layersByIndex = reduceCrossings(layersByIndexRaw, layers, ir.edges, reversed);

  const nodeMeta = new Map(ir.nodes.map((n) => [n.id, n]));

  const widths = new Map<string, number>();
  const heights = new Map<string, number>();
  for (const n of ir.nodes) {
    const labelChars = Math.max(n.label.length, n.subtitle?.length ?? 0);
    const labelWidth = Math.ceil(labelChars * charWidth) + DEFAULTS.textPaddingX;
    const factor = widthFactorFor(n.shape);
    widths.set(n.id, Math.max(minNodeWidth, Math.round(labelWidth * factor)));
    // Subtitle adds a second line of text — bump the height to keep padding.
    heights.set(n.id, n.subtitle !== undefined ? nodeHeight + 18 : nodeHeight);
  }

  const positioned = new Map<string, PositionedFlowNode>();
  const sortedLayerEntries = sortedLayers(layersByIndex);

  if (direction === 'TB') {
    const layerWidthFor = (ids: string[]): number =>
      ids.reduce((a, id) => a + (widths.get(id) ?? minNodeWidth), 0) +
      (ids.length - 1) * withinLayerSpacing;

    const maxLayerWidth = Math.max(...sortedLayerEntries.map(([, ids]) => layerWidthFor(ids)));
    const globalCenterX = padding + maxLayerWidth / 2;

    let cursorY = padding;
    for (const [, ids] of sortedLayerEntries) {
      const layerWidth = layerWidthFor(ids);
      const layerHeight = Math.max(...ids.map((id) => heights.get(id) ?? nodeHeight));
      let cursorX = globalCenterX - layerWidth / 2;
      for (const id of ids) {
        const n = nodeMeta.get(id);
        if (!n) continue;
        const w = widths.get(id) ?? minNodeWidth;
        const h = heights.get(id) ?? nodeHeight;
        positioned.set(id, {
          id,
          label: n.label,
          shape: n.shape,
          x: cursorX,
          y: cursorY + (layerHeight - h) / 2,
          width: w,
          height: h,
          ...(n.subtitle !== undefined ? { subtitle: n.subtitle } : {}),
        });
        cursorX += w + withinLayerSpacing;
      }
      cursorY += layerHeight + layerSpacing;
    }
  } else {
    const layerHeightFor = (ids: string[]): number =>
      ids.reduce((a, id) => a + (heights.get(id) ?? nodeHeight), 0) +
      (ids.length - 1) * withinLayerSpacing;
    const maxLayerHeight = Math.max(...sortedLayerEntries.map(([, ids]) => layerHeightFor(ids)));
    const globalCenterY = padding + maxLayerHeight / 2;

    let cursorX = padding;
    for (const [, ids] of sortedLayerEntries) {
      const layerHeight = layerHeightFor(ids);
      const maxW = Math.max(...ids.map((id) => widths.get(id) ?? minNodeWidth));
      let cursorY = globalCenterY - layerHeight / 2;
      for (const id of ids) {
        const n = nodeMeta.get(id);
        if (!n) continue;
        const w = widths.get(id) ?? minNodeWidth;
        const h = heights.get(id) ?? nodeHeight;
        positioned.set(id, {
          id,
          label: n.label,
          shape: n.shape,
          x: cursorX + (maxW - w) / 2,
          y: cursorY,
          width: w,
          height: h,
          ...(n.subtitle !== undefined ? { subtitle: n.subtitle } : {}),
        });
        cursorY += h + withinLayerSpacing;
      }
      cursorX += maxW + layerSpacing;
    }
  }

  const edges: PositionedFlowEdge[] = ir.edges.map((e, idx) => {
    const wasReversed = reversed.has(idx);
    const f = positioned.get(e.from);
    const t = positioned.get(e.to);
    if (!f || !t) {
      throw new Error(`Internal: edge references unknown node ${e.from} -> ${e.to}`);
    }
    const span = Math.abs((layers.get(e.to) ?? 0) - (layers.get(e.from) ?? 0));
    const routing: EdgeRouting = wasReversed || span > 1 ? 'side-loop' : 'direct';
    const { fromAnchor, toAnchor } = resolveAnchors(f, t, direction, routing);
    const fromPoint = anchorPoint(f, fromAnchor);
    const toPoint = anchorPoint(t, toAnchor);
    const tip = insetPoint(toPoint, toAnchor);
    const { c1, c2 } = computeControlPoints(fromPoint, tip, fromAnchor, toAnchor, routing);
    return {
      from: e.from,
      to: e.to,
      ...(e.label !== undefined ? { label: e.label } : {}),
      routing,
      fromPoint,
      toPoint,
      fromAnchor,
      toAnchor,
      c1,
      c2,
    };
  });

  const nodes = [...positioned.values()];
  return { direction, nodes, edges, bounds: computeBounds(nodes, edges, padding) };
}

function insetPoint(
  p: { x: number; y: number },
  side: 'top' | 'right' | 'bottom' | 'left',
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: p.x, y: p.y - ARROW_INSET };
    case 'bottom':
      return { x: p.x, y: p.y + ARROW_INSET };
    case 'left':
      return { x: p.x - ARROW_INSET, y: p.y };
    case 'right':
      return { x: p.x + ARROW_INSET, y: p.y };
  }
}

function computeControlPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSide: 'top' | 'right' | 'bottom' | 'left',
  toSide: 'top' | 'right' | 'bottom' | 'left',
  routing: EdgeRouting,
): { c1: { x: number; y: number }; c2: { x: number; y: number } } {
  if (routing === 'side-loop') {
    return computeSideLoopControlPoints(from, to, fromSide, toSide);
  }
  const verticalFlow = fromSide === 'bottom' || fromSide === 'top';
  if (verticalFlow) {
    const midY = from.y + (to.y - from.y) / 2;
    return { c1: { x: from.x, y: midY }, c2: { x: to.x, y: midY } };
  }
  const midX = from.x + (to.x - from.x) / 2;
  return { c1: { x: midX, y: from.y }, c2: { x: midX, y: to.y } };
}

/**
 * Side-loop control points with adaptive detour magnitude.
 *
 * Initial detour follows the empirical `clamp(60, chord*0.4, 160)` heuristic
 * that produces visually pleasant C-shapes for typical flowchart layouts.
 * If the resulting cubic self-intersects (Stone-DeRose discriminant — see
 * `bezierSelfIntersects`), we grow the detour up to 4 doublings to escape
 * the loop region. The growth is bounded so we never produce wildly oversized
 * curves on pathological inputs.
 */
function computeSideLoopControlPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSide: 'top' | 'right' | 'bottom' | 'left',
  toSide: 'top' | 'right' | 'bottom' | 'left',
): { c1: { x: number; y: number }; c2: { x: number; y: number } } {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  let detour = Math.max(60, Math.min(160, chord * 0.4));
  const cFor = (
    p: { x: number; y: number },
    side: 'top' | 'right' | 'bottom' | 'left',
    d: number,
  ): { x: number; y: number } => {
    switch (side) {
      case 'right':
        return { x: p.x + d, y: p.y };
      case 'left':
        return { x: p.x - d, y: p.y };
      case 'bottom':
        return { x: p.x, y: p.y + d };
      case 'top':
        return { x: p.x, y: p.y - d };
    }
  };
  for (let i = 0; i < 4; i++) {
    const c1 = cFor(from, fromSide, detour);
    const c2 = cFor(to, toSide, detour);
    if (bezierSelfIntersects(from, c1, c2, to) !== 'loop') return { c1, c2 };
    detour *= 1.5;
  }
  return { c1: cFor(from, fromSide, detour), c2: cFor(to, toSide, detour) };
}

function detectBackEdges(ir: FlowchartDiagram): Set<number> {
  const out = new Map<string, Array<{ to: string; idx: number }>>();
  for (const n of ir.nodes) out.set(n.id, []);
  ir.edges.forEach((e, idx) => out.get(e.from)?.push({ to: e.to, idx }));

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const n of ir.nodes) color.set(n.id, WHITE);

  const back = new Set<number>();
  const dfs = (u: string) => {
    color.set(u, GRAY);
    for (const { to: v, idx } of out.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) {
        back.add(idx);
      } else if (c === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
  };

  for (const n of ir.nodes) {
    if (color.get(n.id) === WHITE) dfs(n.id);
  }
  return back;
}

function assignLayers(ir: FlowchartDiagram, reversed: Set<number>): Map<string, number> {
  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();
  for (const n of ir.nodes) {
    inEdges.set(n.id, []);
    outEdges.set(n.id, []);
  }
  ir.edges.forEach((e, idx) => {
    if (reversed.has(idx)) {
      inEdges.get(e.from)?.push(e.to);
      outEdges.get(e.to)?.push(e.from);
    } else {
      inEdges.get(e.to)?.push(e.from);
      outEdges.get(e.from)?.push(e.to);
    }
  });

  const inDeg = new Map<string, number>();
  for (const n of ir.nodes) inDeg.set(n.id, inEdges.get(n.id)?.length ?? 0);

  const queue: string[] = [];
  for (const n of ir.nodes) if ((inDeg.get(n.id) ?? 0) === 0) queue.push(n.id);

  const topo: string[] = [];
  while (queue.length > 0) {
    const u = queue.shift();
    if (u === undefined) break;
    topo.push(u);
    for (const v of outEdges.get(u) ?? []) {
      const d = (inDeg.get(v) ?? 0) - 1;
      inDeg.set(v, d);
      if (d === 0) queue.push(v);
    }
  }

  const layer = new Map<string, number>();
  for (const u of topo) {
    let maxPred = -1;
    for (const p of inEdges.get(u) ?? []) {
      maxPred = Math.max(maxPred, layer.get(p) ?? 0);
    }
    layer.set(u, maxPred + 1);
  }
  return layer;
}

/**
 * Sugiyama phase 3 — crossing reduction via barycenter heuristic.
 *
 * For each adjacent layer pair (L, L+1) we compute, for every node in L+1,
 * the average position of its predecessors in L; sorting L+1 by that
 * barycenter empirically minimises edge crossings. We sweep down then up
 * for a few iterations (4 by default — well past the point of diminishing
 * returns for typical 1-2 dozen-layer graphs).
 *
 * Only direct (1-layer-span) edges contribute to the barycenter calculation;
 * back-edges and long edges are routed via side-loops and don't influence
 * within-layer ordering.
 */
function reduceCrossings(
  byLayer: Map<number, string[]>,
  layers: Map<string, number>,
  edges: ReadonlyArray<{ from: string; to: string }>,
  reversed: Set<number>,
  iterations = 4,
): Map<number, string[]> {
  const sortedKeys = [...byLayer.keys()].sort((a, b) => a - b);

  const upNeighbors = new Map<string, string[]>();
  const downNeighbors = new Map<string, string[]>();
  for (const ids of byLayer.values()) {
    for (const id of ids) {
      upNeighbors.set(id, []);
      downNeighbors.set(id, []);
    }
  }
  edges.forEach((e, idx) => {
    const fromLayer = layers.get(e.from) ?? 0;
    const toLayer = layers.get(e.to) ?? 0;
    const span = Math.abs(toLayer - fromLayer);
    if (span !== 1) return;
    const isReversed = reversed.has(idx);
    const realFrom = isReversed ? e.to : e.from;
    const realTo = isReversed ? e.from : e.to;
    downNeighbors.get(realFrom)?.push(realTo);
    upNeighbors.get(realTo)?.push(realFrom);
  });

  const ordered = new Map<number, string[]>();
  for (const k of sortedKeys) ordered.set(k, [...(byLayer.get(k) ?? [])]);

  const sortLayer = (
    ids: string[],
    refLayerIds: string[],
    sideLookup: Map<string, string[]>,
  ): void => {
    const refPos = new Map<string, number>();
    refLayerIds.forEach((id, i) => refPos.set(id, i));
    const baryMap = new Map<string, number>();
    ids.forEach((id, i) => {
      const refs = sideLookup.get(id) ?? [];
      let sum = 0;
      let count = 0;
      for (const r of refs) {
        const p = refPos.get(r);
        if (p !== undefined) {
          sum += p;
          count++;
        }
      }
      baryMap.set(id, count > 0 ? sum / count : i);
    });
    ids.sort((a, b) => (baryMap.get(a) ?? 0) - (baryMap.get(b) ?? 0));
  };

  for (let iter = 0; iter < iterations; iter++) {
    // Down sweep: order each layer by predecessor barycenter
    for (let i = 1; i < sortedKeys.length; i++) {
      const cur = sortedKeys[i];
      const prev = sortedKeys[i - 1];
      if (cur === undefined || prev === undefined) continue;
      const ids = ordered.get(cur);
      const refs = ordered.get(prev);
      if (ids && refs) sortLayer(ids, refs, upNeighbors);
    }
    // Up sweep: order each layer by successor barycenter
    for (let i = sortedKeys.length - 2; i >= 0; i--) {
      const cur = sortedKeys[i];
      const next = sortedKeys[i + 1];
      if (cur === undefined || next === undefined) continue;
      const ids = ordered.get(cur);
      const refs = ordered.get(next);
      if (ids && refs) sortLayer(ids, refs, downNeighbors);
    }
  }
  return ordered;
}

function groupByLayer(ir: FlowchartDiagram, layers: Map<string, number>): Map<number, string[]> {
  const byLayer = new Map<number, string[]>();
  for (const n of ir.nodes) {
    const l = layers.get(n.id) ?? 0;
    const list = byLayer.get(l);
    if (list) list.push(n.id);
    else byLayer.set(l, [n.id]);
  }
  return byLayer;
}

function sortedLayers(byLayer: Map<number, string[]>): Array<[number, string[]]> {
  return [...byLayer.entries()].sort((a, b) => a[0] - b[0]);
}

function resolveAnchors(
  from: PositionedFlowNode,
  to: PositionedFlowNode,
  direction: 'TB' | 'LR',
  routing: EdgeRouting,
): {
  fromAnchor: 'top' | 'right' | 'bottom' | 'left';
  toAnchor: 'top' | 'right' | 'bottom' | 'left';
} {
  if (routing === 'side-loop') {
    if (direction === 'TB') {
      return { fromAnchor: 'right', toAnchor: 'right' };
    }
    return { fromAnchor: 'bottom', toAnchor: 'bottom' };
  }
  if (direction === 'TB') {
    return from.y < to.y
      ? { fromAnchor: 'bottom', toAnchor: 'top' }
      : { fromAnchor: 'top', toAnchor: 'bottom' };
  }
  // LR direct
  void from;
  void to;
  return { fromAnchor: 'right', toAnchor: 'left' };
}

function anchorPoint(
  n: PositionedFlowNode,
  side: 'top' | 'right' | 'bottom' | 'left',
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: n.x + n.width / 2, y: n.y };
    case 'right':
      return { x: n.x + n.width, y: n.y + n.height / 2 };
    case 'bottom':
      return { x: n.x + n.width / 2, y: n.y + n.height };
    case 'left':
      return { x: n.x, y: n.y + n.height / 2 };
  }
}

function computeBounds(
  nodes: PositionedFlowNode[],
  edges: PositionedFlowEdge[],
  padding: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (nodes.length === 0) {
    return { minX: 0, minY: 0, maxX: padding * 2, maxY: padding * 2 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const n of nodes) {
    if (n.x < minX) minX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.x + n.width > maxX) maxX = n.x + n.width;
    if (n.y + n.height > maxY) maxY = n.y + n.height;
  }
  // Side-loop bezier curves can extend past node bbox. Use exact tight bbox
  // via roots of B'(t) = 0 (see `bezier.ts`) instead of a loose
  // sample-based upper bound — produces a viewBox that fits the curve.
  for (const e of edges) {
    const b = bezierBoundsTight(e.fromPoint, e.c1, e.c2, e.toPoint);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

export type { FlowEdge, FlowNode };
