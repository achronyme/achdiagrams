/**
 * Flowchart node shapes — SVG fragments + anchor points for edge attachment.
 *
 * Per SPEC §3.1 (B.1 Flowchart): process, decision, terminator, data,
 * predefined-process. Each shape returns an SVG fragment and a function
 * that resolves the connection point for an incoming/outgoing edge given
 * a target side (top/right/bottom/left).
 */

export type FlowShape = 'process' | 'decision' | 'terminator' | 'data' | 'predefined-process';

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

export function renderShape(shape: FlowShape, box: ShapeBox, cornerRadius: number): string {
  switch (shape) {
    case 'process':
      return rect(box, cornerRadius);
    case 'decision':
      return diamond(box);
    case 'terminator':
      return rect(box, box.height / 2);
    case 'data':
      return parallelogram(box);
    case 'predefined-process':
      return predefinedProcess(box, cornerRadius);
    default: {
      const exhaustive: never = shape;
      void exhaustive;
      return rect(box, cornerRadius);
    }
  }
}

export function shapeAnchor(shape: FlowShape, box: ShapeBox, side: Anchor): AnchorPoint {
  if (shape === 'decision') return diamondAnchor(box, side);
  if (shape === 'data') return parallelogramAnchor(box, side);
  return bboxAnchor(box, side);
}

function rect(b: ShapeBox, r: number): string {
  return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${r}" ry="${r}"/>`;
}

function diamond(b: ShapeBox): string {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  return `<polygon points="${cx},${b.y} ${right},${cy} ${cx},${bottom} ${b.x},${cy}"/>`;
}

function parallelogram(b: ShapeBox): string {
  const skew = Math.min(b.height * 0.32, 18);
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  return `<polygon points="${b.x + skew},${b.y} ${right},${b.y} ${right - skew},${bottom} ${b.x},${bottom}"/>`;
}

function predefinedProcess(b: ShapeBox, r: number): string {
  const inset = 9;
  return [
    `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${r}" ry="${r}"/>`,
    `<line x1="${b.x + inset}" y1="${b.y}" x2="${b.x + inset}" y2="${b.y + b.height}"/>`,
    `<line x1="${b.x + b.width - inset}" y1="${b.y}" x2="${b.x + b.width - inset}" y2="${b.y + b.height}"/>`,
  ].join('');
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

function diamondAnchor(b: ShapeBox, side: Anchor): AnchorPoint {
  return bboxAnchor(b, side);
}

function parallelogramAnchor(b: ShapeBox, side: Anchor): AnchorPoint {
  const skew = Math.min(b.height * 0.32, 18);
  switch (side) {
    case 'top':
      return { x: b.x + b.width / 2 + skew / 2, y: b.y };
    case 'bottom':
      return { x: b.x + b.width / 2 - skew / 2, y: b.y + b.height };
    case 'right':
    case 'left':
      return bboxAnchor(b, side);
  }
}

export function widthFactorFor(shape: FlowShape): number {
  if (shape === 'decision') return 1.5;
  if (shape === 'data') return 1.15;
  return 1;
}
