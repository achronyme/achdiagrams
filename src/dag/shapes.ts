/**
 * DAG node shapes — SVG fragments + anchor points for edge attachment.
 *
 * Per SPEC §3 (DAG genérico): rect, circle, ellipse, diamond, hexagon, none.
 */

import type { DAGShape } from '../types.js';

export interface ShapeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Anchor = 'top' | 'right' | 'bottom' | 'left';

export interface AnchorPoint {
  x: number;
  y: number;
}

export function renderShape(shape: DAGShape, box: ShapeBox, cornerRadius: number): string {
  switch (shape) {
    case 'rect':
      return rect(box, cornerRadius);
    case 'circle':
      return circle(box);
    case 'ellipse':
      return ellipse(box);
    case 'diamond':
      return diamond(box);
    case 'hexagon':
      return hexagon(box);
    case 'none':
      return '';
    default: {
      const exhaustive: never = shape;
      void exhaustive;
      return rect(box, cornerRadius);
    }
  }
}

export function shapeAnchor(shape: DAGShape, box: ShapeBox, side: Anchor): AnchorPoint {
  // Anchors on bbox suffice for DAG: edges already approach from rectangular
  // grid neighbours, and shape-specific inset is handled visually by the
  // rendered fill/stroke not touching the actual line endpoint by ARROW_INSET.
  void shape;
  return bboxAnchor(box, side);
}

function rect(b: ShapeBox, r: number): string {
  return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${r}" ry="${r}"/>`;
}

function circle(b: ShapeBox): string {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const r = Math.min(b.width, b.height) / 2;
  return `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
}

function ellipse(b: ShapeBox): string {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return `<ellipse cx="${cx}" cy="${cy}" rx="${b.width / 2}" ry="${b.height / 2}"/>`;
}

function diamond(b: ShapeBox): string {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  return `<polygon points="${cx},${b.y} ${right},${cy} ${cx},${bottom} ${b.x},${cy}"/>`;
}

function hexagon(b: ShapeBox): string {
  // Pointy-top hex variant: slanted left/right sides, flat top/bottom.
  const inset = Math.min(b.height * 0.5, b.width * 0.18);
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  const cy = b.y + b.height / 2;
  return `<polygon points="${b.x + inset},${b.y} ${right - inset},${b.y} ${right},${cy} ${right - inset},${bottom} ${b.x + inset},${bottom} ${b.x},${cy}"/>`;
}

function bboxAnchor(b: ShapeBox, side: Anchor): AnchorPoint {
  switch (side) {
    case 'top':
      return { x: b.x + b.width / 2, y: b.y };
    case 'right':
      return { x: b.x + b.width, y: b.y + b.height / 2 };
    case 'bottom':
      return { x: b.x + b.width / 2, y: b.y + b.height };
    case 'left':
      return { x: b.x, y: b.y + b.height / 2 };
  }
}

export function widthFactorFor(shape: DAGShape): number {
  if (shape === 'diamond') return 1.5;
  if (shape === 'hexagon') return 1.2;
  if (shape === 'circle') return 1.4;
  return 1;
}
