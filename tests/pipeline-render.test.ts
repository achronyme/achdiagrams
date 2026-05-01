import { describe, expect, it } from 'vitest';
import { pipeline } from '../src/index.js';

describe('pipeline render — Fase 1 layout + SVG', () => {
  it('places linear stages in left-to-right order', () => {
    const out = pipeline().stage('a').stage('b').stage('c').edge('a', 'b').edge('b', 'c').render();

    expect(out.layoutMetrics.nodeCount).toBe(3);
    expect(out.layoutMetrics.edgeCount).toBe(2);
    expect(out.layoutMetrics.bounds.maxX).toBeGreaterThan(out.layoutMetrics.bounds.minX);
  });

  it('renders fan-out: one source → two sinks lands them on the same layer', () => {
    const out = pipeline()
      .stage('src')
      .stage('a')
      .stage('b')
      .edge('src', 'a')
      .edge('src', 'b')
      .render();

    expect(out.layoutMetrics.nodeCount).toBe(3);
    expect(out.layoutMetrics.edgeCount).toBe(2);
  });

  it('produces a valid <svg> root with viewBox attribute', () => {
    const out = pipeline().stage('one').render();
    expect(out.svg).toMatch(/<svg [^>]*viewBox="[-\d.]+ [-\d.]+ [\d.]+ [\d.]+"/);
  });

  it('emits a11y title + desc when accessible (default)', () => {
    const out = pipeline().stage('a').stage('b').edge('a', 'b').render();
    expect(out.svg).toContain('<title>Pipeline diagram</title>');
    expect(out.svg).toContain('role="img"');
  });

  it('omits a11y attributes when accessible=false', () => {
    const out = pipeline().stage('a').render({ accessible: false });
    expect(out.svg).not.toContain('<title>');
    expect(out.svg).not.toContain('role="img"');
  });

  it('emits CSS custom properties for theming', () => {
    const out = pipeline().stage('a').render();
    expect(out.svg).toContain('--ach-diag-stage-bg');
    expect(out.svg).toContain('--ach-diag-edge');
    expect(out.svg).toContain('prefers-color-scheme: light');
  });

  it('escapes XML special characters in labels', () => {
    const out = pipeline().stage('a', { label: '<bad> & "danger"' }).render();
    expect(out.svg).toContain('&lt;bad&gt; &amp; &quot;danger&quot;');
    expect(out.svg).not.toMatch(/<bad>/);
  });

  it('tags terminal subtypes with data-subtype attribute', () => {
    const out = pipeline()
      .stage('start', { subtype: 'start' })
      .stage('end', { subtype: 'end' })
      .edge('start', 'end')
      .render();
    expect(out.svg).toContain('data-subtype="start"');
    expect(out.svg).toContain('data-subtype="end"');
  });

  it('respects custom padding', () => {
    const small = pipeline().stage('a').render({ padding: 4 });
    const large = pipeline().stage('a').render({ padding: 64 });
    expect(large.viewBox.width).toBeGreaterThan(small.viewBox.width);
    expect(large.viewBox.height).toBeGreaterThan(small.viewBox.height);
  });

  it('handles fan-in: two sources → one sink', () => {
    const out = pipeline()
      .stage('a')
      .stage('b')
      .stage('merge')
      .edge('a', 'merge')
      .edge('b', 'merge')
      .render();

    expect(out.layoutMetrics.nodeCount).toBe(3);
    expect(out.layoutMetrics.edgeCount).toBe(2);
  });
});
