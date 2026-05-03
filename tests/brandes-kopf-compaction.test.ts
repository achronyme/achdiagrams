import { describe, expect, it } from 'vitest';
import { type Pass, verticalAlign } from '../src/dag/brandes-kopf/alignment.js';
import { horizontalCompact } from '../src/dag/brandes-kopf/compaction.js';

const seg = (from: string, to: string) => ({ from, to });
const noConflicts = new Set<string>();

/** Run alignment + compaction together for a pass. */
function compact(
  layers: ReadonlyArray<ReadonlyArray<string>>,
  segmentEdges: ReadonlyArray<{ from: string; to: string }>,
  pass: Pass,
  separation = 1,
): ReadonlyMap<string, number> {
  const { root, align } = verticalAlign(
    { layers, segmentEdges, type1Conflicts: noConflicts },
    pass,
  );
  const { x } = horizontalCompact({ layers, root, align, pass, separation });
  return x;
}

describe('brandes-kopf horizontal compaction (erratum alg. 3a + 3b appendix)', () => {
  it('empty graph returns an empty x map', () => {
    const x = compact([], [], 'tl');
    expect(x.size).toBe(0);
  });

  it('single isolated vertex sits at x=0', () => {
    const x = compact([['only']], [], 'tl');
    expect(x.get('only')).toBe(0);
  });

  it('single chain (one column): every vertex at x=0', () => {
    const x = compact(
      [['a'], ['b'], ['c'], ['d']],
      [seg('a', 'b'), seg('b', 'c'), seg('c', 'd')],
      'tl',
    );
    expect(x.get('a')).toBe(0);
    expect(x.get('b')).toBe(0);
    expect(x.get('c')).toBe(0);
    expect(x.get('d')).toBe(0);
  });

  it('two parallel chains: leftmost column 0, second column δ', () => {
    // L0: a1, a2     L1: b1, b2     edges a1→b1, a2→b2 (no cross)
    const x = compact(
      [
        ['a1', 'a2'],
        ['b1', 'b2'],
      ],
      [seg('a1', 'b1'), seg('a2', 'b2')],
      'tl',
      10,
    );
    expect(x.get('a1')).toBe(0);
    expect(x.get('b1')).toBe(0);
    expect(x.get('a2')).toBe(10);
    expect(x.get('b2')).toBe(10);
  });

  it('diamond: a-b-d block at x=0; c at x=δ (tl)', () => {
    // Phase 2 produces: block {a, b, d}, singleton {c}.
    // Compaction: a-b-d column at 0; c next to b at δ.
    const x = compact(
      [['a'], ['b', 'c'], ['d']],
      [seg('a', 'b'), seg('a', 'c'), seg('b', 'd'), seg('c', 'd')],
      'tl',
      8,
    );
    expect(x.get('a')).toBe(0);
    expect(x.get('b')).toBe(0);
    expect(x.get('d')).toBe(0);
    expect(x.get('c')).toBe(8);
  });

  it('diamond (tr): right-mirrored — a-c-d block at 0, b at δ', () => {
    const x = compact(
      [['a'], ['b', 'c'], ['d']],
      [seg('a', 'b'), seg('a', 'c'), seg('b', 'd'), seg('c', 'd')],
      'tr',
      8,
    );
    // tr mirrors layer 1 to [c, b]. Phase 2 produces block {a, c, d}, singleton {b}.
    expect(x.get('a')).toBe(0);
    expect(x.get('c')).toBe(0);
    expect(x.get('d')).toBe(0);
    expect(x.get('b')).toBe(8);
  });

  it('long edge with dummy: column collapses to x=0', () => {
    const x = compact([['a'], ['d'], ['z']], [seg('a', 'd'), seg('d', 'z')], 'tl');
    expect(x.get('a')).toBe(0);
    expect(x.get('d')).toBe(0);
    expect(x.get('z')).toBe(0);
  });

  it('bottom-up pass produces same single-column for a chain', () => {
    const x = compact([['a'], ['b'], ['c']], [seg('a', 'b'), seg('b', 'c')], 'bl');
    expect(x.get('a')).toBe(0);
    expect(x.get('b')).toBe(0);
    expect(x.get('c')).toBe(0);
  });

  it('respects separation parameter', () => {
    const x = compact(
      [
        ['a1', 'a2', 'a3'],
        ['b1', 'b2', 'b3'],
      ],
      [seg('a1', 'b1'), seg('a2', 'b2'), seg('a3', 'b3')],
      'tl',
      25,
    );
    // Three parallel chains: x = 0, 25, 50.
    const xs = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => x.get(id) ?? Number.NaN);
    expect(xs[0]).toBe(0);
    expect(xs[1]).toBe(25);
    expect(xs[2]).toBe(50);
    expect(xs[3]).toBe(0);
    expect(xs[4]).toBe(25);
    expect(xs[5]).toBe(50);
  });

  it('non-zero coordinates for vertices in non-leftmost block (tl, 2-block layer)', () => {
    // Diamond produces one block {a,b,d} and a singleton {c}. With δ=4,
    // c lands at x=4 because of the predecessor relation b<c in layer 1.
    // This locks in that the Erratum's whole-block alignment is firing —
    // d (a member of the {a,b,d} block) inherits a's x=0 even though d
    // is not the root.
    const x = compact(
      [['a'], ['b', 'c'], ['d']],
      [seg('a', 'b'), seg('a', 'c'), seg('b', 'd'), seg('c', 'd')],
      'tl',
      4,
    );
    expect(x.get('d')).toBe(0); // d is non-root member of {a,b,d} block
    expect(x.get('c')).toBe(4); // singleton, separated from b by δ
  });

  it('two distinct classes get distinct shifts (not all sharing x=0)', () => {
    // Build a graph where Phase 2 produces two distinct classes:
    // L0: x_root, y_root        (no edges between them; pred link makes y_root predecessor)
    // L1: x_child, y_child
    // Edges: x_root→x_child, y_root→y_child.
    // x_root and y_root pass-local-adjacent in L0; same for L1.
    // With δ=5, x_root at 0; y_root at 5 (predecessor δ).
    // Both pairs in same class via pred-merge.
    // x_child sees pred=x_root (its own root) → same class, x=0.
    // y_child sees pred=y_root (its own root) → same class, x=0 from its block, then class merges with x's via y_root-pred=x_root.
    const x = compact(
      [
        ['x_root', 'y_root'],
        ['x_child', 'y_child'],
      ],
      [seg('x_root', 'x_child'), seg('y_root', 'y_child')],
      'tl',
      5,
    );
    expect(x.get('x_root')).toBe(0);
    expect(x.get('x_child')).toBe(0);
    expect(x.get('y_root')).toBe(5);
    expect(x.get('y_child')).toBe(5);
  });
});
