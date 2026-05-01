import { describe, expect, it } from 'vitest';
import { DiagramBuildError, diagram, pipeline } from '../src/index.js';

describe('@achronyme/diagrams scaffolding', () => {
  it('exports a diagram factory', () => {
    expect(diagram).toBeDefined();
    expect(typeof diagram.pipeline).toBe('function');
  });

  it('pipeline() returns a chainable builder', () => {
    const ir = pipeline()
      .stage('extract', { label: 'Extract' })
      .stage('transform', { label: 'Transform' })
      .stage('load', { label: 'Load' })
      .edge('extract', 'transform')
      .edge('transform', 'load')
      .build();

    expect(ir.kind).toBe('pipeline');
    expect(ir.stages).toHaveLength(3);
    expect(ir.edges).toHaveLength(2);
  });

  it('build() rejects edges that reference undeclared stages', () => {
    expect(() =>
      pipeline()
        .stage('a')
        // biome-ignore lint/suspicious/noExplicitAny: testing runtime guard
        .edge('a', 'ghost' as any)
        .build(),
    ).toThrow(DiagramBuildError);
  });

  it('build() rejects cyclic pipelines at runtime', () => {
    // Type-state catches reverse edges at compile-time; cast to bypass that
    // and exercise the runtime cycle detector in validate().
    // biome-ignore lint/suspicious/noExplicitAny: bypassing type-state for runtime check
    const cyclic = pipeline().stage('a').stage('b').edge('a', 'b') as any;
    expect(() => cyclic.edge('b', 'a').build()).toThrow(DiagramBuildError);
  });

  it('render() returns SVG + viewBox + layout metrics', () => {
    const out = pipeline()
      .stage('a', { label: 'A' })
      .stage('b', { label: 'B' })
      .edge('a', 'b')
      .render();

    expect(out.svg).toMatch(/^<svg /);
    expect(out.svg).toContain('</svg>');
    expect(out.viewBox.width).toBeGreaterThan(0);
    expect(out.viewBox.height).toBeGreaterThan(0);
    expect(out.layoutMetrics.nodeCount).toBe(2);
    expect(out.layoutMetrics.edgeCount).toBe(1);
  });
});
