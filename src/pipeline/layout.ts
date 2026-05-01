/**
 * Pipeline layout — Fase 1 MVP.
 *
 * Strategy: longest-path layer assignment + declaration-order within layer +
 * uniform coordinate assignment. This is a deliberate simplification of the
 * full Sugiyama stack documented in SPEC §2.2.
 *
 * Pipelines are typically near-linear with occasional fan-in/fan-out, so
 * crossing reduction is dominated by the trivial case (≤1 crossing per
 * layer pair). Brandes-Köpf full implementation lands when we tackle DAG
 * (which has substantially denser real inputs from the inspector).
 */

import type { PipelineDiagram } from '../types.js';

export interface LayoutOptions {
  direction?: 'LR' | 'TB';
  nodeWidth?: number;
  nodeHeight?: number;
  layerSpacing?: number;
  withinLayerSpacing?: number;
  padding?: number;
  fontSize?: number;
  charWidth?: number;
}

export interface PositionedStage {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  subtype?: 'start' | 'end' | 'parallel-fork' | 'parallel-join';
}

export interface PositionedEdge {
  from: string;
  to: string;
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
}

export interface PipelineLayout {
  direction: 'LR' | 'TB';
  stages: PositionedStage[];
  edges: PositionedEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const DEFAULTS = {
  direction: 'LR' as const,
  nodeHeight: 56,
  layerSpacing: 64,
  withinLayerSpacing: 24,
  padding: 24,
  fontSize: 14,
  charWidth: 7.5,
  textPaddingX: 24,
  minNodeWidth: 96,
};

export function layoutPipeline(ir: PipelineDiagram, options: LayoutOptions = {}): PipelineLayout {
  const direction = options.direction ?? DEFAULTS.direction;
  const nodeHeight = options.nodeHeight ?? DEFAULTS.nodeHeight;
  const layerSpacing = options.layerSpacing ?? DEFAULTS.layerSpacing;
  const withinLayerSpacing = options.withinLayerSpacing ?? DEFAULTS.withinLayerSpacing;
  const padding = options.padding ?? DEFAULTS.padding;
  const charWidth = options.charWidth ?? DEFAULTS.charWidth;

  const layers = assignLayers(ir);
  const layersByIndex = groupByLayer(ir, layers);

  const stageMeta = new Map(ir.stages.map((s) => [s.id, s]));
  const measuredWidths = new Map<string, number>();
  for (const s of ir.stages) {
    const explicit = options.nodeWidth;
    if (explicit !== undefined) {
      measuredWidths.set(s.id, explicit);
    } else {
      const labelWidth = Math.ceil(s.label.length * charWidth);
      measuredWidths.set(s.id, Math.max(DEFAULTS.minNodeWidth, labelWidth + DEFAULTS.textPaddingX));
    }
  }

  const positioned = new Map<string, PositionedStage>();

  if (direction === 'LR') {
    let cursorX = padding;
    for (const [, ids] of sortedLayers(layersByIndex)) {
      const layerWidth = Math.max(...ids.map((id) => measuredWidths.get(id) ?? 0));
      ids.forEach((id, i) => {
        const s = stageMeta.get(id);
        if (!s) return;
        const w = measuredWidths.get(id) ?? DEFAULTS.minNodeWidth;
        positioned.set(id, {
          id,
          label: s.label,
          x: cursorX + (layerWidth - w) / 2,
          y: padding + i * (nodeHeight + withinLayerSpacing),
          width: w,
          height: nodeHeight,
          ...(s.subtype !== undefined ? { subtype: s.subtype } : {}),
        });
      });
      cursorX += layerWidth + layerSpacing;
    }
  } else {
    let cursorY = padding;
    for (const [, ids] of sortedLayers(layersByIndex)) {
      const widths = ids.map((id) => measuredWidths.get(id) ?? DEFAULTS.minNodeWidth);
      const totalWidth = widths.reduce((a, b) => a + b, 0) + (ids.length - 1) * withinLayerSpacing;
      let cursorX = padding;
      ids.forEach((id, i) => {
        const s = stageMeta.get(id);
        if (!s) return;
        const w = widths[i] ?? DEFAULTS.minNodeWidth;
        positioned.set(id, {
          id,
          label: s.label,
          x: cursorX,
          y: cursorY,
          width: w,
          height: nodeHeight,
          ...(s.subtype !== undefined ? { subtype: s.subtype } : {}),
        });
        cursorX += w + withinLayerSpacing;
      });
      void totalWidth;
      cursorY += nodeHeight + layerSpacing;
    }
  }

  const edges: PositionedEdge[] = ir.edges.map((e) => {
    const f = positioned.get(e.from);
    const t = positioned.get(e.to);
    if (!f || !t) {
      throw new Error(`Internal: edge references unknown stage ${e.from} -> ${e.to}`);
    }
    if (direction === 'LR') {
      return {
        from: e.from,
        to: e.to,
        fromPoint: { x: f.x + f.width, y: f.y + f.height / 2 },
        toPoint: { x: t.x, y: t.y + t.height / 2 },
      };
    }
    return {
      from: e.from,
      to: e.to,
      fromPoint: { x: f.x + f.width / 2, y: f.y + f.height },
      toPoint: { x: t.x + t.width / 2, y: t.y },
    };
  });

  const stages = [...positioned.values()];
  const bounds = computeBounds(stages, padding);

  return { direction, stages, edges, bounds };
}

function assignLayers(ir: PipelineDiagram): Map<string, number> {
  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();
  for (const s of ir.stages) {
    inEdges.set(s.id, []);
    outEdges.set(s.id, []);
  }
  for (const e of ir.edges) {
    inEdges.get(e.to)?.push(e.from);
    outEdges.get(e.from)?.push(e.to);
  }

  const inDeg = new Map<string, number>();
  for (const s of ir.stages) inDeg.set(s.id, inEdges.get(s.id)?.length ?? 0);

  const queue: string[] = [];
  for (const s of ir.stages) if ((inDeg.get(s.id) ?? 0) === 0) queue.push(s.id);

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

function groupByLayer(ir: PipelineDiagram, layers: Map<string, number>): Map<number, string[]> {
  const byLayer = new Map<number, string[]>();
  for (const s of ir.stages) {
    const l = layers.get(s.id) ?? 0;
    const list = byLayer.get(l);
    if (list) list.push(s.id);
    else byLayer.set(l, [s.id]);
  }
  return byLayer;
}

function sortedLayers(byLayer: Map<number, string[]>): Array<[number, string[]]> {
  return [...byLayer.entries()].sort((a, b) => a[0] - b[0]);
}

function computeBounds(
  stages: PositionedStage[],
  padding: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  if (stages.length === 0) {
    return { minX: 0, minY: 0, maxX: padding * 2, maxY: padding * 2 };
  }
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const s of stages) {
    if (s.x < minX) minX = s.x;
    if (s.y < minY) minY = s.y;
    if (s.x + s.width > maxX) maxX = s.x + s.width;
    if (s.y + s.height > maxY) maxY = s.y + s.height;
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}
