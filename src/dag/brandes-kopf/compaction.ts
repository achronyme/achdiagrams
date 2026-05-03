/**
 * Brandes-Köpf Phase 3 — horizontal compaction (per pass).
 *
 * **Implements the 2020 Erratum, NOT the original 2001 Alg. 3.**
 * The original has two compaction bugs (double-shifting + shift-non-
 * accumulation along class-DAG critical paths). We use Erratum Alg. 3a
 * for block placement (align the WHOLE block, not just the root, inside
 * `place_block`) and the Erratum's Alg. 3b appendix variant for class-
 * shift propagation (build `neighborings[]` adjacency lists, then walk
 * pass-layers top-to-bottom propagating shifts). See
 * `.claude/research/external/brandes-kopf-2001-notes.md` for citations.
 *
 * Pass orientation:
 * - **Top-down (`tl`, `tr`)**: vertical sweep over layers in raw order
 *   0..h-1.
 * - **Bottom-up (`bl`, `br`)**: vertical sweep reversed, h-1..0.
 * - **Left (`*l`)**: horizontal pass-local position = raw idx.
 * - **Right (`*r`)**: horizontal pass-local position = `len - 1 - rawIdx`
 *   (ELK-style geometric mirror).
 *
 * Output: a per-vertex x map. The 4 passes produce 4 such maps; Phase 4
 * combines them via reference-pass selection + 2nd-min/2nd-max average.
 */

import type { Pass } from './alignment.js';

export interface CompactionInput {
  /** Per-layer ordered vertex IDs in raw (canonical) order, top to bottom. */
  readonly layers: ReadonlyArray<ReadonlyArray<string>>;
  /** root[v] from `verticalAlign`. */
  readonly root: ReadonlyMap<string, string>;
  /** align[v] from `verticalAlign`. */
  readonly align: ReadonlyMap<string, string>;
  readonly pass: Pass;
  /** Minimum separation between adjacent vertex centers (uniform δ).
   *  Defaults to 1; consumers passing real layouts will scale to whatever
   *  unit the rest of the layout uses. */
  readonly separation?: number;
}

export interface CompactionOutput {
  /** Per-vertex x-coordinate, in pass-local units. Phase 4 combines these
   *  across the 4 passes. */
  readonly x: ReadonlyMap<string, number>;
}

export function horizontalCompact(input: CompactionInput): CompactionOutput {
  const { layers, root, align, pass } = input;
  const delta = input.separation ?? 1;

  const isTopDown = pass[0] === 't';
  const isLeft = pass[1] === 'l';

  // Pass-local horizontal position. For right-aligned passes, mirror so
  // the algorithm reads each layer in geometrically-reversed order.
  const passPos = new Map<string, number>();
  for (const layer of layers) {
    const len = layer.length;
    layer.forEach((id, idx) => passPos.set(id, isLeft ? idx : len - 1 - idx));
  }

  // Pass-local layer arrays (each layer sorted by passPos ascending) in
  // pass-local vertical order.
  const horizSorted = layers.map((layer) =>
    [...layer].sort((a, b) => (passPos.get(a) ?? 0) - (passPos.get(b) ?? 0)),
  );
  const passLayers = isTopDown ? horizSorted : horizSorted.slice().reverse();

  // Per-vertex pass-local layer index.
  const passLayerOf = new Map<string, number>();
  passLayers.forEach((layer, i) => {
    for (const id of layer) passLayerOf.set(id, i);
  });

  // pred[w] = the vertex immediately to the left of w in pass-local order
  // (within the same layer), or undefined if w is leftmost.
  const pred = new Map<string, string>();
  for (const layer of passLayers) {
    for (let i = 1; i < layer.length; i++) {
      const w = layer[i];
      const p = layer[i - 1];
      if (w !== undefined && p !== undefined) pred.set(w, p);
    }
  }

  // State arrays (Erratum Table 1).
  const sink = new Map<string, string>();
  const shift = new Map<string, number>();
  const x = new Map<string, number>();
  for (const layer of layers) {
    for (const id of layer) {
      sink.set(id, id);
      shift.set(id, Number.POSITIVE_INFINITY);
    }
  }

  /**
   * Erratum Alg. 3a — place an entire block, not just the root.
   *
   * Walks the block via `align[]` (singly-linked cycle starting and
   * ending at v). For each member w with a left predecessor in its
   * pass-local layer, recursively place the predecessor's block, then
   * either merge sinks (if v has no class yet) or push v's x outward
   * by δ to maintain separation within the same class.
   *
   * After the block walk, propagate v's final x and sink to every other
   * member of the block — this is the Erratum's correction over the
   * original Alg. 3 (which only set the root's x and relied on a buggy
   * post-pass for inner members).
   */
  function placeBlock(v: string): void {
    if (x.has(v)) return;
    x.set(v, 0);
    let w = v;
    do {
      const pw = pred.get(w);
      if (pw !== undefined) {
        const u = root.get(pw) ?? pw;
        placeBlock(u);
        if (sink.get(v) === v) sink.set(v, sink.get(u) ?? u);
        if (sink.get(v) === sink.get(u)) {
          x.set(v, Math.max(x.get(v) ?? 0, (x.get(u) ?? 0) + delta));
        }
      }
      w = align.get(w) ?? w;
    } while (w !== v);

    // Align the whole block: walk align[] forward from v, copying v's
    // x and sink to every member. This is the Erratum's Alg. 3a fix.
    while ((align.get(w) ?? w) !== v) {
      w = align.get(w) ?? w;
      x.set(w, x.get(v) ?? 0);
      sink.set(w, sink.get(v) ?? v);
    }
  }

  // Step 1: place every block (root pass — recursion handles the rest).
  for (const layer of layers) {
    for (const id of layer) {
      if (root.get(id) === id) placeBlock(id);
    }
  }

  // Step 2: build class-adjacency lists (Erratum Alg. 3b appendix).
  // For each pair of pass-locally-adjacent vertices in the same layer
  // whose sinks differ, record the pair under the layer index of the
  // higher-class sink. Iteration is right-to-left within each layer, but
  // the order within a neighborings[i] bucket doesn't affect correctness
  // since shifts are accumulated via `min`.
  const neighborings: Array<Array<{ u: string; v: string }>> = passLayers.map(() => []);
  for (const layer of passLayers) {
    for (let j = layer.length - 1; j >= 1; j--) {
      const v = layer[j];
      const u = layer[j - 1];
      if (v === undefined || u === undefined) continue;
      const sv = sink.get(v) ?? v;
      const su = sink.get(u) ?? u;
      if (sv === su) continue;
      const sliceIdx = passLayerOf.get(sv);
      if (sliceIdx === undefined) continue;
      neighborings[sliceIdx]?.push({ u, v });
    }
  }

  // Step 3: propagate shifts top-to-bottom (in pass-local sense).
  for (let i = 0; i < passLayers.length; i++) {
    const layer = passLayers[i];
    if (!layer || layer.length === 0) continue;
    const first = layer[0];
    if (first !== undefined) {
      const sFirst = sink.get(first) ?? first;
      if ((shift.get(sFirst) ?? Number.POSITIVE_INFINITY) === Number.POSITIVE_INFINITY) {
        shift.set(sFirst, 0);
      }
    }
    const adj = neighborings[i] ?? [];
    for (const { u, v } of adj) {
      const su = sink.get(u) ?? u;
      const sv = sink.get(v) ?? v;
      const xu = x.get(u) ?? 0;
      const xv = x.get(v) ?? 0;
      const shiftSv = shift.get(sv) ?? 0;
      const candidate = shiftSv + xv - (xu + delta);
      const cur = shift.get(su) ?? Number.POSITIVE_INFINITY;
      shift.set(su, Math.min(cur, candidate));
    }
  }

  // Step 4: x[v] = relative x + class shift.
  const finalX = new Map<string, number>();
  for (const layer of layers) {
    for (const id of layer) {
      const xv = x.get(id) ?? 0;
      const sv = sink.get(id) ?? id;
      const sh = shift.get(sv) ?? 0;
      const safeShift = Number.isFinite(sh) ? sh : 0;
      finalX.set(id, xv + safeShift);
    }
  }

  return { x: finalX };
}
