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
});
