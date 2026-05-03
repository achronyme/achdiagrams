/**
 * Brandes-Köpf Phase 2 — vertical alignment (4 passes).
 *
 * See `.claude/research/external/brandes-kopf-2001-notes.md` (Algorithm 1,
 * §3.1 of the original paper).
 *
 * Each of 4 passes builds `root[]` and `align[]` maps. A *block* is a
 * maximal chain of vertices joined by `align[]` pointers; all vertices
 * in a block share the same root and will receive the same x-coordinate
 * in horizontal compaction (Phase 3). The 4 passes differ in:
 *
 * - **Vertical orientation**: top-to-bottom (`t*`) walks layers
 *   downward, aligning each vertex with one of its UPPER neighbors.
 *   Bottom-to-top (`b*`) walks upward, aligning with LOWER neighbors.
 * - **Horizontal orientation**: left (`*l`) iterates each layer
 *   left-to-right and prefers the floor median when the neighbor count
 *   is even. Right (`*r`) is the **ELK-style geometric mirror** — the
 *   per-layer ordering is reversed so the algorithm naturally prefers
 *   what was originally the upper-index median.
 *
 * The four passes pull in four cardinal directions; their averaged
 * results in Phase 4 produce a balanced layout.
 *
 * Type 1 conflicts (from `conflicts.ts`) block alignment: when align
 * would create a Type 1 conflict, the alignment is skipped. The long
 * edge keeps its straight inner-segment path; the real short edge is
 * left as a singleton block (it'll bend instead).
 *
 * Mediator tie-break (per paper Algorithm 1): for an even neighbor
 * count, the medians at indices `floor((d-1)/2)` and `ceil((d-1)/2)`
 * are tried in **ascending order**. The `align[v] == v` guard ensures
 * the second iteration is a no-op once the first succeeds.
 */

import { type EdgeKey, edgeKey } from './conflicts.js';

export type Pass = 'tl' | 'tr' | 'bl' | 'br';

export interface AlignmentInput {
  /** Per-layer ordered vertex IDs, top to bottom by index. */
  readonly layers: ReadonlyArray<ReadonlyArray<string>>;
  /** 1-layer-spanning edges in DAG order (`from` is upper-layer, `to` is lower). */
  readonly segmentEdges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  /** Type 1 conflicts from `markType1Conflicts`. Keys are `${from}|${to}` in DAG order. */
  readonly type1Conflicts: ReadonlySet<EdgeKey>;
}

export interface AlignmentOutput {
  /** root[v] = topmost vertex of the block v belongs to. */
  readonly root: ReadonlyMap<string, string>;
  /** align[v] = next vertex in v's block, or root[v] when v is the bottommost. */
  readonly align: ReadonlyMap<string, string>;
}

export function verticalAlign(input: AlignmentInput, pass: Pass): AlignmentOutput {
  const { layers, segmentEdges, type1Conflicts } = input;

  const isTopDown = pass[0] === 't';
  const isLeft = pass[1] === 'l';

  // Pass-local x-position. For left passes this is the raw index; for right
  // passes (ELK mirror) it's `|L| - 1 - rawIdx` so the algorithm reads each
  // layer in geometrically-mirrored order.
  const passPos = new Map<string, number>();
  for (const layer of layers) {
    const len = layer.length;
    layer.forEach((id, idx) => passPos.set(id, isLeft ? idx : len - 1 - idx));
  }

  // Per-vertex adjacency to the previous-vertical layer.
  const upperNeighbors = new Map<string, string[]>();
  const lowerNeighbors = new Map<string, string[]>();
  for (const layer of layers) {
    for (const id of layer) {
      upperNeighbors.set(id, []);
      lowerNeighbors.set(id, []);
    }
  }
  for (const seg of segmentEdges) {
    upperNeighbors.get(seg.to)?.push(seg.from);
    lowerNeighbors.get(seg.from)?.push(seg.to);
  }
  const prevLayerNeighbors = isTopDown ? upperNeighbors : lowerNeighbors;

  // Conflict-key direction: edge keys are stored in DAG order (upper→lower)
  // by `markType1Conflicts`. For top-down passes v is lower and u is upper:
  // key = edgeKey(u, v). For bottom-up v is upper, u is lower: key = edgeKey(v, u).
  const conflictKey = isTopDown
    ? (u: string, v: string): EdgeKey => edgeKey(u, v)
    : (u: string, v: string): EdgeKey => edgeKey(v, u);

  // Initial state: every vertex is its own singleton block.
  const root = new Map<string, string>();
  const align = new Map<string, string>();
  for (const layer of layers) {
    for (const id of layer) {
      root.set(id, id);
      align.set(id, id);
    }
  }

  // Vertical sweep order over layer indices.
  const layerOrder = isTopDown
    ? layers.map((_, i) => i)
    : layers.map((_, i) => layers.length - 1 - i);

  for (const i of layerOrder) {
    const layer = layers[i];
    if (!layer || layer.length === 0) continue;

    // Walk this layer in pass-local order (sorted ascending by passPos).
    const walkOrder = [...layer].sort((a, b) => (passPos.get(a) ?? 0) - (passPos.get(b) ?? 0));

    // r = highest pass-local position aligned in the previous-vertical layer
    // during this layer's iteration. Monotone: prevents alignment edges from
    // crossing each other.
    let r = -1;

    for (const v of walkOrder) {
      const neighbors = prevLayerNeighbors.get(v) ?? [];
      if (neighbors.length === 0) continue;

      const sorted = [...neighbors].sort((a, b) => (passPos.get(a) ?? 0) - (passPos.get(b) ?? 0));
      const d = sorted.length;
      const m1 = Math.floor((d - 1) / 2);
      const m2 = Math.ceil((d - 1) / 2);
      const medians = m1 === m2 ? [m1] : [m1, m2];

      for (const mIdx of medians) {
        if (align.get(v) !== v) break; // already aligned; ascending guard
        const u = sorted[mIdx];
        if (u === undefined) continue;
        const uPos = passPos.get(u) ?? -1;
        if (uPos <= r) continue; // would cross a prior alignment in this layer
        if (type1Conflicts.has(conflictKey(u, v))) continue; // Type 1 blocks

        // Align v with u: extend u's block downward (in the pass's vertical
        // sense) by adding v to the singly-linked block cycle.
        align.set(u, v);
        const ru = root.get(u) ?? u;
        root.set(v, ru);
        align.set(v, ru);
        r = uPos;
      }
    }
  }

  return { root, align };
}
