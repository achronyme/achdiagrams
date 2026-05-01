/**
 * Flowchart SVG renderer.
 * Shape dispatch + edge labels + theming via CSS custom properties.
 */

import type { FlowchartLayout, PositionedFlowEdge, PositionedFlowNode } from './layout.js';
import { renderShape, shapeAnchor } from './shapes.js';

export interface FlowRenderTheme {
  fontSize?: number;
  edgeLabelFontSize?: number;
  fontFamily?: string;
  cornerRadius?: number;
  strokeWidth?: number;
}

const DEFAULTS = {
  fontSize: 14,
  edgeLabelFontSize: 12,
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  cornerRadius: 6,
  strokeWidth: 1.25,
  edgeStrokeWidth: 1.5,
};

const ARROW_INSET = 8;

const EMBEDDED_STYLE = `
  .ach-diag-bg { fill: var(--ach-diag-bg, transparent); }
  .ach-diag-node > rect, .ach-diag-node > polygon {
    fill: var(--ach-diag-stage-bg, #15151a);
    stroke: var(--ach-diag-stage-border, #2e2e33);
  }
  .ach-diag-node > line { stroke: var(--ach-diag-stage-border, #2e2e33); }
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
  .ach-diag-node[data-shape="terminator"] > rect {
    fill: var(--ach-diag-terminal-bg, #1a1a22);
    stroke: var(--ach-diag-terminal-border, #4a4a55);
  }
  .ach-diag-node[data-shape="decision"] > polygon {
    fill: var(--ach-diag-decision-bg, #1a1a24);
    stroke: var(--ach-diag-decision-border, #5a5a6e);
  }
  .ach-diag-node[data-shape="data"] > polygon {
    fill: var(--ach-diag-data-bg, #161a22);
    stroke: var(--ach-diag-data-border, #3e4858);
  }
  @media (prefers-color-scheme: light) {
    .ach-diag-node > rect, .ach-diag-node > polygon {
      fill: var(--ach-diag-stage-bg, #ffffff);
      stroke: var(--ach-diag-stage-border, #d4d4d8);
    }
    .ach-diag-node > line { stroke: var(--ach-diag-stage-border, #d4d4d8); }
    .ach-diag-node text { fill: var(--ach-diag-stage-text, #18181b); }
    .ach-diag-edge { stroke: var(--ach-diag-edge, #a1a1aa); }
    .ach-diag-arrow path { fill: var(--ach-diag-edge, #a1a1aa); }
    .ach-diag-edge-label-bg { fill: var(--ach-diag-edge-label-bg, #ffffff); }
    .ach-diag-edge-label { fill: var(--ach-diag-edge-label-text, #52525b); }
    .ach-diag-node[data-shape="terminator"] > rect {
      fill: var(--ach-diag-terminal-bg, #f4f4f5);
      stroke: var(--ach-diag-terminal-border, #a1a1aa);
    }
    .ach-diag-node[data-shape="decision"] > polygon {
      fill: var(--ach-diag-decision-bg, #faf5ff);
      stroke: var(--ach-diag-decision-border, #a78bfa);
    }
    .ach-diag-node[data-shape="data"] > polygon {
      fill: var(--ach-diag-data-bg, #f0f9ff);
      stroke: var(--ach-diag-data-border, #7dd3fc);
    }
  }
`.trim();

export interface FlowRenderResult {
  svg: string;
  width: number;
  height: number;
}

export function renderFlowchartSvg(
  layout: FlowchartLayout,
  theme: FlowRenderTheme = {},
  accessible = true,
): FlowRenderResult {
  const fontSize = theme.fontSize ?? DEFAULTS.fontSize;
  const edgeLabelFontSize = theme.edgeLabelFontSize ?? DEFAULTS.edgeLabelFontSize;
  const fontFamily = theme.fontFamily ?? DEFAULTS.fontFamily;
  const cornerRadius = theme.cornerRadius ?? DEFAULTS.cornerRadius;
  const strokeWidth = theme.strokeWidth ?? DEFAULTS.strokeWidth;

  const width = layout.bounds.maxX - layout.bounds.minX;
  const height = layout.bounds.maxY - layout.bounds.minY;

  const a11y = accessible
    ? `<title>Flowchart diagram</title><desc>${layout.nodes.length} nodes, ${layout.edges.length} edges</desc>`
    : '';
  const role = accessible ? ' role="img" aria-label="Flowchart diagram"' : '';

  const arrowDef = `<marker id="ach-diag-flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" class="ach-diag-arrow"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`;

  const edges = layout.edges
    .map((e) => renderEdge(e, layout.direction, edgeLabelFontSize, fontFamily))
    .join('');
  const nodes = layout.nodes
    .map((n) => renderNode(n, { fontSize, fontFamily, cornerRadius, strokeWidth }))
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${layout.bounds.minX} ${layout.bounds.minY} ${width} ${height}" width="${width}" height="${height}"${role}>${a11y}<defs>${arrowDef}<style>${EMBEDDED_STYLE}</style></defs><rect class="ach-diag-bg" x="${layout.bounds.minX}" y="${layout.bounds.minY}" width="${width}" height="${height}"/>${edges}${nodes}</svg>`;

  return { svg, width, height };
}

interface NodeRenderConfig {
  fontSize: number;
  fontFamily: string;
  cornerRadius: number;
  strokeWidth: number;
}

function renderNode(n: PositionedFlowNode, cfg: NodeRenderConfig): string {
  const cx = n.x + n.width / 2;
  const cy = n.y + n.height / 2;
  const shapeFragment = renderShape(n.shape, n, cfg.cornerRadius)
    .replace('<rect', `<rect stroke-width="${cfg.strokeWidth}"`)
    .replace('<polygon', `<polygon stroke-width="${cfg.strokeWidth}"`);
  return `<g class="ach-diag-node" data-shape="${n.shape}">${shapeFragment}<text x="${cx}" y="${cy}" font-family="${escapeXml(cfg.fontFamily)}" font-size="${cfg.fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(n.label)}</text></g>`;
}

function renderEdge(
  e: PositionedFlowEdge,
  direction: 'TB' | 'LR',
  labelFontSize: number,
  fontFamily: string,
): string {
  const tip = insetEndpoint(e.toPoint, e.toAnchor);
  const path = bezierPath(e.fromPoint, tip, e.fromAnchor, e.toAnchor);
  void direction;

  let labelEl = '';
  if (e.label !== undefined && e.label.length > 0) {
    const mid = midpoint(e.fromPoint, tip);
    const labelWidth = Math.max(20, e.label.length * 7 + 12);
    const labelHeight = labelFontSize + 8;
    labelEl = `<rect class="ach-diag-edge-label-bg" x="${mid.x - labelWidth / 2}" y="${mid.y - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="3" ry="3"/><text class="ach-diag-edge-label" x="${mid.x}" y="${mid.y}" font-family="${escapeXml(fontFamily)}" font-size="${labelFontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(e.label)}</text>`;
  }

  return `<path class="ach-diag-edge" d="${path}" stroke-width="${DEFAULTS.edgeStrokeWidth}" marker-end="url(#ach-diag-flow-arrow)"/>${labelEl}`;
}

function insetEndpoint(
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

function bezierPath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  fromSide: 'top' | 'right' | 'bottom' | 'left',
  toSide: 'top' | 'right' | 'bottom' | 'left',
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const verticalFlow = fromSide === 'bottom' || fromSide === 'top';
  const reverse = toSide === 'right' || toSide === 'left';

  if (verticalFlow && !reverse) {
    const midY = from.y + dy / 2;
    return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`;
  }
  if (!verticalFlow && !reverse) {
    const midX = from.x + dx / 2;
    return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`;
  }
  const offset = Math.max(40, Math.min(Math.abs(dx), Math.abs(dy)) / 2 + 30);
  const c1x =
    fromSide === 'right' ? from.x + offset : fromSide === 'left' ? from.x - offset : from.x;
  const c1y =
    fromSide === 'bottom' ? from.y + offset : fromSide === 'top' ? from.y - offset : from.y;
  const c2x = toSide === 'right' ? to.x + offset : toSide === 'left' ? to.x - offset : to.x;
  const c2y = toSide === 'bottom' ? to.y + offset : toSide === 'top' ? to.y - offset : to.y;
  return `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`;
}

function midpoint(
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

void shapeAnchor;
