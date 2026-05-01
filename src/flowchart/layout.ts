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
}

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
  const layersByIndex = groupByLayer(ir, layers);

  const nodeMeta = new Map(ir.nodes.map((n) => [n.id, n]));

  const widths = new Map<string, number>();
  for (const n of ir.nodes) {
    const labelWidth = Math.ceil(n.label.length * charWidth) + DEFAULTS.textPaddingX;
    const factor = widthFactorFor(n.shape);
    widths.set(n.id, Math.max(minNodeWidth, Math.round(labelWidth * factor)));
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
      let cursorX = globalCenterX - layerWidth / 2;
      for (const id of ids) {
        const n = nodeMeta.get(id);
        if (!n) continue;
        const w = widths.get(id) ?? minNodeWidth;
        positioned.set(id, {
          id,
          label: n.label,
          shape: n.shape,
          x: cursorX,
          y: cursorY,
          width: w,
          height: nodeHeight,
        });
        cursorX += w + withinLayerSpacing;
      }
      cursorY += nodeHeight + layerSpacing;
    }
  } else {
    const layerHeightFor = (ids: string[]): number =>
      ids.length * nodeHeight + (ids.length - 1) * withinLayerSpacing;
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
        positioned.set(id, {
          id,
          label: n.label,
          shape: n.shape,
          x: cursorX + (maxW - w) / 2,
          y: cursorY,
          width: w,
          height: nodeHeight,
        });
        cursorY += nodeHeight + withinLayerSpacing;
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
    return {
      from: e.from,
      to: e.to,
      ...(e.label !== undefined ? { label: e.label } : {}),
      routing,
      fromPoint,
      toPoint,
      fromAnchor,
      toAnchor,
    };
  });

  const nodes = [...positioned.values()];
  return { direction, nodes, edges, bounds: computeBounds(nodes, padding) };
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
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

export type { FlowEdge, FlowNode };
