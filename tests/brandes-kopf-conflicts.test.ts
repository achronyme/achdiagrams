import { describe, expect, it } from 'vitest';
import { edgeKey, markType1Conflicts } from '../src/dag/brandes-kopf/conflicts.js';

const dummies = (...ids: string[]): Set<string> => new Set(ids);
const seg = (from: string, to: string) => ({ from, to });

describe('brandes-kopf type 1 conflict marking', () => {
  it('returns empty marks for an empty layered graph', () => {
    const { marks } = markType1Conflicts({
      layers: [],
      dummyIds: dummies(),
      segmentEdges: [],
    });
    expect(marks.size).toBe(0);
  });

  it('returns empty marks for a single layer (no adjacent pairs)', () => {
    const { marks } = markType1Conflicts({
      layers: [['a', 'b', 'c']],
      dummyIds: dummies(),
      segmentEdges: [],
    });
    expect(marks.size).toBe(0);
  });

  it('returns empty marks when no edges cross', () => {
    // a — b
    // |   |
    // c   d
    const { marks } = markType1Conflicts({
      layers: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      dummyIds: dummies(),
      segmentEdges: [seg('a', 'c'), seg('b', 'd')],
    });
    expect(marks.size).toBe(0);
  });

  it('does NOT mark a real-real X crossing (Type 0)', () => {
    // a   b
    //  \ /
    //   X
    //  / \
    // d   c    (lower layer: c then d)
    // Edges: a→c (left to right), b→d (right to left): cross. Both real.
    const { marks } = markType1Conflicts({
      layers: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      dummyIds: dummies(), // no dummies, no inner segments
      segmentEdges: [seg('a', 'd'), seg('b', 'c')],
    });
    // Per spec: Type 0 (real-real) crossings are NOT Type 1, NOT marked.
    expect(marks.size).toBe(0);
  });

  it('marks a real-real outer segment crossing an inner segment (Type 1)', () => {
    // Three layers, long edge from `top → bottom` broken by dummy `d_mid`.
    // Real edge `a → e` crosses the inner-tail (d_mid → bot).
    //
    // L0: a, top
    // L1: d_mid (dummy), e         pos: d_mid=0, e=1
    // L2: bot                      pos: bot=0
    //
    // Inner segments are between adjacent layers. The dummy's incoming
    // segment (top → d_mid) lives between L0 and L1; its outgoing
    // (d_mid → bot) is between L1 and L2 — but only outgoing makes both
    // endpoints dummies if `bot` were a dummy. So extend with another
    // dummy below `bot` to actually have an inner segment.
    //
    // Setup with two dummies:
    // L0: a, top
    // L1: d1, e
    // L2: d2, f       (d2 below d1, f real)
    // Inner segment: (d1, d2) — both dummies.
    // Outer segment between L1 and L2: (e, ?) — say (e, d2), or (e, f).
    // For a real-vs-inner crossing, place real edge `e → d2'` where d2'
    // is in a position that crosses (d1 → d2).
    //
    // Concretely:
    // L1 order: [d1=0, e=1]
    // L2 order: [d2=0, f=1]
    // segmentEdges between L1↔L2: (d1, d2) inner, plus (e, f) outer.
    // No crossing here. Now flip L2 order to [f=0, d2=1]:
    // (d1=0 → d2=1) is inner; (e=1 → f=0) is outer. They cross.
    const { marks } = markType1Conflicts({
      layers: [
        ['a', 'top'],
        ['d1', 'e'],
        ['f', 'd2'],
      ],
      dummyIds: dummies('d1', 'd2'),
      segmentEdges: [
        seg('a', 'd1'),
        seg('top', 'e'),
        seg('d1', 'd2'), // inner
        seg('e', 'f'), // outer crosses inner
      ],
    });
    expect(marks.has(edgeKey('e', 'f'))).toBe(true);
    // Inner edge itself isn't marked Type 1.
    expect(marks.has(edgeKey('d1', 'd2'))).toBe(false);
    expect(marks.size).toBe(1);
  });

  it('does NOT mark inner-inner crossings (Type 2 left to crossing reduction)', () => {
    // L0: x, y
    // L1: d1, d2
    // L2: d3, d4    swap order so (d1, d4) crosses (d2, d3)
    // Both crossings have all four endpoints as dummies → Type 2.
    const { marks } = markType1Conflicts({
      layers: [
        ['x', 'y'],
        ['d1', 'd2'],
        ['d4', 'd3'],
      ],
      dummyIds: dummies('d1', 'd2', 'd3', 'd4'),
      segmentEdges: [seg('x', 'd1'), seg('y', 'd2'), seg('d1', 'd4'), seg('d2', 'd3')],
    });
    expect(marks.size).toBe(0);
  });

  it('marks multiple Type 1 conflicts in one layer pair', () => {
    // L0: t1, t2, t3      (all real, all upstream)
    // L1: d1, d2, d3      (all dummies)
    // L2: r1, r2, d_target   (mix)
    //
    // Inner segments between L1 and L2 require both endpoints dummy.
    // Set up with d1 → d_target as the only inner segment, and outer
    // segments (d2 → r1) and (d3 → r2) crossing it.
    //
    // Position L1: [d1=0, d2=1, d3=2]
    // Position L2: [r1=0, r2=1, d_target=2]
    // Segments L1→L2: (d1, d_target) — inner; (d2, r1), (d3, r2) outer.
    // Inner segment endpoints span [0..2] in upper layer.
    // For d2: upper k=1, in [0..2] → no conflict. For d3: k=2 → no conflict.
    // Hmm — these don't cross. Let me re-shape.
    //
    // Re-setup so two outers cross the inner.
    // L1 order: [d2, d1, d3]   pos: d2=0, d1=1, d3=2
    // L2 order: [r1, d_target, r2]
    // Inner: (d1, d_target). Position(d1)=1; lower l1 of d_target = 1.
    // Bracket [k0=0, k1=1] for the iteration up to l=1.
    // d2's outer endpoint upper position = 0; goes to (d2 → r1)? Let's
    // say (d2, r1): upper k=0, in [0..1]. No conflict.
    // d3's outer (d3 → r2): upper k=2, NOT in [0..1] → conflict.
    // Then bracket [k0=1, k1=upperLast=2] for l1 of remaining.
    // Re-iteration covers d2-r2 if (d2, r2)? Not in segments.
    //
    // Simpler: two outers each crossing the inner from opposite sides.
    // L1: [a_l, d_in, a_r]   real-dummy-real
    // L2: [r_l, d_out, r_r]
    // Inner: (d_in, d_out) at upper pos 1, lower pos 1.
    // Outer 1: (a_l, r_r)  — upper 0, lower 2: passes 0<k0?  No, a_l upper=0.
    //   For lower iteration up to l1=1 (when we hit d_out incident):
    //     bracket k0=0, k1=1. r_l (lower 0) preds: a_l (k=0). 0 in [0,1] → ok.
    //     d_out (lower 1) preds: d_in (k=1). 1 in [0,1] → ok.
    //   Then bracket k0=1, k1=2 for the remaining.
    //     r_r (lower 2) preds: a_l (k=0). 0 < k0=1 → MARK (a_l, r_r).
    //   Also need a second outer that crosses. Add: (a_r, r_l):
    //     r_l preds also: a_r (k=2). At first sweep, k=2 NOT in [0,1] → MARK (a_r, r_l).
    const { marks } = markType1Conflicts({
      layers: [
        ['a_l', 'd_in', 'a_r'],
        ['r_l', 'd_out', 'r_r'],
      ],
      dummyIds: dummies('d_in', 'd_out'),
      segmentEdges: [seg('a_l', 'r_r'), seg('d_in', 'd_out'), seg('a_r', 'r_l')],
    });
    expect(marks.has(edgeKey('a_l', 'r_r'))).toBe(true);
    expect(marks.has(edgeKey('a_r', 'r_l'))).toBe(true);
    expect(marks.has(edgeKey('d_in', 'd_out'))).toBe(false);
    expect(marks.size).toBe(2);
  });

  it('handles a layer pair with no segments between them', () => {
    // Two layers with vertices but no connecting edges (disconnected
    // sub-DAGs share layer indices).
    const { marks } = markType1Conflicts({
      layers: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      dummyIds: dummies(),
      segmentEdges: [],
    });
    expect(marks.size).toBe(0);
  });

  it('does not mark inner segment partner itself', () => {
    // Single inner segment, no other edges. Must not mark itself.
    const { marks } = markType1Conflicts({
      layers: [['real_top'], ['d1'], ['d2'], ['real_bot']],
      dummyIds: dummies('d1', 'd2'),
      segmentEdges: [seg('real_top', 'd1'), seg('d1', 'd2'), seg('d2', 'real_bot')],
    });
    expect(marks.size).toBe(0);
  });

  it('handles inner segment incident to FIRST lower-layer vertex (l1=0)', () => {
    // Bracket-walk edge case: the first lower-layer vertex is itself an
    // inner-segment endpoint, so k0=0 and k1 are set immediately on the
    // first iteration before any sweep has run.
    //
    // L0: [a, d_in, b]    pos: a=0, d_in=1, b=2
    // L1: [d_out, e]      pos: d_out=0, e=1
    // Inner: (d_in, d_out)        — upper k=1, lower l1=0 (FIRST).
    // Outer (a, e): upper k=0, lower 1.
    // Outer (b, e): upper k=2, lower 1.
    //
    // First iteration l1=0 (d_out): inner partner found (d_in, k=1).
    //   k1 = 1; sweep l=0..0: d_out preds = [d_in], k=1 in [0,1] → ok.
    //   k0 = 1.
    // Iteration l1=1 (e, last index): no inner partner; k1 = upperLast = 2.
    //   sweep l=1..1: e preds = [a (k=0), b (k=2)].
    //     a (k=0) < k0=1 → MARK (a, e).
    //     b (k=2) in [1, 2] → ok.
    const { marks } = markType1Conflicts({
      layers: [
        ['a', 'd_in', 'b'],
        ['d_out', 'e'],
      ],
      dummyIds: dummies('d_in', 'd_out'),
      segmentEdges: [seg('d_in', 'd_out'), seg('a', 'e'), seg('b', 'e')],
    });
    expect(marks.has(edgeKey('a', 'e'))).toBe(true);
    expect(marks.has(edgeKey('b', 'e'))).toBe(false);
    expect(marks.size).toBe(1);
  });

  it('rolls k0/k1 between two inner segments in the same layer pair', () => {
    // Two inner segments split the upper layer into three brackets.
    // Outer edges that cross either inner must be marked.
    //
    // L0: [a, d_inA, b, d_inB, c]      pos: a=0, d_inA=1, b=2, d_inB=3, c=4
    // L1: [d_outA, p, d_outB, q]       pos: d_outA=0, p=1, d_outB=2, q=3
    // Inner #1: (d_inA, d_outA)       upper k=1, lower l1=0.
    // Inner #2: (d_inB, d_outB)       upper k=3, lower l1=2.
    // Outers:
    //   (b, p): upper 2, lower 1. Active bracket while l=1: [k0=1, k1=3] → in.
    //   (c, p): upper 4, lower 1. 4 > k1=3 → MARK.
    //   (a, q): upper 0, lower 3. Active bracket while l=3: [k0=3, k1=4 (last)]. 0<3 → MARK.
    //   (b, q): upper 2, lower 3. 2<3 → MARK.
    //
    // l=0 (d_outA): inner partner d_inA found, k1=1, sweep l=0: d_outA preds [d_inA k=1] in [0,1]. k0=1.
    // l=1 (p): no partner, not last → continue.
    // l=2 (d_outB): inner partner d_inB found, k1=3, sweep l=1..2:
    //   p preds (b k=2, c k=4): 2 in [1,3] ok; 4 > 3 → MARK (c, p).
    //   d_outB preds (d_inB k=3): 3 in [1,3] ok.  k0=3.
    // l=3 (q): last, no partner, k1=upperLast=4, sweep l=3..3:
    //   q preds (a k=0, b k=2): 0<3 → MARK (a, q); 2<3 → MARK (b, q).
    const { marks } = markType1Conflicts({
      layers: [
        ['a', 'd_inA', 'b', 'd_inB', 'c'],
        ['d_outA', 'p', 'd_outB', 'q'],
      ],
      dummyIds: dummies('d_inA', 'd_outA', 'd_inB', 'd_outB'),
      segmentEdges: [
        seg('d_inA', 'd_outA'),
        seg('d_inB', 'd_outB'),
        seg('b', 'p'),
        seg('c', 'p'),
        seg('a', 'q'),
        seg('b', 'q'),
      ],
    });
    expect(marks.has(edgeKey('c', 'p'))).toBe(true);
    expect(marks.has(edgeKey('a', 'q'))).toBe(true);
    expect(marks.has(edgeKey('b', 'q'))).toBe(true);
    expect(marks.has(edgeKey('b', 'p'))).toBe(false);
    expect(marks.size).toBe(3);
  });
});
