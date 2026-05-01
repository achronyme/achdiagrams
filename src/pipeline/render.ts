/**
 * Pipeline SVG renderer — Fase 1 MVP.
 *
 * Theming is consumed via CSS custom properties so the produced SVG inherits
 * the host site's design tokens automatically. Hard-coded fallbacks ensure the
 * SVG looks reasonable when embedded outside the styled host (e.g. raw file
 * preview).
 *
 * See SPEC §4 for the full theming spec.
 */

import type { PipelineLayout, PositionedEdge, PositionedStage } from './layout.js';

export interface RenderTheme {
  fontSize?: number;
  fontFamily?: string;
  stageRadius?: number;
  strokeWidth?: number;
}

const DEFAULTS = {
  fontSize: 14,
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
  stageRadius: 10,
  strokeWidth: 1.25,
  edgeStrokeWidth: 1.5,
};

const ARROW_INSET = 8;

const EMBEDDED_STYLE = `
  .ach-diag-bg { fill: var(--ach-diag-bg, transparent); }
  .ach-diag-stage rect {
    fill: var(--ach-diag-stage-bg, #1a1a1c);
    stroke: var(--ach-diag-stage-border, #2e2e33);
  }
  .ach-diag-stage text {
    fill: var(--ach-diag-stage-text, #ededef);
    font-feature-settings: "ss01" on, "cv11" on;
  }
  .ach-diag-edge {
    stroke: var(--ach-diag-edge, #5a5a63);
    fill: none;
  }
  .ach-diag-arrow path { fill: var(--ach-diag-edge, #5a5a63); }
  .ach-diag-stage[data-subtype="start"] rect,
  .ach-diag-stage[data-subtype="end"] rect {
    fill: var(--ach-diag-terminal-bg, #1f1f24);
    stroke: var(--ach-diag-terminal-border, #4a4a55);
  }
  .ach-diag-stage[data-subtype="parallel-fork"] rect,
  .ach-diag-stage[data-subtype="parallel-join"] rect {
    fill: var(--ach-diag-fork-bg, #1a1f24);
    stroke: var(--ach-diag-fork-border, #3a4a5a);
  }
  @media (prefers-color-scheme: light) {
    .ach-diag-stage rect {
      fill: var(--ach-diag-stage-bg, #ffffff);
      stroke: var(--ach-diag-stage-border, #d4d4d8);
    }
    .ach-diag-stage text { fill: var(--ach-diag-stage-text, #18181b); }
    .ach-diag-edge { stroke: var(--ach-diag-edge, #a1a1aa); }
    .ach-diag-arrow path { fill: var(--ach-diag-edge, #a1a1aa); }
  }
`.trim();

export interface RenderResult {
  svg: string;
  width: number;
  height: number;
}

export function renderPipelineSvg(
  layout: PipelineLayout,
  theme: RenderTheme = {},
  accessible = true,
): RenderResult {
  const fontSize = theme.fontSize ?? DEFAULTS.fontSize;
  const fontFamily = theme.fontFamily ?? DEFAULTS.fontFamily;
  const stageRadius = theme.stageRadius ?? DEFAULTS.stageRadius;
  const strokeWidth = theme.strokeWidth ?? DEFAULTS.strokeWidth;

  const width = layout.bounds.maxX - layout.bounds.minX;
  const height = layout.bounds.maxY - layout.bounds.minY;

  const a11y = accessible
    ? `<title>Pipeline diagram</title><desc>${layout.stages.length} stages, ${layout.edges.length} edges</desc>`
    : '';
  const role = accessible ? ' role="img" aria-label="Pipeline diagram"' : '';

  const arrowDef = `<marker id="ach-diag-arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" class="ach-diag-arrow"><path d="M 0 0 L 10 5 L 0 10 z"/></marker>`;

  const edges = layout.edges.map((e) => renderEdge(e, layout.direction)).join('');
  const stages = layout.stages
    .map((s) => renderStage(s, { fontSize, fontFamily, stageRadius, strokeWidth }))
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${layout.bounds.minX} ${layout.bounds.minY} ${width} ${height}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block"${role}>${a11y}<defs>${arrowDef}<style>${EMBEDDED_STYLE}</style></defs><rect class="ach-diag-bg" x="${layout.bounds.minX}" y="${layout.bounds.minY}" width="${width}" height="${height}"/>${edges}${stages}</svg>`;

  return { svg, width, height };
}

interface StageRenderConfig {
  fontSize: number;
  fontFamily: string;
  stageRadius: number;
  strokeWidth: number;
}

function renderStage(s: PositionedStage, cfg: StageRenderConfig): string {
  const cx = s.x + s.width / 2;
  const cy = s.y + s.height / 2;
  const subtypeAttr = s.subtype !== undefined ? ` data-subtype="${s.subtype}"` : '';
  return `<g class="ach-diag-stage"${subtypeAttr}><rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${cfg.stageRadius}" ry="${cfg.stageRadius}" stroke-width="${cfg.strokeWidth}"/><text x="${cx}" y="${cy}" font-family="${escapeXml(cfg.fontFamily)}" font-size="${cfg.fontSize}" text-anchor="middle" dominant-baseline="central">${escapeXml(s.label)}</text></g>`;
}

function renderEdge(e: PositionedEdge, direction: 'LR' | 'TB'): string {
  const tipX = direction === 'LR' ? e.toPoint.x - ARROW_INSET : e.toPoint.x;
  const tipY = direction === 'TB' ? e.toPoint.y - ARROW_INSET : e.toPoint.y;

  let path: string;
  if (direction === 'LR') {
    const midX = (e.fromPoint.x + tipX) / 2;
    path = `M ${e.fromPoint.x} ${e.fromPoint.y} C ${midX} ${e.fromPoint.y}, ${midX} ${tipY}, ${tipX} ${tipY}`;
  } else {
    const midY = (e.fromPoint.y + tipY) / 2;
    path = `M ${e.fromPoint.x} ${e.fromPoint.y} C ${e.fromPoint.x} ${midY}, ${tipX} ${midY}, ${tipX} ${tipY}`;
  }

  return `<path class="ach-diag-edge" d="${path}" stroke-width="${DEFAULTS.edgeStrokeWidth}" marker-end="url(#ach-diag-arrowhead)"/>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
