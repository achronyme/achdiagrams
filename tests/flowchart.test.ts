import { describe, expect, it } from 'vitest';
import { DiagramBuildError, diagram, flowchart } from '../src/index.js';

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
});
