/**
 * DAG SVG renderer — shapes + multi-edges + self-loops + dashed/dotted styles
 * + optional arrowhead per `directed`.
 */

import type { DAGEdgeStyle } from '../types.js';
import type { DAGLayout, PositionedDAGEdge, PositionedDAGNode } from './layout.js';
import { renderShape } from './shapes.js';

export interface DAGRenderTheme {
  fontSize?: number;
  edgeLabelFontSize?: number;
  fontFamily?: string;
  cornerRadius?: number;
  strokeWidth?: number;
}

const DEFAULTS = {
  fontSize: 13,
  edgeLabelFontSize: 11,
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  cornerRadius: 6,
  strokeWidth: 1.25,
  edgeStrokeWidth: 1.5,
};

const EMBEDDED_STYLE = `
  .ach-diag-bg { fill: var(--ach-diag-bg, transparent); }
  .ach-diag-node > rect, .ach-diag-node > polygon, .ach-diag-node > circle, .ach-diag-node > ellipse {
    fill: var(--ach-diag-stage-bg, #15151a);
    stroke: var(--ach-diag-stage-border, #2e2e33);
  }
  .ach-diag-node text {
    fill: var(--ach-diag-stage-text, #ededef);
    font-feature-settings: "ss01" on, "cv11" on;
  }
  .ach-diag-edge { stroke: var(--ach-diag-edge, #5a5a63); fill: none; }
  .ach-diag-arrow path { fill: var(--ach-diag-edge, #5a5a63); }
  .ach-diag-edge-label-bg {
    fill: var(--ach-diag-edge-label-bg, #0a0a0b);
    stroke: var(--ach-diag-edge-label-border, transparent);
  }
  .ach-diag-edge-label {
    fill: var(--ach-diag-edge-label-text, #c4c4cc);
    font-feature-settings: "ss01" on;
  }
  @media (prefers-color-scheme: light) {
    .ach-diag-node > rect, .ach-diag-node > polygon, .ach-diag-node > circle, .ach-diag-node > ellipse {
      fill: var(--ach-diag-stage-bg, #ffffff);
      stroke: var(--ach-diag-stage-border, #d4d4d8);
    }
    .ach-diag-node text { fill: var(--ach-diag-stage-text, #18181b); }
    .ach-diag-edge { stroke: var(--ach-diag-edge, #a1a1aa); }
    .ach-diag-arrow path { fill: var(--ach-diag-edge, #a1a1aa); }
    .ach-diag-edge-label-bg { fill: var(--ach-diag-edge-label-bg, #ffffff); }
    .ach-diag-edge-label { fill: var(--ach-diag-edge-label-text, #52525b); }
  }
`.trim();

export interface DAGRenderResult {
  svg: string;
  width: number;
  height: number;
}

export function renderDAGSvg(
  layout: DAGLayout,
  theme: DAGRenderTheme = {},
  accessible = true,
): DAGRenderResult {
  const fontSize = theme.fontSize ?? DEFAULTS.fontSize;
  const edgeLabelFontSize = theme.edgeLabelFontSize ?? DEFAULTS.edgeLabelFontSize;
  const fontFamily = theme.fontFamily ?? DEFAULTS.fontFamily;
  const cornerRadius = theme.cornerRadius ?? DEFAULTS.cornerRadius;
  const strokeWidth = theme.strokeWidth ?? DEFAULTS.strokeWidth;

  const width = layout.bounds.maxX - layout.bounds.minX;
  const height = layout.bounds.maxY - layout.bounds.minY;

  const a11y = accessible
    ? `<title>DAG diagram</title><desc>${layout.nodes.length} nodes, ${layout.edges.length} edges</desc>`
    : '';
  const role = accessible ? ' role="img" aria-label="DAG diagram"' : '';

  const arrowDef = `<marker id="ach-diag-dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" class="ach-diag-arrow"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`;

  const edges = layout.edges.map((e) => renderEdge(e, edgeLabelFontSize, fontFamily)).join('');
  const nodes = layout.nodes
    .map((n) => renderNode(n, { fontSize, fontFamily, cornerRadius, strokeWidth }))
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${layout.bounds.minX} ${layout.bounds.minY} ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"${role}>${a11y}<defs>${arrowDef}<style>${EMBEDDED_STYLE}</style></defs><rect class="ach-diag-bg" x="${layout.bounds.minX}" y="${layout.bounds.minY}" width="${width}" height="${height}"/>${edges}${nodes}</svg>`;

  return { svg, width, height };
}

interface NodeRenderConfig {
  fontSize: number;
  fontFamily: string;
  cornerRadius: number;
  strokeWidth: number;
}

function renderNode(n: PositionedDAGNode, cfg: NodeRenderConfig): string {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const sw = n.strokeWidth ?? cfg.strokeWidth;
  let shapeFragment = renderShape(n.shape, n, cfg.cornerRadius);
  // Inject stroke-width + per-node fill/stroke on the first shape element.
  if (shapeFragment.length > 0) {
    const styleAttrs = [`stroke-width="${sw}"`];
    if (n.fill !== undefined) styleAttrs.push(`fill="${escapeXml(n.fill)}"`);
    if (n.stroke !== undefined) styleAttrs.push(`stroke="${escapeXml(n.stroke)}"`);
    shapeFragment = shapeFragment.replace(/^<(\w+)/, `<$1 ${styleAttrs.join(' ')}`);
  }

  const labelText = n.label ?? '';
  const textBlock =
    labelText.length > 0
      ? `<text x="${cx}" y="${cy}" font-family="${escapeXml(cfg.fontFamily)}" font-size="${cfg.fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(labelText)}</text>`
      : '';
  return `<g class="ach-diag-node" data-shape="${n.shape}">${shapeFragment}${textBlock}</g>`;
}

function styleDashArray(style: DAGEdgeStyle): string {
  switch (style) {
    case 'solid':
      return '';
    case 'dashed':
      return ' stroke-dasharray="6 4"';
    case 'dotted':
      return ' stroke-dasharray="2 3"';
  }
}

function renderEdge(e: PositionedDAGEdge, labelFontSize: number, fontFamily: string): string {
  const cmds = e.segments
    .map((s) => `C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.end.x} ${s.end.y}`)
    .join(' ');
  const path = `M ${e.fromPoint.x} ${e.fromPoint.y} ${cmds}`;

  let labelEl = '';
  if (e.label !== undefined && e.label.length > 0) {
    const segIdx = Math.floor((e.segments.length - 1) / 2);
    const seg = e.segments[segIdx];
    let segStart: { x: number; y: number };
    if (segIdx === 0) {
      segStart = e.fromPoint;
    } else {
      const prev = e.segments[segIdx - 1];
      segStart = prev ? prev.end : e.fromPoint;
    }
    const mid = seg
      ? bezierMid(segStart, seg.c1, seg.c2, seg.end)
      : { x: e.fromPoint.x, y: e.fromPoint.y };
    const labelWidth = Math.max(20, e.label.length * 6.5 + 10);
    const labelHeight = labelFontSize + 6;
    labelEl = `<rect class="ach-diag-edge-label-bg" x="${mid.x - labelWidth / 2}" y="${mid.y - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="3" ry="3"/><text class="ach-diag-edge-label" x="${mid.x}" y="${mid.y}" font-family="${escapeXml(fontFamily)}" font-size="${labelFontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(e.label)}</text>`;
  }

  const dashAttr = styleDashArray(e.style);
  const arrow = e.directed ? ' marker-end="url(#ach-diag-dag-arrow)"' : '';
  return `<path class="ach-diag-edge" data-routing="${e.routing}" d="${path}" stroke-width="${DEFAULTS.edgeStrokeWidth}"${dashAttr}${arrow}/>${labelEl}`;
}

function bezierMid(
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
    y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8,
  };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
