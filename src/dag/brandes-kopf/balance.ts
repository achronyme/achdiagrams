/**
 * Brandes-Köpf Phase 4 — balance the 4 per-pass x-coordinate maps.
 *
 * Per the original paper §3.3 + the 2020 Erratum §2 step 3:
 *
 *  1. **Reference selection** — pick the pass with the smallest total
 *     width (max(x) − min(x)).
 *  2. **Shift-to-reference** — translate each non-reference pass so its
 *     extremum matches the reference:
 *     - left-aligned passes (tl, bl) shift so their **min x** matches
 *       ref's min;
 *     - right-aligned passes (tr, br) shift so their **max x** matches
 *       ref's max.
 *  3. **Per-vertex average** — final `x[v]` is the average of the
 *     2nd-min and 2nd-max of the 4 shifted candidates. This is the
 *     "average of the two median coordinates per vertex" the Erratum
 *     prescribes (it discards the outlier on each side, which the pure
 *     mean of 4 candidates would not).
 *
 * Cites archived in `.claude/research/external/brandes-kopf-2001-notes.md`.
 */

import type { Pass } from './alignment.js';

export interface BalanceInput {
  /** Per-pass x-coordinate maps from `horizontalCompact` (phase 3). */
  readonly passes: Readonly<Record<Pass, ReadonlyMap<string, number>>>;
}

export interface BalanceOutput {
  /** Final per-vertex x-coordinate after reference alignment + 2-median averaging. */
  readonly x: ReadonlyMap<string, number>;
  /** Pass selected as reference (smallest width). Useful for diagnostics. */
  readonly referencePass: Pass;
}

const ALL_PASSES: ReadonlyArray<Pass> = ['tl', 'tr', 'bl', 'br'];

export function balance(input: BalanceInput): BalanceOutput {
  const { passes } = input;

  // Collect every vertex that appears in any pass (all 4 should agree, but
  // we union to be defensive against a partial-pass input).
  const allVertices = new Set<string>();
  for (const pass of ALL_PASSES) {
    const m = passes[pass];
    for (const id of m.keys()) allVertices.add(id);
  }

  if (allVertices.size === 0) {
    return { x: new Map(), referencePass: 'tl' };
  }

  // Width per pass = max(x) − min(x) over all vertices in that pass.
  const widthOf = (pass: Pass): { width: number; min: number; max: number } => {
    const m = passes[pass];
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const v of allVertices) {
      const xv = m.get(v) ?? 0;
      if (xv < min) min = xv;
      if (xv > max) max = xv;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      return { width: 0, min: 0, max: 0 };
    }
    return { width: max - min, min, max };
  };

  const widths: Record<Pass, { width: number; min: number; max: number }> = {
    tl: widthOf('tl'),
    tr: widthOf('tr'),
    bl: widthOf('bl'),
    br: widthOf('br'),
  };

  // Reference = pass with smallest width. Tie-break by pass declaration order
  // (tl, tr, bl, br) for determinism.
  let referencePass: Pass = 'tl';
  let refWidth = widths.tl.width;
  for (const pass of ALL_PASSES) {
    if (widths[pass].width < refWidth) {
      refWidth = widths[pass].width;
      referencePass = pass;
    }
  }
  const ref = widths[referencePass];

  // Per-pass delta to align with reference.
  // - left-aligned (tl, bl): match min x to ref's min.
  // - right-aligned (tr, br): match max x to ref's max.
  const deltaOf = (pass: Pass): number => {
    if (pass === referencePass) return 0;
    const w = widths[pass];
    const isLeft = pass[1] === 'l';
    return isLeft ? ref.min - w.min : ref.max - w.max;
  };

  const deltas: Record<Pass, number> = {
    tl: deltaOf('tl'),
    tr: deltaOf('tr'),
    bl: deltaOf('bl'),
    br: deltaOf('br'),
  };

  // Per-vertex final x = average of 2nd-min and 2nd-max of the 4 shifted
  // candidates (Erratum §2 step 3).
  const finalX = new Map<string, number>();
  for (const v of allVertices) {
    const candidates: number[] = [];
    for (const pass of ALL_PASSES) {
      const xv = passes[pass].get(v);
      if (xv !== undefined) candidates.push(xv + deltas[pass]);
    }
    if (candidates.length === 0) {
      finalX.set(v, 0);
      continue;
    }
    if (candidates.length < 4) {
      // Defensive: if a pass omitted v, fall back to mean of what we have.
      finalX.set(v, candidates.reduce((a, b) => a + b, 0) / candidates.length);
      continue;
    }
    candidates.sort((a, b) => a - b);
    // 4 sorted values: indices 0 (min), 1 (2nd-min), 2 (2nd-max), 3 (max).
    const c1 = candidates[1] ?? 0;
    const c2 = candidates[2] ?? 0;
    finalX.set(v, (c1 + c2) / 2);
  }

  return { x: finalX, referencePass };
}
