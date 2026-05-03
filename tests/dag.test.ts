import { describe, expect, it } from 'vitest';
import { DiagramBuildError, dag, diagram } from '../src/index.js';

describe('dag builder + render', () => {
  it('exposes the dag factory on diagram', () => {
    expect(typeof diagram.dag).toBe('function');
  });

  it('builds an empty DAG without throwing', () => {
    const ir = dag().build();
    expect(ir.kind).toBe('dag');
    expect(ir.nodes).toHaveLength(0);
    expect(ir.edges).toHaveLength(0);
  });

  it('renders a single-node DAG', () => {
    const out = dag().node('only', { label: 'Only', shape: 'circle' }).render();
    expect(out.svg).toMatch(/^<svg /);
    expect(out.svg).toContain('data-shape="circle"');
    expect(out.layoutMetrics.nodeCount).toBe(1);
    expect(out.layoutMetrics.edgeCount).toBe(0);
  });

  it('renders a chain of nodes with default rect + arrowhead', () => {
    const out = dag().node('a').node('b').node('c').edge('a', 'b').edge('b', 'c').render();
    expect(out.svg).toContain('data-shape="rect"');
    expect(out.svg).toContain('marker-end="url(#ach-diag-dag-arrow)"');
    expect(out.layoutMetrics.nodeCount).toBe(3);
    expect(out.layoutMetrics.edgeCount).toBe(2);
  });

  it('omits the arrowhead for undirected edges', () => {
    const out = dag().node('a').node('b').edge('a', 'b', { directed: false }).render();
    expect(out.svg).not.toContain('marker-end="url(#ach-diag-dag-arrow)"');
  });

  it('renders dashed and dotted styles via stroke-dasharray', () => {
    const out = dag()
      .node('a')
      .node('b')
      .node('c')
      .edge('a', 'b', { style: 'dashed' })
      .edge('b', 'c', { style: 'dotted' })
      .render();
    expect(out.svg).toContain('stroke-dasharray="6 4"');
    expect(out.svg).toContain('stroke-dasharray="2 3"');
  });

  it('supports diamond shape', () => {
    const out = dag().node('cond', { label: '?', shape: 'diamond' }).render();
    expect(out.svg).toContain('<polygon');
    expect(out.svg).toContain('data-shape="diamond"');
  });

  it('supports hexagon shape', () => {
    const out = dag().node('h', { shape: 'hexagon' }).render();
    expect(out.svg).toContain('data-shape="hexagon"');
    expect(out.svg).toContain('<polygon');
  });

  it('supports ellipse shape', () => {
    const out = dag().node('e', { shape: 'ellipse' }).render();
    expect(out.svg).toContain('<ellipse');
  });

  it('supports shape="none" (text-only node)', () => {
    const out = dag().node('text', { label: 'note', shape: 'none' }).render();
    expect(out.svg).toContain('data-shape="none"');
    expect(out.svg).toContain('>note<');
  });

  it('renders a diamond DAG (a→b, a→c, b→d, c→d)', () => {
    const out = dag()
      .node('a')
      .node('b')
      .node('c')
      .node('d')
      .edge('a', 'b')
      .edge('a', 'c')
      .edge('b', 'd')
      .edge('c', 'd')
      .render();
    expect(out.layoutMetrics.nodeCount).toBe(4);
    expect(out.layoutMetrics.edgeCount).toBe(4);
    // a is at layer 0, d at layer 2, b and c share layer 1.
  });

  it('routes self-loops with data-routing="self-loop"', () => {
    const out = dag().node('a').edge('a', 'a').render();
    expect(out.svg).toContain('data-routing="self-loop"');
  });

  it('handles disconnected components (no shared edges)', () => {
    const out = dag()
      .node('a')
      .node('b')
      .node('c')
      .node('d')
      .edge('a', 'b')
      .edge('c', 'd')
      .render();
    expect(out.layoutMetrics.nodeCount).toBe(4);
    expect(out.layoutMetrics.edgeCount).toBe(2);
    // Both components share layer 0 / layer 1 in the Kahn topo since each
    // root has in-degree 0. Bounds should fit all four nodes without crashing.
    expect(out.layoutMetrics.bounds.maxX - out.layoutMetrics.bounds.minX).toBeGreaterThan(0);
    expect(out.layoutMetrics.bounds.maxY - out.layoutMetrics.bounds.minY).toBeGreaterThan(0);
  });

  it('handles multi-edges (two edges between the same endpoints)', () => {
    const out = dag()
      .node('a')
      .node('b')
      .edge('a', 'b', { label: 'first' })
      .edge('a', 'b', { label: 'second' })
      .render();
    expect(out.svg).toContain('>first<');
    expect(out.svg).toContain('>second<');
    expect(out.layoutMetrics.edgeCount).toBe(2);
  });

  it('allows cycles without throwing', () => {
    expect(() => dag().node('a').node('b').edge('a', 'b').edge('b', 'a').render()).not.toThrow();
  });

  it('renders edge labels', () => {
    const out = dag().node('a').node('b').edge('a', 'b', { label: 'go' }).render();
    expect(out.svg).toContain('class="ach-diag-edge-label"');
    expect(out.svg).toContain('>go<');
  });

  it('honors per-node fill / stroke overrides', () => {
    const out = dag().node('a', { fill: '#ff0', stroke: '#f00', strokeWidth: 3 }).render();
    expect(out.svg).toContain('fill="#ff0"');
    expect(out.svg).toContain('stroke="#f00"');
    expect(out.svg).toContain('stroke-width="3"');
  });

  it('honors LR direction', () => {
    const out = dag().node('a').node('b').edge('a', 'b').render({ direction: 'LR' });
    // In LR, a sits to the left of b: a.x < b.x.
    // Pull positions out of the SVG by re-running the layout indirectly
    // through bounds — the bounds width should exceed height for a 2-node LR.
    expect(out.layoutMetrics.bounds.maxX - out.layoutMetrics.bounds.minX).toBeGreaterThan(
      out.layoutMetrics.bounds.maxY - out.layoutMetrics.bounds.minY,
    );
  });

  it('honors layout() chainable config', () => {
    const out = dag()
      .node('a')
      .node('b')
      .edge('a', 'b')
      .layout({ direction: 'LR', padding: 64 })
      .render();
    // Padding 64 → bounds inflated. The LR direction should also widen.
    expect(out.layoutMetrics.bounds.minX).toBeLessThanOrEqual(0);
  });

  it('rejects edges that reference undeclared nodes', () => {
    expect(() =>
      dag()
        .node('a')
        // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
        .edge('a', 'ghost' as any)
        .build(),
    ).toThrow(DiagramBuildError);
  });

  describe('coordinateAssignment: brandes-kopf (opt-in)', () => {
    it('renders a chain with the brandes-kopf flag without crashing', () => {
      const out = dag()
        .node('a')
        .node('b')
        .node('c')
        .edge('a', 'b')
        .edge('b', 'c')
        .layout({ coordinateAssignment: 'brandes-kopf' })
        .render();
      expect(out.svg).toMatch(/^<svg /);
      expect(out.layoutMetrics.nodeCount).toBe(3);
      expect(out.layoutMetrics.edgeCount).toBe(2);
    });

    it('renders a long edge through dummies with brandes-kopf', () => {
      // 4-layer chain — internally inserts 2 dummies for the long
      // edge a→z when span > 1. B-K should produce a clean column.
      const out = dag()
        .node('a')
        .node('b')
        .node('c')
        .node('z')
        .edge('a', 'b')
        .edge('b', 'c')
        .edge('c', 'z')
        .edge('a', 'z') // long edge spanning 3 layers
        .layout({ coordinateAssignment: 'brandes-kopf' })
        .render();
      expect(out.svg).toMatch(/^<svg /);
      expect(out.layoutMetrics.edgeCount).toBe(4);
    });

    it('renders a diamond with brandes-kopf', () => {
      const out = dag()
        .node('a')
        .node('b')
        .node('c')
        .node('d')
        .edge('a', 'b')
        .edge('a', 'c')
        .edge('b', 'd')
        .edge('c', 'd')
        .layout({ coordinateAssignment: 'brandes-kopf' })
        .render();
      expect(out.svg).toMatch(/^<svg /);
      expect(out.layoutMetrics.nodeCount).toBe(4);
      expect(out.layoutMetrics.edgeCount).toBe(4);
    });

    it('produces different layout from lerp on the same input (asymmetric)', () => {
      // Asymmetric input where B-K's per-vertex placement should differ
      // from lerp's equal-spacing-per-layer.
      const lerpOut = dag()
        .node('a')
        .node('b')
        .node('c')
        .node('d')
        .edge('a', 'b')
        .edge('a', 'c')
        .edge('b', 'd') // c has no L2 child
        .render(); // default 'lerp'
      const bkOut = dag()
        .node('a')
        .node('b')
        .node('c')
        .node('d')
        .edge('a', 'b')
        .edge('a', 'c')
        .edge('b', 'd')
        .layout({ coordinateAssignment: 'brandes-kopf' })
        .render();
      // Bounds should differ because B-K's δ is computed differently
      // than lerp's withinLayerSpacing-driven placement. Either width
      // or content positioning will diverge — we just lock that the
      // two paths produce non-identical output.
      expect(bkOut.svg).not.toBe(lerpOut.svg);
    });
  });
});
