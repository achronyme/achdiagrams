/**
 * Phase 6 — DAG layout scale benchmark.
 *
 * Goal: measure layout time for `lerp` vs `brandes-kopf` coordinate
 * assignment across synthetic DAGs at four scales (1k → 200k nodes).
 *
 * Gate condition (per `.claude/plans/brandes-kopf-implementation.md` §6):
 * if O(N) holds AND total time < 500 ms for 200k nodes, B-K becomes the
 * default for `dag()`. Otherwise: stay opt-in and document the envelope.
 *
 * Skipped by default — set BENCH=1 to run:
 *   pnpm bench
 *
 * Bypasses the public builder (which is O(N²) for large IRs due to
 * immutable spreads on every `.node()` / `.edge()` call) and constructs
 * the IR directly, then calls `layoutDAG`. SVG generation is excluded —
 * the gate is about layout, not serialization.
 */

import { describe, it } from 'vitest';
import { layoutDAG } from '../../src/dag/layout.js';
import type { DAGDiagram, DAGEdge, DAGNode } from '../../src/types.js';

// Mulberry32 — seeded so results are reproducible across runs.
function mulberry32(a: number): () => number {
  let t = a >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

interface TopologyOpts {
  layers: number;
  widthPerLayer: number;
  fanIn: number;
  /** Fraction of fan-in edges sourced from layer (l-2..l-8) instead of (l-1).
   *  0 means strictly-previous-layer edges; 0.3 means ~30% are long. */
  longEdgeRatio?: number;
  seed?: number;
}

/**
 * Layered-DAG generator. Every non-source node receives exactly `fanIn`
 * predecessor edges (sampled with replacement from the chosen source
 * layer + dedup) — guaranteeing no orphan nodes, so the longest-path
 * layering produced by `layoutDAG` matches the ID-layer naming.
 *
 * The earlier fan-out generator created orphans whenever a random pick
 * missed a target node, which compressed downstream layers and produced
 * artificially long real edges. Inspector / SSA workloads don't have
 * that structure: every value has at least one operand, so every layer
 * is reached on the longest path. fan-in modeling matches that.
 */
function makeLayeredIr(opts: TopologyOpts): DAGDiagram {
  const { layers, widthPerLayer, fanIn, longEdgeRatio = 0, seed = 12345 } = opts;
  const rng = mulberry32(seed);

  const nodes: DAGNode[] = [];
  for (let l = 0; l < layers; l++) {
    for (let i = 0; i < widthPerLayer; i++) {
      nodes.push({ id: `L${l}_${i}`, shape: 'rect' });
    }
  }

  const edges: DAGEdge[] = [];
  const seenPairs = new Set<string>();
  for (let l = 1; l < layers; l++) {
    for (let j = 0; j < widthPerLayer; j++) {
      for (let k = 0; k < fanIn; k++) {
        // Source layer: l-1 by default; longer (l-2..l-8) for the long-edge fraction.
        let sourceLayer = l - 1;
        if (longEdgeRatio > 0 && rng() < longEdgeRatio) {
          const span = 2 + Math.floor(rng() * 7); // 2..8
          sourceLayer = Math.max(0, l - span);
        }
        const i = Math.floor(rng() * widthPerLayer);
        const from = `L${sourceLayer}_${i}`;
        const to = `L${l}_${j}`;
        const key = `${from}|${to}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        edges.push({ from, to, directed: true, style: 'solid' });
      }
    }
  }
  return { kind: 'dag', nodes, edges };
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

function measureMs(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

interface RunStats {
  layoutMs: number;
  positionedNodeCount: number;
  positionedEdgeCount: number;
  maxSegmentsPerEdge: number;
  avgSegmentsPerEdge: number;
  boundsW: number;
  boundsH: number;
}

function runOnce(ir: DAGDiagram, mode: 'lerp' | 'brandes-kopf'): RunStats {
  const opts = mode === 'brandes-kopf' ? { coordinateAssignment: 'brandes-kopf' as const } : {};
  let result: ReturnType<typeof layoutDAG> | undefined;
  const layoutMs = measureMs(() => {
    result = layoutDAG(ir, opts);
  });
  if (!result) throw new Error('layoutDAG returned undefined');
  let maxSegs = 0;
  let sumSegs = 0;
  for (const e of result.edges) {
    const n = e.segments.length;
    if (n > maxSegs) maxSegs = n;
    sumSegs += n;
  }
  return {
    layoutMs,
    positionedNodeCount: result.nodes.length,
    positionedEdgeCount: result.edges.length,
    maxSegmentsPerEdge: maxSegs,
    avgSegmentsPerEdge: result.edges.length > 0 ? sumSegs / result.edges.length : 0,
    boundsW: result.bounds.maxX - result.bounds.minX,
    boundsH: result.bounds.maxY - result.bounds.minY,
  };
}

interface BenchRow {
  topology: string;
  layers: number;
  widthPerLayer: number;
  N: number;
  E: number;
  lerpMedianMs: number;
  bkMedianMs: number;
  bkSlowdown: number;
  lerpMaxBends: number;
  bkMaxBends: number;
  lerpAvgBends: number;
  bkAvgBends: number;
}

// `process` is provided by node at runtime; we don't pull in @types/node
// just for this gating flag.
declare const process: { env: Record<string, string | undefined> };
const BENCH = process.env.BENCH === '1';

describe.skipIf(!BENCH)('DAG layout scale benchmark (Phase 6)', () => {
  it('measures lerp vs brandes-kopf across topologies + sizes', () => {
    const sizes = [
      { name: '1k', layers: 50, widthPerLayer: 20 }, // 1,000 nodes
      { name: '5k', layers: 100, widthPerLayer: 50 }, // 5,000 nodes
      { name: '20k', layers: 200, widthPerLayer: 100 }, // 20,000 nodes
      { name: '50k', layers: 250, widthPerLayer: 200 }, // 50,000 nodes
    ];

    const topologies = [
      { name: 'dense (fanIn=3, no long edges)', fanIn: 3, longEdgeRatio: 0 },
      { name: 'long-edge stress (fanIn=3, 10% long)', fanIn: 3, longEdgeRatio: 0.1 },
    ];

    const rows: BenchRow[] = [];
    const RUNS_PER_MEASURE = 3;

    for (const sz of sizes) {
      for (const topo of topologies) {
        const ir = makeLayeredIr({
          layers: sz.layers,
          widthPerLayer: sz.widthPerLayer,
          fanIn: topo.fanIn,
          longEdgeRatio: topo.longEdgeRatio,
        });
        const N = ir.nodes.length;
        const E = ir.edges.length;
        // eslint-disable-next-line no-console
        console.log(`\n[${sz.name} / ${topo.name}] N=${N} E=${E}`);

        // Warm-up — JIT + Map allocator.
        runOnce(ir, 'lerp');
        runOnce(ir, 'brandes-kopf');

        const lerpRuns: RunStats[] = [];
        const bkRuns: RunStats[] = [];
        for (let r = 0; r < RUNS_PER_MEASURE; r++) {
          lerpRuns.push(runOnce(ir, 'lerp'));
          bkRuns.push(runOnce(ir, 'brandes-kopf'));
        }
        const lerpMs = median(lerpRuns.map((s) => s.layoutMs));
        const bkMs = median(bkRuns.map((s) => s.layoutMs));
        const lerpRef = lerpRuns[0];
        const bkRef = bkRuns[0];
        if (!lerpRef || !bkRef) throw new Error('no runs recorded');

        // eslint-disable-next-line no-console
        console.log(
          `  lerp:           ${lerpMs.toFixed(1).padStart(8)} ms  | maxBends=${lerpRef.maxSegmentsPerEdge.toString().padStart(3)} avgBends=${lerpRef.avgSegmentsPerEdge.toFixed(2).padStart(5)} | bounds=${Math.round(lerpRef.boundsW)}×${Math.round(lerpRef.boundsH)}`,
        );
        // eslint-disable-next-line no-console
        console.log(
          `  brandes-kopf:   ${bkMs.toFixed(1).padStart(8)} ms  | maxBends=${bkRef.maxSegmentsPerEdge.toString().padStart(3)} avgBends=${bkRef.avgSegmentsPerEdge.toFixed(2).padStart(5)} | bounds=${Math.round(bkRef.boundsW)}×${Math.round(bkRef.boundsH)}`,
        );
        // eslint-disable-next-line no-console
        console.log(`  bk slowdown:    ${(bkMs / lerpMs).toFixed(2)}x`);

        rows.push({
          topology: topo.name,
          layers: sz.layers,
          widthPerLayer: sz.widthPerLayer,
          N,
          E,
          lerpMedianMs: lerpMs,
          bkMedianMs: bkMs,
          bkSlowdown: bkMs / lerpMs,
          lerpMaxBends: lerpRef.maxSegmentsPerEdge,
          bkMaxBends: bkRef.maxSegmentsPerEdge,
          lerpAvgBends: lerpRef.avgSegmentsPerEdge,
          bkAvgBends: bkRef.avgSegmentsPerEdge,
        });
      }
    }

    // Aggregate report (parsed by hand into the markdown report).
    // eslint-disable-next-line no-console
    console.log('\n\n=== SUMMARY (csv) ===');
    // eslint-disable-next-line no-console
    console.log(
      'topology,layers,widthPerLayer,N,E,lerpMs,bkMs,slowdown,lerpMaxBends,bkMaxBends,lerpAvgBends,bkAvgBends',
    );
    for (const r of rows) {
      // eslint-disable-next-line no-console
      console.log(
        `${r.topology},${r.layers},${r.widthPerLayer},${r.N},${r.E},${r.lerpMedianMs.toFixed(1)},${r.bkMedianMs.toFixed(1)},${r.bkSlowdown.toFixed(2)},${r.lerpMaxBends},${r.bkMaxBends},${r.lerpAvgBends.toFixed(2)},${r.bkAvgBends.toFixed(2)}`,
      );
    }

    // Linearity check: layout time / N should be roughly stable across sizes.
    // We don't assert; we just print so it's visible.
    // eslint-disable-next-line no-console
    console.log('\n=== ns/node (lerp / bk) ===');
    for (const r of rows) {
      const lerpPerNode = (r.lerpMedianMs * 1e6) / r.N;
      const bkPerNode = (r.bkMedianMs * 1e6) / r.N;
      // eslint-disable-next-line no-console
      console.log(
        `  ${r.topology.padEnd(40)} N=${r.N.toString().padStart(7)}  lerp=${lerpPerNode.toFixed(0).padStart(6)} ns/n  bk=${bkPerNode.toFixed(0).padStart(6)} ns/n`,
      );
    }
  }, 600_000); // 10 min timeout
});
