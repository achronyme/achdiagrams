import { describe, expect, it } from 'vitest';
import {
  type AlignmentInput,
  type Pass,
  verticalAlign,
} from '../src/dag/brandes-kopf/alignment.js';
import { edgeKey } from '../src/dag/brandes-kopf/conflicts.js';

const seg = (from: string, to: string) => ({ from, to });
const noConflicts = new Set<string>();

/** Walk a block from its root via align[] until we cycle back to the root.
 *  Returns the block as the ordered list of member ids. */
function blockMembers(
  root: ReadonlyMap<string, string>,
  align: ReadonlyMap<string, string>,
  start: string,
): string[] {
  const r = root.get(start);
  if (r === undefined) return [start];
  const out: string[] = [r];
  let cur = align.get(r);
  while (cur !== undefined && cur !== r) {
    out.push(cur);
    cur = align.get(cur);
  }
  return out;
}

describe('brandes-kopf vertical alignment (4 passes)', () => {
  it('returns singletons for an empty layered graph', () => {
    const { root, align } = verticalAlign(
      { layers: [], segmentEdges: [], type1Conflicts: noConflicts },
      'tl',
    );
    expect(root.size).toBe(0);
    expect(align.size).toBe(0);
  });

  it('isolated vertex stays a singleton block in all 4 passes', () => {
    const input: AlignmentInput = {
      layers: [['only']],
      segmentEdges: [],
      type1Conflicts: noConflicts,
    };
    for (const pass of ['tl', 'tr', 'bl', 'br'] as Pass[]) {
      const { root, align } = verticalAlign(input, pass);
      expect(root.get('only')).toBe('only');
      expect(align.get('only')).toBe('only');
    }
  });

  it('a single 4-node chain becomes one block in all 4 passes', () => {
    // a → b → c → d (each in its own layer).
    const input: AlignmentInput = {
      layers: [['a'], ['b'], ['c'], ['d']],
      segmentEdges: [seg('a', 'b'), seg('b', 'c'), seg('c', 'd')],
      type1Conflicts: noConflicts,
    };
    for (const pass of ['tl', 'tr', 'bl', 'br'] as Pass[]) {
      const { root, align } = verticalAlign(input, pass);
      // All 4 nodes should share the same root.
      const ra = root.get('a');
      expect(root.get('b')).toBe(ra);
      expect(root.get('c')).toBe(ra);
      expect(root.get('d')).toBe(ra);
      // Block walked from root has all 4 members.
      const block = blockMembers(root, align, 'a');
      expect(block).toHaveLength(4);
      expect(new Set(block)).toEqual(new Set(['a', 'b', 'c', 'd']));
    }
  });

  it('long edge with dummy: real-dummy-real chain is one block', () => {
    // a → d (dummy) → z, all three layers.
    const input: AlignmentInput = {
      layers: [['a'], ['d'], ['z']],
      segmentEdges: [seg('a', 'd'), seg('d', 'z')],
      type1Conflicts: noConflicts,
    };
    const { root, align } = verticalAlign(input, 'tl');
    const ra = root.get('a');
    expect(root.get('d')).toBe(ra);
    expect(root.get('z')).toBe(ra);
    expect(blockMembers(root, align, 'a')).toHaveLength(3);
  });

  it('diamond: a→b, a→c, b→d, c→d (tl) — alignment respects monotonic r', () => {
    // L0: a       (only one node)
    // L1: b, c    (b at 0, c at 1)
    // L2: d
    // tl pass:
    //   L1 walk: b first (left), aligns with a. r=0.
    //   L1 walk: c next (right), tries a (its only upper). a's pos=0, 0 <= r=0, skip.
    //     c stays singleton.
    //   L2: d sees [b at 0, c at 1]. d=2 medians: m1=0 (b), m2=1 (c).
    //     Try b first: align[d]=d still, b.pos=0, r=-1, no conflict → align d with b.
    //     r=0. Then try c: align[d] != d → break.
    //   Block: a-b-d. c is singleton.
    const input: AlignmentInput = {
      layers: [['a'], ['b', 'c'], ['d']],
      segmentEdges: [seg('a', 'b'), seg('a', 'c'), seg('b', 'd'), seg('c', 'd')],
      type1Conflicts: noConflicts,
    };
    const { root, align } = verticalAlign(input, 'tl');
    expect(root.get('a')).toBe('a');
    expect(root.get('b')).toBe('a');
    expect(root.get('d')).toBe('a');
    expect(root.get('c')).toBe('c');
    expect(blockMembers(root, align, 'a')).toEqual(['a', 'b', 'd']);
  });

  it('diamond (tr) — right-aligned mirror picks the OTHER neighbor on tie', () => {
    // Same diamond. tr pass mirrors L1: c (passPos 0), b (passPos 1).
    //   L1 walk in pass-local order: c first, tries a → align c with a. r=0.
    //   b next, tries a, a.pos=0, 0<=r=0, skip. b stays singleton.
    //   L2 walk: d sees [b, c]. passPos: c=0, b=1. Sorted ascending: [c, b].
    //     d=2 medians: m1=0 (c), m2=1 (b). Try c first → align d with c.
    //   Block: a-c-d. b is singleton.
    const input: AlignmentInput = {
      layers: [['a'], ['b', 'c'], ['d']],
      segmentEdges: [seg('a', 'b'), seg('a', 'c'), seg('b', 'd'), seg('c', 'd')],
      type1Conflicts: noConflicts,
    };
    const { root, align } = verticalAlign(input, 'tr');
    expect(root.get('c')).toBe('a');
    expect(root.get('d')).toBe('a');
    expect(root.get('b')).toBe('b');
    expect(blockMembers(root, align, 'a')).toEqual(['a', 'c', 'd']);
  });

  it('Type 1 conflict blocks alignment for the marked edge', () => {
    // Same chain a→b→c. Mark (a, b) as Type 1: b should NOT align with a.
    const input: AlignmentInput = {
      layers: [['a'], ['b'], ['c']],
      segmentEdges: [seg('a', 'b'), seg('b', 'c')],
      type1Conflicts: new Set([edgeKey('a', 'b')]),
    };
    const { root, align } = verticalAlign(input, 'tl');
    expect(root.get('b')).toBe('b'); // singleton because (a,b) was blocked
    expect(root.get('a')).toBe('a');
    // c can still align with b (edge (b, c) not blocked).
    expect(root.get('c')).toBe('b');
    expect(blockMembers(root, align, 'b')).toEqual(['b', 'c']);
    expect(blockMembers(root, align, 'a')).toEqual(['a']);
  });

  it('bottom-up pass (bl) reaches the same single-chain block', () => {
    const input: AlignmentInput = {
      layers: [['a'], ['b'], ['c'], ['d']],
      segmentEdges: [seg('a', 'b'), seg('b', 'c'), seg('c', 'd')],
      type1Conflicts: noConflicts,
    };
    const { root, align } = verticalAlign(input, 'bl');
    // bl walks bottom-up: starts at d, looks at lower neighbors (none),
    // then c looks at lower (d, only one) → aligns. b → c. a → b.
    // Block has root at d (lowest in the iteration order).
    const rd = root.get('d');
    expect(root.get('c')).toBe(rd);
    expect(root.get('b')).toBe(rd);
    expect(root.get('a')).toBe(rd);
    expect(blockMembers(root, align, 'd')).toHaveLength(4);
  });

  it('vertex with three upper neighbors aligns with the middle one (tl)', () => {
    // L0: x, y, z   (real, all three upstream)
    // L1: m         (one downstream that has 3 upper neighbors)
    // tl: 3 medians of [x at 0, y at 1, z at 2]: m1=m2=1 → middle = y.
    const input: AlignmentInput = {
      layers: [['x', 'y', 'z'], ['m']],
      segmentEdges: [seg('x', 'm'), seg('y', 'm'), seg('z', 'm')],
      type1Conflicts: noConflicts,
    };
    const { root, align } = verticalAlign(input, 'tl');
    expect(root.get('m')).toBe('y');
    expect(blockMembers(root, align, 'y')).toEqual(['y', 'm']);
    expect(blockMembers(root, align, 'x')).toEqual(['x']);
    expect(blockMembers(root, align, 'z')).toEqual(['z']);
  });

  it('vertex with even (4) upper neighbors prefers floor median in tl, ceil in tr', () => {
    // L0: w, x, y, z
    // L1: m
    // d=4 → m1=1, m2=2. Floor median index 1 = x; ceil index 2 = y.
    const input: AlignmentInput = {
      layers: [['w', 'x', 'y', 'z'], ['m']],
      segmentEdges: [seg('w', 'm'), seg('x', 'm'), seg('y', 'm'), seg('z', 'm')],
      type1Conflicts: noConflicts,
    };
    const tl = verticalAlign(input, 'tl');
    expect(tl.root.get('m')).toBe('x'); // floor median = lower-index in raw
    const tr = verticalAlign(input, 'tr');
    // tr mirrors: passPos in L0 is z=0, y=1, x=2, w=3. Sorted ascending: [z, y, x, w].
    // m1=1 → y. So tr should pick y.
    expect(tr.root.get('m')).toBe('y');
  });

  it('parallel chains do not interfere via the r monotone constraint', () => {
    // Two independent chains side by side.
    // L0: a1, a2
    // L1: b1, b2
    // L2: c1, c2
    // Edges: a1→b1, a2→b2, b1→c1, b2→c2.
    // tl: L1 walk b1 (pos 0): aligns with a1 (pos 0). r=0.
    //     b2 (pos 1): aligns with a2 (pos 1). 1>r=0 ok. r=1.
    //     L2 walk c1 (pos 0): aligns with b1 (pos 0). r=0.
    //     c2 (pos 1): aligns with b2 (pos 1). r=1.
    // Two blocks of 3 each: a1-b1-c1 and a2-b2-c2.
    const input: AlignmentInput = {
      layers: [
        ['a1', 'a2'],
        ['b1', 'b2'],
        ['c1', 'c2'],
      ],
      segmentEdges: [seg('a1', 'b1'), seg('a2', 'b2'), seg('b1', 'c1'), seg('b2', 'c2')],
      type1Conflicts: noConflicts,
    };
    const { root, align } = verticalAlign(input, 'tl');
    expect(root.get('a1')).toBe('a1');
    expect(root.get('b1')).toBe('a1');
    expect(root.get('c1')).toBe('a1');
    expect(root.get('a2')).toBe('a2');
    expect(root.get('b2')).toBe('a2');
    expect(root.get('c2')).toBe('a2');
    expect(blockMembers(root, align, 'a1')).toHaveLength(3);
    expect(blockMembers(root, align, 'a2')).toHaveLength(3);
  });
});
