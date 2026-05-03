/**
 * Flowchart layout — TB by default, supports cycles via DFS back-edge reversal.
 *
 * Pipeline (Sugiyama framework):
 * 1. Detect back-edges via DFS (cycles are valid in flowcharts).
 * 2. Layer the resulting DAG via longest-path on the forward edges.
 * 3. Insert dummy nodes for forward edges with span > 1 so every edge in the
 *    augmented graph spans exactly one layer (Sugiyama §4). Back-edges keep
 *    the side-loop visual cue and don't get dummies.
 * 4. Crossing reduction (barycenter) on the augmented graph — dummies
 *    influence ordering so long edges route through chosen X-positions.
 * 5. Coordinate assignment: real nodes laid out with compact spacing;
 *    dummies inserted between real-node X positions in barycenter order
 *    (zero width, no contribution to layer width).
 * 6. Edge geometry: each user-facing edge produces one PositionedFlowEdge.
 *    Short / back-edges have a single cubic segment. Long forward edges
 *    have one cubic per layer span, joined at dummy positions with
 *    vertical-tangent (TB) / horizontal-tangent (LR) at every waypoint.
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

interface Point {
  x: number;
  y: number;
}

export interface CubicSegment {
  c1: Point;
  c2: Point;
  end: Point;
}

export interface PositionedFlowEdge {
  from: string;
  to: string;
  label?: string;
  routing: EdgeRouting;
  fromPoint: Point;
  toPoint: Point;
  fromAnchor: 'top' | 'right' | 'bottom' | 'left';
  toAnchor: 'top' | 'right' | 'bottom' | 'left';
  // Cubic Bézier path. For short forward edges and back-edges this contains
  // a single segment. For long forward edges (span > 1) it contains one
  // segment per spanned layer, joined at dummy-node positions for smooth
  // routing through intermediate layers (Sugiyama §4).
  segments: CubicSegment[];
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

  // Sugiyama §4: insert one dummy node per intermediate layer along each
  // long forward edge. Back-edges retain side-loop routing.
  const augmented = insertDummyNodes(ir, layers, reversed);

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
    const labelChars = Math.max(n.label.length, n.subtitle?.length ?? 0);
    const labelWidth = Math.ceil(labelChars * charWidth) + DEFAULTS.textPaddingX;
    const factor = widthFactorFor(n.shape);
    widths.set(n.id, Math.max(minNodeWidth, Math.round(labelWidth * factor)));
    heights.set(n.id, n.subtitle !== undefined ? nodeHeight + 18 : nodeHeight);
  }

  const positioned = new Map<string, PositionedFlowNode>();
  const sortedLayerEntries = sortedLayers(layersByIndex);

  // Layer width / height counting only real nodes. Dummies hold an ordering
  // slot but consume zero extent — the long edge passes through their
  // (interpolated) X without forcing the layer band wider.
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

  // Layer mid-band for dummy positioning (TB: midY per layer; LR: midX).
  const layerMidBand = new Map<number, number>();

  if (direction === 'TB') {
    const maxLayerWidth = Math.max(...sortedLayerEntries.map(([, ids]) => layerWidthOfReals(ids)));
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
      layerMidBand.set(layerIdx, cursorY + layerHeight / 2);
      cursorY += layerHeight + layerSpacing;
    }
  } else {
    const maxLayerHeight = Math.max(
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
        positioned.set(id, {
          id,
          label: n.label,
          shape: n.shape,
          x: cursorX + (layerWidth - w) / 2,
          y: cursorY,
          width: w,
          height: h,
          ...(n.subtitle !== undefined ? { subtitle: n.subtitle } : {}),
        });
        cursorY += h + withinLayerSpacing;
      }
      layerMidBand.set(layerIdx, cursorX + layerWidth / 2);
      cursorX += layerWidth + layerSpacing;
    }
  }

  // Position dummies. Within each layer, dummies sit between adjacent real
  // nodes in the barycenter-sorted order, evenly distributed across the gap.
  // Their cross-axis position (Y for TB, X for LR) is the layer mid-band.
  positionDummies(
    sortedLayerEntries,
    augmented.dummyIds,
    positioned,
    layerMidBand,
    direction,
    withinLayerSpacing,
  );

  // Pre-pass: count parallel edges so each gets a perpendicular offset and
  // they fan out instead of stacking. The offset applies to both short and
  // long forward edges — for long edges it shifts the dummy waypoints
  // perpendicular to the flow so parallel chains visually separate.
  const parallelCount = new Map<string, number>();
  for (const e of ir.edges) {
    const k = `${e.from}|${e.to}`;
    parallelCount.set(k, (parallelCount.get(k) ?? 0) + 1);
  }
  const parallelSeen = new Map<string, number>();

  const edges: PositionedFlowEdge[] = ir.edges.map((e, idx) => {
    const wasReversed = reversed.has(idx);
    const f = positioned.get(e.from);
    const t = positioned.get(e.to);
    if (!f || !t) {
      throw new Error(`Internal: edge references unknown node ${e.from} -> ${e.to}`);
    }
    const routing: EdgeRouting = wasReversed ? 'side-loop' : 'direct';
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
    const tip = insetPoint(toPoint, toAnchor);

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
      routing,
      fromPoint,
      toPoint,
      fromAnchor,
      toAnchor,
      segments,
    };
  });

  // Strip dummies from the rendered nodes list. They served their purpose
  // in routing and have no on-screen representation.
  const nodes = [...positioned.values()].filter((n) => !augmented.dummyIds.has(n.id));
  return { direction, nodes, edges, bounds: computeBounds(nodes, edges, padding) };
}

interface DummyInsertion {
  dummyIds: Set<string>;
  layerOf: Map<string, number>;
  // Per original edge index: ordered chain of waypoint IDs from `from` to `to`
  // (length = span + 1). Length 2 means no dummies were inserted.
  edgeChain: Map<number, string[]>;
  // 1-layer-spanning segment edges in DAG-order (lower-layer node first).
  // Used by crossing reduction.
  segmentEdges: Array<{ from: string; to: string }>;
}

function insertDummyNodes(
  ir: FlowchartDiagram,
  layers: Map<string, number>,
  reversed: Set<number>,
): DummyInsertion {
  const dummyIds = new Set<string>();
  const layerOf = new Map(layers);
  const edgeChain = new Map<number, string[]>();
  const segmentEdges: Array<{ from: string; to: string }> = [];

  ir.edges.forEach((e, idx) => {
    const lf = layers.get(e.from) ?? 0;
    const lt = layers.get(e.to) ?? 0;

    if (reversed.has(idx)) {
      // Back-edge — side-loop visual; no dummies. Contribute to crossing
      // reduction only when the DAG-reversed form spans exactly one layer.
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
      // Self-loop or 1-layer forward edge: no dummies, single segment.
      edgeChain.set(idx, [e.from, e.to]);
      if (span === 1) segmentEdges.push({ from: e.from, to: e.to });
      return;
    }

    // span > 1: insert dummies at every intermediate layer.
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

function groupByLayerWithDummies(ir: FlowchartDiagram, d: DummyInsertion): Map<number, string[]> {
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

/**
 * Position dummy nodes in a second pass after real nodes have been placed.
 *
 * For each layer, dummies that fall between two real nodes (or before the
 * first / after the last) in the barycenter-sorted order get evenly
 * distributed across the gap. This preserves the crossing-reduction
 * ordering while costing zero horizontal extent.
 */
function positionDummies(
  sortedLayerEntries: Array<[number, string[]]>,
  dummyIds: Set<string>,
  positioned: Map<string, PositionedFlowNode>,
  layerMidBand: Map<number, number>,
  direction: 'TB' | 'LR',
  withinLayerSpacing: number,
): void {
  for (const [layerIdx, ids] of sortedLayerEntries) {
    const midBand = layerMidBand.get(layerIdx) ?? 0;

    // Walk ordered ids, accumulating dummies between real anchors.
    let leftAnchor: number | null = null;
    let pendingDummies: string[] = [];

    const flushDummies = (rightAnchor: number | null): void => {
      if (pendingDummies.length === 0) return;
      // Determine span between left and right anchors.
      let xLeft: number;
      let xRight: number;
      if (leftAnchor !== null && rightAnchor !== null) {
        xLeft = leftAnchor;
        xRight = rightAnchor;
      } else if (leftAnchor !== null) {
        // Trailing dummies past the last real node.
        xLeft = leftAnchor;
        xRight = leftAnchor + withinLayerSpacing * (pendingDummies.length + 1);
      } else if (rightAnchor !== null) {
        // Leading dummies before the first real node.
        xRight = rightAnchor;
        xLeft = rightAnchor - withinLayerSpacing * (pendingDummies.length + 1);
      } else {
        // Layer has no real nodes — synthetic span around midBand.
        xLeft = midBand - withinLayerSpacing * pendingDummies.length;
        xRight = midBand + withinLayerSpacing * pendingDummies.length;
      }
      const slots = pendingDummies.length + 1;
      pendingDummies.forEach((did, i) => {
        const t = (i + 1) / slots;
        const interp = xLeft + (xRight - xLeft) * t;
        // Dummies are first materialised here — they did not exist in the
        // real-node placement pass. Width/height = 0 so they contribute
        // nothing to bounds; their (x, y) is the waypoint coordinate used
        // by buildMultiSegmentPath.
        positioned.set(did, {
          id: did,
          label: '',
          shape: 'process' as FlowShape,
          x: direction === 'TB' ? interp : midBand,
          y: direction === 'TB' ? midBand : interp,
          width: 0,
          height: 0,
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
        // Use real-node BOX EDGES (not centres) so dummies sit in the gap
        // between adjacent reals — never inside a real's bounding box.
        const nearEdge = direction === 'TB' ? realPos.x : realPos.y;
        const farEdge =
          direction === 'TB' ? realPos.x + realPos.width : realPos.y + realPos.height;
        flushDummies(nearEdge);
        leftAnchor = farEdge;
      }
    }
    flushDummies(null);
  }
}

/**
 * Build the multi-segment cubic Bézier path for a long forward edge.
 *
 * Each segment connects consecutive waypoints (real source, dummies, real
 * target). Control points use the existing axis-symmetric scheme: midline
 * shared between c1 and c2 perpendicular to the flow, c1.x = w0.x and
 * c2.x = w1.x for TB (swap axes for LR). This keeps tangents axis-aligned
 * at every waypoint, giving G¹ continuity and a smooth flowing path.
 */
function buildMultiSegmentPath(
  fromPoint: Point,
  tipPoint: Point,
  fromAnchor: 'top' | 'right' | 'bottom' | 'left',
  chain: string[],
  positioned: Map<string, PositionedFlowNode>,
  parallelOffset = 0,
): CubicSegment[] {
  const verticalFlow = fromAnchor === 'bottom' || fromAnchor === 'top';
  const waypoints: Point[] = [fromPoint];
  for (let i = 1; i < chain.length - 1; i++) {
    const did = chain[i];
    if (did === undefined) continue;
    const dp = positioned.get(did);
    if (!dp) continue;
    // Apply parallel offset perpendicular to flow so multiple parallel
    // long edges fan out instead of stacking on the same waypoint.
    if (verticalFlow) {
      waypoints.push({ x: dp.x + parallelOffset, y: dp.y });
    } else {
      waypoints.push({ x: dp.x, y: dp.y + parallelOffset });
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
      segments.push({
        c1: { x: w0.x, y: midY },
        c2: { x: w1.x, y: midY },
        end: w1,
      });
    } else {
      const midX = (w0.x + w1.x) / 2;
      segments.push({
        c1: { x: midX, y: w0.y },
        c2: { x: midX, y: w1.y },
        end: w1,
      });
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
    return {
      c1: { x: from.x + dx, y: midY },
      c2: { x: to.x + dx, y: midY },
    };
  }
  const midX = from.x + (to.x - from.x) / 2;
  const dy = parallelOffset;
  return {
    c1: { x: midX, y: from.y + dy },
    c2: { x: midX, y: to.y + dy },
  };
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
  from: Point,
  to: Point,
  fromSide: 'top' | 'right' | 'bottom' | 'left',
  toSide: 'top' | 'right' | 'bottom' | 'left',
): { c1: Point; c2: Point } {
  const chord = Math.hypot(to.x - from.x, to.y - from.y);
  let detour = Math.max(60, Math.min(160, chord * 0.4));
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
 * Operates on the dummy-augmented graph: every entry in `segmentEdges`
 * spans exactly one layer pair, so the barycenter calculation works
 * uniformly over real and dummy waypoints. We sweep down then up for a
 * few iterations (4 by default — well past diminishing returns for
 * typical 1-2 dozen-layer graphs).
 */
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
  void from;
  void to;
  return { fromAnchor: 'right', toAnchor: 'left' };
}

function anchorPoint(n: PositionedFlowNode, side: 'top' | 'right' | 'bottom' | 'left'): Point {
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
  // Each edge can extend past node bbox via curved segments. Iterate over
  // every cubic segment in every edge using the exact tight bbox.
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

export type { FlowEdge, FlowNode };
