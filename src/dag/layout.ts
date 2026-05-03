/**
 * DAG layout — generic directed graph, allows cycles, self-loops, multi-edges.
 *
 * v1: same Sugiyama framework as flowchart (DFS back-edge reversal +
 * longest-path layering + dummy nodes for long forward edges + barycenter
 * crossing reduction), specialized for DAG shapes and edge metadata.
 *
 * Self-loops route as a loop to the right of the node (no layering).
 * Multi-edges fan out via the same parallel-offset scheme as flowchart.
 *
 * The roadmap calls out Brandes-Köpf coordinate assignment as the
 * follow-up needed for inspector-scale (~200k nodes); that lands in a
 * later milestone — see roadmap.md "Cross-repo: achronyme-inspector".
 */

import { bezierBoundsTight } from '../flowchart/bezier.js';
import type { DAGDiagram, DAGEdgeStyle, DAGShape } from '../types.js';
import { widthFactorFor } from './shapes.js';

export interface DAGLayoutOptions {
  direction?: 'TB' | 'LR';
  nodeHeight?: number;
  layerSpacing?: number;
  withinLayerSpacing?: number;
  padding?: number;
  charWidth?: number;
  minNodeWidth?: number;
}

export interface PositionedDAGNode {
  id: string;
  label: string;
  shape: DAGShape;
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export type DAGEdgeRouting = 'direct' | 'side-loop' | 'self-loop';

interface Point {
  x: number;
  y: number;
}

export interface CubicSegment {
  c1: Point;
  c2: Point;
  end: Point;
}

export interface PositionedDAGEdge {
  from: string;
  to: string;
  label?: string;
  directed: boolean;
  style: DAGEdgeStyle;
  routing: DAGEdgeRouting;
  fromPoint: Point;
  toPoint: Point;
  fromAnchor: 'top' | 'right' | 'bottom' | 'left';
  toAnchor: 'top' | 'right' | 'bottom' | 'left';
  segments: CubicSegment[];
}

export interface DAGLayout {
  direction: 'TB' | 'LR';
  nodes: PositionedDAGNode[];
  edges: PositionedDAGEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const ARROW_INSET = 8;

const DEFAULTS = {
  direction: 'TB' as const,
  nodeHeight: 48,
  layerSpacing: 56,
  withinLayerSpacing: 32,
  padding: 24,
  charWidth: 7.5,
  textPaddingX: 24,
  minNodeWidth: 72,
};

export function layoutDAG(ir: DAGDiagram, options: DAGLayoutOptions = {}): DAGLayout {
  const direction = options.direction ?? DEFAULTS.direction;
  const nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
  const layerSpacing = options.layerSpacing ?? DEFAULTS.layerSpacing;
  const withinLayerSpacing = options.withinLayerSpacing ?? DEFAULTS.withinLayerSpacing;
  const padding = options.padding ?? DEFAULTS.padding;
  const charWidth = options.charWidth ?? DEFAULTS.charWidth;
  const minNodeWidth = options.minNodeWidth ?? DEFAULTS.minNodeWidth;

  // Self-loops are removed from the layered graph and routed separately —
  // they don't affect layering or crossing reduction.
  const selfLoops = new Set<number>();
  ir.edges.forEach((e, idx) => {
    if (e.from === e.to) selfLoops.add(idx);
  });

  const reversed = detectBackEdges(ir, selfLoops);
  const layers = assignLayers(ir, reversed, selfLoops);
  const augmented = insertDummyNodes(ir, layers, reversed, selfLoops);

  const layersByIndexRaw = groupByLayerWithDummies(ir, augmented);
  const layersByIndex = reduceCrossings(
    layersByIndexRaw,
    augmented.layerOf,
    augmented.segmentEdges,
  );

  const nodeMeta = new Map(ir.nodes.map((n) => [n.id, n]));
  const widths = new Map<string, number>();
  const heights = new Map<string, number>();
  for (const n of ir.nodes) {
    const labelText = n.label ?? n.id;
    const labelChars = labelText.length;
    const labelWidth = Math.ceil(labelChars * charWidth) + DEFAULTS.textPaddingX;
    const factor = widthFactorFor(n.shape);
    const w = n.width ?? Math.max(minNodeWidth, Math.round(labelWidth * factor));
    const h = n.height ?? nodeHeight;
    widths.set(n.id, w);
    heights.set(n.id, h);
  }

  const positioned = new Map<string, PositionedDAGNode>();
  const sortedLayerEntries = sortedLayers(layersByIndex);

  const layerWidthOfReals = (ids: string[]): number => {
    let sum = 0;
    let count = 0;
    for (const id of ids) {
      if (augmented.dummyIds.has(id)) continue;
      if (count > 0) sum += withinLayerSpacing;
      sum += widths.get(id) ?? minNodeWidth;
      count++;
    }
    return sum;
  };
  const layerHeightOfReals = (ids: string[]): number => {
    let sum = 0;
    let count = 0;
    for (const id of ids) {
      if (augmented.dummyIds.has(id)) continue;
      if (count > 0) sum += withinLayerSpacing;
      sum += heights.get(id) ?? nodeHeight;
      count++;
    }
    return sum;
  };

  const layerBands = new Map<number, { start: number; span: number }>();

  if (direction === 'TB') {
    const maxLayerWidth = Math.max(
      0,
      ...sortedLayerEntries.map(([, ids]) => layerWidthOfReals(ids)),
    );
    const globalCenterX = padding + maxLayerWidth / 2;

    let cursorY = padding;
    for (const [layerIdx, ids] of sortedLayerEntries) {
      const realIds = ids.filter((id) => !augmented.dummyIds.has(id));
      const layerWidth = layerWidthOfReals(ids);
      const layerHeight =
        realIds.length > 0
          ? Math.max(...realIds.map((id) => heights.get(id) ?? nodeHeight))
          : nodeHeight;
      let cursorX = globalCenterX - layerWidth / 2;
      for (const id of realIds) {
        const n = nodeMeta.get(id);
        if (!n) continue;
        const w = widths.get(id) ?? minNodeWidth;
        const h = heights.get(id) ?? nodeHeight;
        positioned.set(id, makePositioned(n, cursorX, cursorY + (layerHeight - h) / 2, w, h));
        cursorX += w + withinLayerSpacing;
      }
      layerBands.set(layerIdx, { start: cursorY, span: layerHeight });
      cursorY += layerHeight + layerSpacing;
    }
  } else {
    const maxLayerHeight = Math.max(
      0,
      ...sortedLayerEntries.map(([, ids]) => layerHeightOfReals(ids)),
    );
    const globalCenterY = padding + maxLayerHeight / 2;

    let cursorX = padding;
    for (const [layerIdx, ids] of sortedLayerEntries) {
      const realIds = ids.filter((id) => !augmented.dummyIds.has(id));
      const layerHeight = layerHeightOfReals(ids);
      const layerWidth =
        realIds.length > 0
          ? Math.max(...realIds.map((id) => widths.get(id) ?? minNodeWidth))
          : minNodeWidth;
      let cursorY = globalCenterY - layerHeight / 2;
      for (const id of realIds) {
        const n = nodeMeta.get(id);
        if (!n) continue;
        const w = widths.get(id) ?? minNodeWidth;
        const h = heights.get(id) ?? nodeHeight;
        positioned.set(id, makePositioned(n, cursorX + (layerWidth - w) / 2, cursorY, w, h));
        cursorY += h + withinLayerSpacing;
      }
      layerBands.set(layerIdx, { start: cursorX, span: layerWidth });
      cursorX += layerWidth + layerSpacing;
    }
  }

  positionDummies(
    sortedLayerEntries,
    augmented.dummyIds,
    positioned,
    layerBands,
    direction,
    withinLayerSpacing,
  );

  // Multi-edge fan-out: count parallels per (from,to) pair.
  const parallelCount = new Map<string, number>();
  for (const e of ir.edges) {
    if (e.from === e.to) continue;
    const k = `${e.from}|${e.to}`;
    parallelCount.set(k, (parallelCount.get(k) ?? 0) + 1);
  }
  const parallelSeen = new Map<string, number>();

  const edges: PositionedDAGEdge[] = ir.edges.map((e, idx) => {
    const f = positioned.get(e.from);
    const t = positioned.get(e.to);
    if (!f || !t) {
      throw new Error(`Internal: edge references unknown node ${e.from} -> ${e.to}`);
    }

    if (selfLoops.has(idx)) {
      return buildSelfLoop(e, f, direction);
    }

    const wasReversed = reversed.has(idx);
    const routing: DAGEdgeRouting = wasReversed ? 'side-loop' : 'direct';
    const chain = augmented.edgeChain.get(idx) ?? [e.from, e.to];
    const isLong = chain.length > 2;

    const parallelKey = `${e.from}|${e.to}`;
    const total = parallelCount.get(parallelKey) ?? 1;
    const seen = parallelSeen.get(parallelKey) ?? 0;
    parallelSeen.set(parallelKey, seen + 1);
    const PARALLEL_SPACING = 24;
    const parallelOffset = total > 1 ? (seen - (total - 1) / 2) * PARALLEL_SPACING : 0;

    const { fromAnchor, toAnchor } = resolveAnchors(f, t, direction, routing);
    const fromPoint = anchorPoint(f, fromAnchor);
    const toPoint = anchorPoint(t, toAnchor);
    const tip = e.directed ? insetPoint(toPoint, toAnchor) : toPoint;

    let segments: CubicSegment[];
    if (routing === 'side-loop') {
      const { c1, c2 } = computeSideLoopControlPoints(fromPoint, tip, fromAnchor, toAnchor);
      segments = [{ c1, c2, end: tip }];
    } else if (!isLong) {
      const { c1, c2 } = computeDirectControlPoints(fromPoint, tip, fromAnchor, parallelOffset);
      segments = [{ c1, c2, end: tip }];
    } else {
      segments = buildMultiSegmentPath(
        fromPoint,
        tip,
        fromAnchor,
        chain,
        positioned,
        parallelOffset,
      );
    }

    return {
      from: e.from,
      to: e.to,
      ...(e.label !== undefined ? { label: e.label } : {}),
      directed: e.directed,
      style: e.style,
      routing,
      fromPoint,
      toPoint,
      fromAnchor,
      toAnchor,
      segments,
    };
  });

  const nodes = [...positioned.values()].filter((n) => !augmented.dummyIds.has(n.id));
  return { direction, nodes, edges, bounds: computeBounds(nodes, edges, padding) };
}

function makePositioned(
  meta: {
    id: string;
    label?: string;
    shape: DAGShape;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
  },
  x: number,
  y: number,
  width: number,
  height: number,
): PositionedDAGNode {
  const node: PositionedDAGNode = {
    id: meta.id,
    label: meta.label ?? meta.id,
    shape: meta.shape,
    x,
    y,
    width,
    height,
  };
  if (meta.fill !== undefined) node.fill = meta.fill;
  if (meta.stroke !== undefined) node.stroke = meta.stroke;
  if (meta.strokeWidth !== undefined) node.strokeWidth = meta.strokeWidth;
  return node;
}

/**
 * Self-loop: half-circle to the right of the node, anchored on top-right
 * and right-edge. For LR direction, anchored on top and top-right instead.
 */
function buildSelfLoop(
  e: { from: string; to: string; directed: boolean; style: DAGEdgeStyle; label?: string },
  n: PositionedDAGNode,
  direction: 'TB' | 'LR',
): PositionedDAGEdge {
  const LOOP_R = 22;
  const fromAnchor = direction === 'TB' ? 'right' : 'top';
  const toAnchor = direction === 'TB' ? 'top' : 'right';
  const fromPoint = anchorPoint(n, fromAnchor);
  const toPoint = anchorPoint(n, toAnchor);
  const tip = e.directed ? insetPoint(toPoint, toAnchor) : toPoint;

  // Compose a single cubic that arcs out away from the node.
  const c1: Point =
    direction === 'TB'
      ? { x: fromPoint.x + LOOP_R, y: fromPoint.y - LOOP_R / 2 }
      : { x: fromPoint.x + LOOP_R / 2, y: fromPoint.y - LOOP_R };
  const c2: Point =
    direction === 'TB'
      ? { x: tip.x + LOOP_R / 2, y: tip.y - LOOP_R }
      : { x: tip.x + LOOP_R, y: tip.y - LOOP_R / 2 };

  const out: PositionedDAGEdge = {
    from: e.from,
    to: e.to,
    directed: e.directed,
    style: e.style,
    routing: 'self-loop',
    fromPoint,
    toPoint,
    fromAnchor,
    toAnchor,
    segments: [{ c1, c2, end: tip }],
  };
  if (e.label !== undefined) out.label = e.label;
  return out;
}

interface DummyInsertion {
  dummyIds: Set<string>;
  layerOf: Map<string, number>;
  edgeChain: Map<number, string[]>;
  segmentEdges: Array<{ from: string; to: string }>;
}

function insertDummyNodes(
  ir: DAGDiagram,
  layers: Map<string, number>,
  reversed: Set<number>,
  selfLoops: Set<number>,
): DummyInsertion {
  const dummyIds = new Set<string>();
  const layerOf = new Map(layers);
  const edgeChain = new Map<number, string[]>();
  const segmentEdges: Array<{ from: string; to: string }> = [];

  ir.edges.forEach((e, idx) => {
    if (selfLoops.has(idx)) {
      edgeChain.set(idx, [e.from, e.to]);
      return;
    }
    const lf = layers.get(e.from) ?? 0;
    const lt = layers.get(e.to) ?? 0;

    if (reversed.has(idx)) {
      edgeChain.set(idx, [e.from, e.to]);
      const dagSpan = Math.abs(lt - lf);
      if (dagSpan === 1) {
        const dagFrom = lt < lf ? e.to : e.from;
        const dagTo = lt < lf ? e.from : e.to;
        segmentEdges.push({ from: dagFrom, to: dagTo });
      }
      return;
    }

    const span = lt - lf;
    if (span <= 1) {
      edgeChain.set(idx, [e.from, e.to]);
      if (span === 1) segmentEdges.push({ from: e.from, to: e.to });
      return;
    }

    const chain: string[] = [e.from];
    for (let l = lf + 1; l < lt; l++) {
      const did = `__dummy_e${idx}_l${l}`;
      dummyIds.add(did);
      layerOf.set(did, l);
      chain.push(did);
    }
    chain.push(e.to);
    edgeChain.set(idx, chain);
    for (let i = 0; i < chain.length - 1; i++) {
      const from = chain[i];
      const to = chain[i + 1];
      if (from !== undefined && to !== undefined) {
        segmentEdges.push({ from, to });
      }
    }
  });

  return { dummyIds, layerOf, edgeChain, segmentEdges };
}

function groupByLayerWithDummies(ir: DAGDiagram, d: DummyInsertion): Map<number, string[]> {
  const byLayer = new Map<number, string[]>();
  for (const n of ir.nodes) {
    const l = d.layerOf.get(n.id) ?? 0;
    const list = byLayer.get(l);
    if (list) list.push(n.id);
    else byLayer.set(l, [n.id]);
  }
  for (const did of d.dummyIds) {
    const l = d.layerOf.get(did) ?? 0;
    const list = byLayer.get(l);
    if (list) list.push(did);
    else byLayer.set(l, [did]);
  }
  return byLayer;
}

function positionDummies(
  sortedLayerEntries: Array<[number, string[]]>,
  dummyIds: Set<string>,
  positioned: Map<string, PositionedDAGNode>,
  layerBands: Map<number, { start: number; span: number }>,
  direction: 'TB' | 'LR',
  withinLayerSpacing: number,
): void {
  for (const [layerIdx, ids] of sortedLayerEntries) {
    const band = layerBands.get(layerIdx) ?? { start: 0, span: 0 };
    const midBand = band.start + band.span / 2;

    let leftAnchor: number | null = null;
    let pendingDummies: string[] = [];

    const flushDummies = (rightAnchor: number | null): void => {
      if (pendingDummies.length === 0) return;
      let xLeft: number;
      let xRight: number;
      if (leftAnchor !== null && rightAnchor !== null) {
        xLeft = leftAnchor;
        xRight = rightAnchor;
      } else if (leftAnchor !== null) {
        xLeft = leftAnchor;
        xRight = leftAnchor + withinLayerSpacing * (pendingDummies.length + 1);
      } else if (rightAnchor !== null) {
        xRight = rightAnchor;
        xLeft = rightAnchor - withinLayerSpacing * (pendingDummies.length + 1);
      } else {
        xLeft = midBand - withinLayerSpacing * pendingDummies.length;
        xRight = midBand + withinLayerSpacing * pendingDummies.length;
      }
      const slots = pendingDummies.length + 1;
      pendingDummies.forEach((did, i) => {
        const t = (i + 1) / slots;
        const interp = xLeft + (xRight - xLeft) * t;
        positioned.set(did, {
          id: did,
          label: '',
          shape: 'rect',
          x: direction === 'TB' ? interp : band.start,
          y: direction === 'TB' ? band.start : interp,
          width: direction === 'TB' ? 0 : band.span,
          height: direction === 'TB' ? band.span : 0,
        });
      });
      pendingDummies = [];
    };

    for (const id of ids) {
      if (dummyIds.has(id)) {
        pendingDummies.push(id);
      } else {
        const realPos = positioned.get(id);
        if (!realPos) continue;
        const nearEdge = direction === 'TB' ? realPos.x : realPos.y;
        const farEdge = direction === 'TB' ? realPos.x + realPos.width : realPos.y + realPos.height;
        flushDummies(nearEdge);
        leftAnchor = farEdge;
      }
    }
    flushDummies(null);
  }
}

function buildMultiSegmentPath(
  fromPoint: Point,
  tipPoint: Point,
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  chain: string[],
  positioned: Map<string, PositionedDAGNode>,
  parallelOffset = 0,
): CubicSegment[] {
  const verticalFlow = fromAnchor === 'bottom' || fromAnchor === 'top';
  const waypoints: Point[] = [fromPoint];
  for (let i = 1; i < chain.length - 1; i++) {
    const did = chain[i];
    if (did === undefined) continue;
    const dp = positioned.get(did);
    if (!dp) continue;
    if (verticalFlow) {
      const x = dp.x + parallelOffset;
      waypoints.push({ x, y: dp.y });
      waypoints.push({ x, y: dp.y + dp.height });
    } else {
      const y = dp.y + parallelOffset;
      waypoints.push({ x: dp.x, y });
      waypoints.push({ x: dp.x + dp.width, y });
    }
  }
  waypoints.push(tipPoint);

  const segments: CubicSegment[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const w0 = waypoints[i];
    const w1 = waypoints[i + 1];
    if (!w0 || !w1) continue;
    if (verticalFlow) {
      const midY = (w0.y + w1.y) / 2;
      segments.push({ c1: { x: w0.x, y: midY }, c2: { x: w1.x, y: midY }, end: w1 });
    } else {
      const midX = (w0.x + w1.x) / 2;
      segments.push({ c1: { x: midX, y: w0.y }, c2: { x: midX, y: w1.y }, end: w1 });
    }
  }
  return segments;
}

function insetPoint(p: Point, side: 'top' | 'right' | 'bottom' | 'left'): Point {
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

function computeDirectControlPoints(
  from: Point,
  to: Point,
  fromSide: 'top' | 'right' | 'bottom' | 'left',
  parallelOffset = 0,
): { c1: Point; c2: Point } {
  const verticalFlow = fromSide === 'bottom' || fromSide === 'top';
  if (verticalFlow) {
    const midY = from.y + (to.y - from.y) / 2;
    const dx = parallelOffset;
    return { c1: { x: from.x + dx, y: midY }, c2: { x: to.x + dx, y: midY } };
  }
  const midX = from.x + (to.x - from.x) / 2;
  const dy = parallelOffset;
  return { c1: { x: midX, y: from.y + dy }, c2: { x: midX, y: to.y + dy } };
}

function computeSideLoopControlPoints(
  from: Point,
  to: Point,
  fromSide: 'top' | 'right' | 'bottom' | 'left',
  toSide: 'top' | 'right' | 'bottom' | 'left',
): { c1: Point; c2: Point } {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  const detour = Math.max(60, Math.min(160, chord * 0.4));
  const cFor = (p: Point, side: 'top' | 'right' | 'bottom' | 'left', d: number): Point => {
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
  return { c1: cFor(from, fromSide, detour), c2: cFor(to, toSide, detour) };
}

function detectBackEdges(ir: DAGDiagram, selfLoops: Set<number>): Set<number> {
  const out = new Map<string, Array<{ to: string; idx: number }>>();
  for (const n of ir.nodes) out.set(n.id, []);
  ir.edges.forEach((e, idx) => {
    if (selfLoops.has(idx)) return;
    out.get(e.from)?.push({ to: e.to, idx });
  });

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
  void BLACK;
  return back;
}

function assignLayers(
  ir: DAGDiagram,
  reversed: Set<number>,
  selfLoops: Set<number>,
): Map<string, number> {
  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();
  for (const n of ir.nodes) {
    inEdges.set(n.id, []);
    outEdges.set(n.id, []);
  }
  ir.edges.forEach((e, idx) => {
    if (selfLoops.has(idx)) return;
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
  // Stranded nodes (cycle remnants) land in layer 0.
  for (const n of ir.nodes) if (!layer.has(n.id)) layer.set(n.id, 0);
  return layer;
}

function reduceCrossings(
  byLayer: Map<number, string[]>,
  layers: Map<string, number>,
  segmentEdges: ReadonlyArray<{ from: string; to: string }>,
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
  for (const seg of segmentEdges) {
    downNeighbors.get(seg.from)?.push(seg.to);
    upNeighbors.get(seg.to)?.push(seg.from);
  }
  void layers;

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
    for (let i = 1; i < sortedKeys.length; i++) {
      const cur = sortedKeys[i];
      const prev = sortedKeys[i - 1];
      if (cur === undefined || prev === undefined) continue;
      const ids = ordered.get(cur);
      const refs = ordered.get(prev);
      if (ids && refs) sortLayer(ids, refs, upNeighbors);
    }
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

function sortedLayers(byLayer: Map<number, string[]>): Array<[number, string[]]> {
  return [...byLayer.entries()].sort((a, b) => a[0] - b[0]);
}

function resolveAnchors(
  from: PositionedDAGNode,
  to: PositionedDAGNode,
  direction: 'TB' | 'LR',
  routing: DAGEdgeRouting,
): {
  fromAnchor: 'top' | 'right' | 'bottom' | 'left';
  toAnchor: 'top' | 'right' | 'bottom' | 'left';
} {
  if (routing === 'side-loop') {
    if (direction === 'TB') return { fromAnchor: 'right', toAnchor: 'right' };
    return { fromAnchor: 'bottom', toAnchor: 'bottom' };
  }
  if (direction === 'TB') {
    return from.y < to.y
      ? { fromAnchor: 'bottom', toAnchor: 'top' }
      : { fromAnchor: 'top', toAnchor: 'bottom' };
  }
  void from;
  void to;
  return { fromAnchor: 'right', toAnchor: 'left' };
}

function anchorPoint(n: PositionedDAGNode, side: 'top' | 'right' | 'bottom' | 'left'): Point {
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
  nodes: PositionedDAGNode[],
  edges: PositionedDAGEdge[],
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
  for (const e of edges) {
    let prev = e.fromPoint;
    for (const seg of e.segments) {
      const b = bezierBoundsTight(prev, seg.c1, seg.c2, seg.end);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
      prev = seg.end;
    }
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}
