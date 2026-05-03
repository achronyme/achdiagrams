import { describe, expect, it } from 'vitest';
import { cubicAt } from '../src/flowchart/bezier.js';
import { DiagramBuildError, diagram, flowchart } from '../src/index.js';

interface Cubic {
  start: { x: number; y: number };
  c1: { x: number; y: number };
  c2: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Parse an SVG path d-attribute of the form `M sx sy C c1x c1y, c2x c2y, ex ey C ...`
 * into a list of cubic segments.
 */
function parseCubicPath(d: string): Cubic[] {
  const moveMatch = d.match(/^M\s+([\d.-]+)\s+([\d.-]+)/);
  if (!moveMatch?.[1] || !moveMatch?.[2]) return [];
  let prev = { x: Number.parseFloat(moveMatch[1]), y: Number.parseFloat(moveMatch[2]) };
  const segs: Cubic[] = [];
  const re = /C\s+([\d.-]+)\s+([\d.-]+),\s*([\d.-]+)\s+([\d.-]+),\s*([\d.-]+)\s+([\d.-]+)/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: idiomatic regex iteration
  while ((m = re.exec(d)) !== null) {
    const c1 = { x: Number.parseFloat(m[1] ?? '0'), y: Number.parseFloat(m[2] ?? '0') };
    const c2 = { x: Number.parseFloat(m[3] ?? '0'), y: Number.parseFloat(m[4] ?? '0') };
    const end = { x: Number.parseFloat(m[5] ?? '0'), y: Number.parseFloat(m[6] ?? '0') };
    segs.push({ start: prev, c1, c2, end });
    prev = end;
  }
  return segs;
}

describe('flowchart builder + render', () => {
  it('exposes the flowchart factory on diagram', () => {
    expect(typeof diagram.flowchart).toBe('function');
  });

  it('builds a simple linear chart', () => {
    const ir = flowchart()
      .node('start', { label: 'Start', shape: 'terminator' })
      .node('do', { label: 'Do work' })
      .node('end', { label: 'End', shape: 'terminator' })
      .edge('start', 'do')
      .edge('do', 'end')
      .build();
    expect(ir.kind).toBe('flowchart');
    expect(ir.nodes).toHaveLength(3);
    expect(ir.edges).toHaveLength(2);
  });

  it('renders a chart with decision diamond and labelled branches', () => {
    const out = flowchart()
      .node('start', { label: 'Start', shape: 'terminator' })
      .node('check', { label: 'Valid?', shape: 'decision' })
      .node('ok', { label: 'Done', shape: 'terminator' })
      .node('fix', { label: 'Repair' })
      .edge('start', 'check')
      .edge('check', 'ok', { label: 'yes' })
      .edge('check', 'fix', { label: 'no' })
      .edge('fix', 'check')
      .render();

    expect(out.svg).toMatch(/^<svg /);
    expect(out.svg).toContain('data-shape="decision"');
    expect(out.svg).toContain('data-shape="terminator"');
    expect(out.svg).toContain('class="ach-diag-edge-label"');
    expect(out.svg).toContain('>yes<');
    expect(out.svg).toContain('>no<');
    expect(out.layoutMetrics.nodeCount).toBe(4);
    expect(out.layoutMetrics.edgeCount).toBe(4);
  });

  it('handles loop-back without throwing (cycles are valid in flowcharts)', () => {
    expect(() =>
      flowchart().node('a').node('b').edge('a', 'b').edge('b', 'a').render(),
    ).not.toThrow();
  });

  it('rejects edges referencing undeclared nodes', () => {
    expect(() =>
      flowchart()
        .node('a')
        // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
        .edge('a', 'ghost' as any)
        .build(),
    ).toThrow(DiagramBuildError);
  });

  it('escapes XML in labels and edge labels', () => {
    const out = flowchart()
      .node('a', { label: '<one>' })
      .node('b', { label: '<two>' })
      .edge('a', 'b', { label: '"go" & <do>' })
      .render();
    expect(out.svg).toContain('&lt;one&gt;');
    expect(out.svg).toContain('&lt;two&gt;');
    expect(out.svg).toContain('&quot;go&quot; &amp; &lt;do&gt;');
  });

  it('emits a11y attributes by default', () => {
    const out = flowchart().node('a').render();
    expect(out.svg).toContain('<title>Flowchart diagram</title>');
    expect(out.svg).toContain('role="img"');
  });

  it('includes data-shape="data" for data nodes', () => {
    const out = flowchart().node('input', { label: 'Read CSV', shape: 'data' }).render();
    expect(out.svg).toContain('data-shape="data"');
  });

  it('includes prefers-color-scheme styles in render output', () => {
    const out = flowchart().node('a').render();
    expect(out.svg).toContain('prefers-color-scheme: light');
    expect(out.svg).toContain('--ach-diag-decision-bg');
  });

  it('aligns single-node-per-layer chains on a common X axis', () => {
    // Mixing a narrow terminator, a wide decision, and a medium data should
    // still center every node on the same vertical axis when each layer
    // contains a single node.
    const out = flowchart()
      .node('a', { label: 'A', shape: 'terminator' })
      .node('b', { label: 'Schema OK?', shape: 'decision' })
      .node('c', { label: 'Read CSV', shape: 'data' })
      .node('d', { label: 'D' })
      .edge('a', 'b')
      .edge('b', 'c')
      .edge('c', 'd')
      .render();

    const rectMatches = [
      ...out.svg.matchAll(/<g class="ach-diag-node"[^>]*>(<rect|<polygon)([^/]*?)\/>/g),
    ];
    expect(rectMatches.length).toBeGreaterThanOrEqual(2);

    // Extract node centers from the rect/polygon attributes. For rects we read
    // x and width; for polygons we average vertex x-coordinates.
    const centers: number[] = [];
    const rectRe = /<rect([^>]*?)\/>/g;
    for (const m of out.svg.matchAll(rectRe)) {
      const attrs = m[1] ?? '';
      if (!/width="/.test(attrs)) continue;
      const xMatch = attrs.match(/\sx="([\d.-]+)"/);
      const wMatch = attrs.match(/\swidth="([\d.-]+)"/);
      if (xMatch?.[1] && wMatch?.[1]) {
        const x = Number.parseFloat(xMatch[1]);
        const w = Number.parseFloat(wMatch[1]);
        // Skip the background rect (always positioned at bounds.minX).
        if (Math.abs(x - out.viewBox.x) < 0.5) continue;
        centers.push(x + w / 2);
      }
    }
    const polyRe = /<polygon([^>]*?)\/>/g;
    for (const m of out.svg.matchAll(polyRe)) {
      const attrs = m[1] ?? '';
      const ptsMatch = attrs.match(/points="([^"]+)"/);
      if (!ptsMatch?.[1]) continue;
      const xs = ptsMatch[1]
        .trim()
        .split(/\s+/)
        .map((p) => Number.parseFloat(p.split(',')[0] ?? '0'));
      if (xs.length === 0) continue;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      centers.push((minX + maxX) / 2);
    }

    expect(centers.length).toBeGreaterThanOrEqual(2);
    const first = centers[0];
    if (first === undefined) throw new Error('no centers');
    for (const c of centers) {
      expect(Math.abs(c - first)).toBeLessThanOrEqual(1);
    }
  });

  it('long forward edges emit 2N-1 cubic segments for span N (Sugiyama §4)', () => {
    // Chain a→b→c→d (span 3) plus a direct edge a→d. The long edge has
    // 2 dummies (one per intermediate layer); each dummy contributes a
    // band-entry and band-exit waypoint. Path has 2*3 - 1 = 5 cubic
    // segments total.
    const out = flowchart()
      .node('a')
      .node('b')
      .node('c')
      .node('d')
      .edge('a', 'b')
      .edge('b', 'c')
      .edge('c', 'd')
      .edge('a', 'd')
      .render();

    const paths = [...out.svg.matchAll(/<path class="ach-diag-edge" d="([^"]+)"/g)];
    expect(paths.length).toBe(4);
    const cCounts = paths.map((m) => (m[1] ?? '').match(/\bC\b/g)?.length ?? 0);
    cCounts.sort((a, b) => a - b);
    expect(cCounts).toEqual([1, 1, 1, 5]);
  });

  it('long forward edge clears intermediate-layer real nodes', () => {
    // a→b→c chain plus direct a→c. The direct edge spans layer 0→2 with a
    // real node `b` in layer 1. With dummy-node routing, the rendered cubic
    // path of a→c must not pass through any point inside `b`'s bbox.
    const out = flowchart()
      .node('a')
      .node('b', { label: 'middle' })
      .node('c')
      .edge('a', 'b')
      .edge('b', 'c')
      .edge('a', 'c')
      .render();

    const paths = [...out.svg.matchAll(/<path class="ach-diag-edge" d="([^"]+)"/g)];
    // Span 2 → 1 dummy → 2*2 - 1 = 3 cubic segments.
    const longD = paths.map((m) => m[1] ?? '').find((d) => (d.match(/\bC\b/g)?.length ?? 0) >= 3);
    expect(longD).toBeTruthy();
    if (!longD) return;
    expect(longD.match(/\bC\b/g)?.length ?? 0).toBe(3);

    // Find b's rect: the only `<rect>` whose label-text matches "middle".
    // The renderer emits each node as `<g class="ach-diag-node" data-shape="...">
    // <rect x= y= width= height= ...>...<text>middle</text></g>`.
    const nodeBlock = out.svg.match(
      /<g class="ach-diag-node"[^>]*>(<rect[^/]+\/>)[^<]*(?:<[^>]+>)*[^<]*middle/,
    );
    expect(nodeBlock?.[1]).toBeTruthy();
    if (!nodeBlock?.[1]) return;
    const rectStr = nodeBlock[1];
    const xMatch = rectStr.match(/\sx="([\d.-]+)"/);
    const yMatch = rectStr.match(/\sy="([\d.-]+)"/);
    const wMatch = rectStr.match(/\swidth="([\d.-]+)"/);
    const hMatch = rectStr.match(/\sheight="([\d.-]+)"/);
    if (!xMatch?.[1] || !yMatch?.[1] || !wMatch?.[1] || !hMatch?.[1]) {
      throw new Error('failed to parse b rect');
    }
    const bx = Number.parseFloat(xMatch[1]);
    const by = Number.parseFloat(yMatch[1]);
    const bw = Number.parseFloat(wMatch[1]);
    const bh = Number.parseFloat(hMatch[1]);

    // Sample every cubic segment at 21 t-values; assert no sample lies
    // strictly inside b's rect. (We only flag samples > 0.5 px inside the
    // rect — endpoints near node anchors can be exactly on the edge.)
    const segs = parseCubicPath(longD);
    expect(segs.length).toBe(3);
    const EPS = 0.5;
    for (const s of segs) {
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const p = cubicAt(t, s.start, s.c1, s.c2, s.end);
        const insideX = p.x > bx + EPS && p.x < bx + bw - EPS;
        const insideY = p.y > by + EPS && p.y < by + bh - EPS;
        if (insideX && insideY) {
          throw new Error(
            `path point (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) at t=${t} inside b's rect [${bx},${by},${bw},${bh}]`,
          );
        }
      }
    }
  });

  it('parallel long forward edges receive symmetric perpendicular offsets', () => {
    // Two parallel a→d edges across 3 layers (a→b→c→d). The dummy waypoints
    // for each parallel chain should be perpendicular-offset by ±12 px so the
    // two paths visually fan out instead of overlapping. Endpoint anchors
    // are shared, but the dummy bend points differ.
    const out = flowchart()
      .node('a')
      .node('b')
      .node('c')
      .node('d')
      .edge('a', 'b')
      .edge('b', 'c')
      .edge('c', 'd')
      .edge('a', 'd', { label: 'one' })
      .edge('a', 'd', { label: 'two' })
      .render();

    const paths = [...out.svg.matchAll(/<path class="ach-diag-edge" d="([^"]+)"/g)];
    // Each long edge: span 3 → 2 dummies → 5 cubic segments.
    const longPaths = paths
      .map((m) => m[1] ?? '')
      .filter((d) => (d.match(/\bC\b/g)?.length ?? 0) === 5);
    expect(longPaths.length).toBe(2);
    const [p0, p1] = longPaths.map(parseCubicPath);
    if (!p0 || !p1) throw new Error('expected two parsed long paths');
    expect(p0.length).toBe(5);
    expect(p1.length).toBe(5);

    // Endpoint anchors are shared between the two parallel edges.
    expect(p0[0]?.start.x).toBe(p1[0]?.start.x);
    expect(p0[0]?.start.y).toBe(p1[0]?.start.y);
    expect(p0[4]?.end.x).toBe(p1[4]?.end.x);
    expect(p0[4]?.end.y).toBe(p1[4]?.end.y);

    // Dummy entry/exit waypoints differ between the two parallel chains
    // (positionDummies distributes them across the gap, and parallel
    // offset shifts them further apart). The chains must not overlap.
    const firstDummyX0 = p0[1]?.start.x ?? 0;
    const firstDummyX1 = p1[1]?.start.x ?? 0;
    expect(firstDummyX0).not.toBe(firstDummyX1);
    // The two chains stay parallel: the offset between them is consistent
    // across both intermediate dummies (within float tolerance).
    const secondDummyX0 = p0[3]?.start.x ?? 0;
    const secondDummyX1 = p1[3]?.start.x ?? 0;
    expect(secondDummyX0).not.toBe(secondDummyX1);
    const delta1 = firstDummyX0 - firstDummyX1;
    const delta2 = secondDummyX0 - secondDummyX1;
    expect(Math.abs(delta1 - delta2)).toBeLessThan(0.01);
  });

  it('dummy nodes contribute zero horizontal extent (no layer-width inflation)', () => {
    // Compare the rendered viewBox width of two graphs:
    //   baseline: a→b chain (no long edges, no dummies)
    //   long:     a→b chain plus a direct a→[…]→z long edge that crosses
    //             several layers — should not widen the layout.
    const baseline = flowchart().node('a').node('b').edge('a', 'b').render();
    const withLong = flowchart()
      .node('a')
      .node('b')
      .node('c')
      .node('d')
      .edge('a', 'b')
      .edge('b', 'c')
      .edge('c', 'd')
      .edge('a', 'd') // long forward edge across 3 layers
      .render();

    // The width of the `withLong` layout should not exceed the per-layer
    // width of a single real node by much (it's a single-column chain plus
    // a long edge with dummies that should not contribute to layer width).
    // Specifically, both should be within the same width band as the
    // single-node-per-layer arrangement.
    const baselineW = baseline.viewBox.width;
    const longW = withLong.viewBox.width;
    // Allow for the long edge's curved segments to slightly extend the
    // bounding box (the cubic can swing outside chord), but no more than
    // ~30 % of baseline (vs the >100 % inflation we'd get from non-zero
    // dummy width).
    expect(longW).toBeLessThan(baselineW * 1.3);
  });

  it('fans out parallel edges so they do not overlap', () => {
    // Two parallel edges between the same pair should produce two distinct
    // bezier paths with mirrored perpendicular offsets, not identical paths.
    const out = flowchart()
      .node('a', { label: 'A' })
      .node('b', { label: 'B' })
      .edge('a', 'b', { label: 'one' })
      .edge('a', 'b', { label: 'two' })
      .render();

    const paths = [
      ...out.svg.matchAll(
        /<path class="ach-diag-edge" d="M ([\d.-]+) ([\d.-]+) C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)"/g,
      ),
    ];
    expect(paths.length).toBe(2);
    const [p0, p1] = paths;
    if (!p0 || !p1) throw new Error('expected two paths');
    // Endpoints (M and final point) match — both edges share anchors.
    expect(p0[1]).toBe(p1[1]);
    expect(p0[2]).toBe(p1[2]);
    expect(p0[7]).toBe(p1[7]);
    expect(p0[8]).toBe(p1[8]);
    // Control points differ — they're offset symmetrically around the chord.
    const c1y0 = Number.parseFloat(p0[4] ?? '0');
    const c1y1 = Number.parseFloat(p1[4] ?? '0');
    const c2y0 = Number.parseFloat(p0[6] ?? '0');
    const c2y1 = Number.parseFloat(p1[6] ?? '0');
    // For a TB chart the bend axis is x; for LR it's y. Default direction is
    // TB so check x of c1/c2 differs. But the perpendicular axis depends on
    // verticalFlow, so accept either component differing — the assertion is
    // that the two paths are not identical.
    const c1x0 = Number.parseFloat(p0[3] ?? '0');
    const c1x1 = Number.parseFloat(p1[3] ?? '0');
    const c2x0 = Number.parseFloat(p0[5] ?? '0');
    const c2x1 = Number.parseFloat(p1[5] ?? '0');
    const someComponentDiffers = c1x0 !== c1x1 || c2x0 !== c2x1 || c1y0 !== c1y1 || c2y0 !== c2y1;
    expect(someComponentDiffers).toBe(true);
    // Symmetry: the two offsets should be ± the same magnitude, so their
    // sum on the perpendicular axis equals 2 × the unperturbed value.
    // For the default TB layout the perpendicular axis is x.
    const sumC1x = c1x0 + c1x1;
    const sumC2x = c2x0 + c2x1;
    // 2 × from.x at c1 since unperturbed c1.x = from.x. Within float tolerance.
    expect(Math.abs(sumC1x - sumC2x)).toBeLessThan(0.01);
  });
});
