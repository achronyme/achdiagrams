/**
 * Brandes-Köpf Phase 1 — Type 1 conflict marking.
 *
 * See `.claude/research/external/brandes-kopf-2001-notes.md` (Algorithm 2,
 * §3.1 of the original paper).
 *
 * **Definitions** (paper terminology, not local jargon):
 * - *Inner segment*: a 1-layer edge (u, v) where BOTH u and v are dummies
 *   (i.e., interior of a long edge that's been broken up by dummy-node
 *   insertion).
 * - *Outer segment*: a 1-layer edge with at least one real (non-dummy)
 *   endpoint.
 * - *Type 1 conflict*: a crossing between an inner and an outer segment.
 *   We mark these so vertical alignment refuses the alignment that would
 *   propagate them — the long edge keeps its straight path; the real
 *   short edge bends instead.
 * - *Type 2 conflict*: a crossing between two inner segments. The paper
 *   suggests minimizing these in crossing reduction; we don't try to
 *   resolve them here (the barycenter sweep already handles this for the
 *   graph sizes the SPEC targets).
 *
 * The algorithm sweeps adjacent layer pairs once each, so the cost is
 * O(V + E_segments). Linear; safe to call per render.
 */

export interface Type1ConflictsInput {
  /** Per-layer ordered vertex IDs (real + dummies), in DAG order top-to-bottom.
   *  Index `i` = layer i. Position within sub-array = order within layer. */
  readonly layers: ReadonlyArray<ReadonlyArray<string>>;
  /** Set of dummy vertex IDs (long-edge bend nodes). */
  readonly dummyIds: ReadonlySet<string>;
  /** All 1-layer-spanning edges between adjacent layers, in DAG order
   *  (lower-layer node first via the `from` field). The same shape produced
   *  by `insertDummyNodes()` in `dag/layout.ts`. */
  readonly segmentEdges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

export type EdgeKey = string;

export function edgeKey(from: string, to: string): EdgeKey {
  return `${from}|${to}`;
}

export interface Type1ConflictsOutput {
  /** Edge keys (`${from}|${to}`) of segments to mark Type 1. */
  readonly marks: ReadonlySet<EdgeKey>;
}

/**
 * Mark Type 1 conflicts via a single adjacent-layer-pair sweep.
 *
 * For each pair (L_i, L_{i+1}):
 *   k0 ← 0
 *   l  ← 0
 *   for l1 ← 0..|L_{i+1}|-1:
 *     if l1 is the last index OR vertex L_{i+1}[l1] is incident to an
 *       inner segment from above:
 *       k1 ← position-in-L_i of the inner partner if any, else |L_i|-1
 *       while l ≤ l1:
 *         for each upper-layer neighbor u of L_{i+1}[l]:
 *           k = position(u) in L_i
 *           if k < k0 OR k > k1:
 *             mark (u, L_{i+1}[l]) as Type 1
 *         l ← l + 1
 *       k0 ← k1
 *
 * The brackets [k0, k1] partition each upper layer into ranges where
 * outer-segment endpoints are allowed. An outer segment with its upper
 * endpoint outside the active range crosses the bracketing inner
 * segment(s) and is marked Type 1.
 *
 * One subtlety: an inner segment incident-to L_{i+1}[l1] also contributes
 * its own (u, v) pair to the iteration — that pair will pass the `k < k0
 * || k > k1` test only if it crosses an OTHER inner segment, in which
 * case it would be a Type 2 conflict, not Type 1. The standard
 * implementation (this one) lets both inner-inner pairs slip through and
 * skip marking; downstream alignment treats unmarked edges normally.
 */
export function markType1Conflicts(input: Type1ConflictsInput): Type1ConflictsOutput {
  const { layers, dummyIds, segmentEdges } = input;
  const marks = new Set<EdgeKey>();

  if (layers.length < 2) return { marks };

  // Per-vertex position within its layer.
  const positionInLayer = new Map<string, number>();
  for (const layer of layers) {
    layer.forEach((id, idx) => positionInLayer.set(id, idx));
  }

  // Per-vertex upper neighbors (the `from` ends of segmentEdges that land here).
  const upperNeighbors = new Map<string, string[]>();
  for (const layer of layers) {
    for (const id of layer) upperNeighbors.set(id, []);
  }
  for (const seg of segmentEdges) {
    const list = upperNeighbors.get(seg.to);
    if (list !== undefined) list.push(seg.from);
  }

  const isInnerSegment = (u: string, v: string): boolean => dummyIds.has(u) && dummyIds.has(v);

  // For each lower-layer vertex, find an inner-segment partner (if any) in
  // the layer above.
  const innerPartner = (lowerVertex: string): string | undefined => {
    const ups = upperNeighbors.get(lowerVertex);
    if (ups === undefined) return undefined;
    for (const u of ups) {
      if (isInnerSegment(u, lowerVertex)) return u;
    }
    return undefined;
  };

  for (let i = 0; i < layers.length - 1; i++) {
    const upper = layers[i];
    const lower = layers[i + 1];
    if (upper === undefined || lower === undefined) continue;
    if (lower.length === 0) continue;

    let k0 = 0;
    let l = 0;
    const upperLast = upper.length - 1;

    for (let l1 = 0; l1 < lower.length; l1++) {
      const lowerVertex = lower[l1];
      if (lowerVertex === undefined) continue;
      const isLast = l1 === lower.length - 1;
      const partner = innerPartner(lowerVertex);
      const hasInnerHere = partner !== undefined;

      if (!isLast && !hasInnerHere) continue;

      const k1 = hasInnerHere ? (positionInLayer.get(partner) ?? upperLast) : upperLast;

      while (l <= l1) {
        const cursor = lower[l];
        if (cursor === undefined) {
          l++;
          continue;
        }
        const ups = upperNeighbors.get(cursor) ?? [];
        for (const u of ups) {
          const k = positionInLayer.get(u);
          if (k === undefined) continue;
          if (k < k0 || k > k1) {
            // Skip marking when BOTH endpoints are dummies — that's a
            // Type 2 inner-inner crossing, not Type 1. Type 2 handling
            // is left to crossing reduction by design.
            if (!isInnerSegment(u, cursor)) {
              marks.add(edgeKey(u, cursor));
            }
          }
        }
        l++;
      }
      k0 = k1;
    }
  }

  return { marks };
}
