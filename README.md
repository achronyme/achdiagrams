# Achronyme Diagrams

Programmatic SVG diagram engine for [Achronyme](https://github.com/achronyme/achronyme). Chainable, type-safe builders that produce static SVG at build time — used by the docs site (`achronyme-web`) and the constraint DAG view (`achronyme-inspector`).

Published as `@achronyme/achdiagrams` (private; consumed via `file:../achdiagrams` until first npm release).

---

## Features

- **Type-state builders** — node IDs accumulate in the type parameter; `edge('a', 'b')` only compiles if both `'a'` and `'b'` were declared via `node()`/`stage()`. Zero runtime cost.
- **Compile-time DAG check** — `pipeline()` rejects 2-cycles at the type level (`edge('a','b').edge('b','a')` is a type error).
- **Three diagram kinds today** — `pipeline`, `flowchart`, `dag`. Sequence, state, and architecture are planned (see `SPEC.md` §7).
- **Sugiyama layout** — cycle removal (Eades-Lin-Smyth) → layer assignment → barycenter crossing reduction → Brandes-Köpf coordinate assignment, all in pure TypeScript.
- **SSR-friendly** — `.render()` returns an SVG string with no DOM dependency; safe to call from Astro `.astro` files at build time.
- **Themeable** — every visual property is a CSS variable (`--diagrams-*`); inherits the host site's tokens.
- **No runtime dependencies** — the published package ships with zero `dependencies`.

---

## Quick Look

### Pipeline

```typescript
import { diagram } from '@achronyme/achdiagrams';

const svg = diagram.pipeline()
  .stage('build', { type: 'start' })
  .stage('test')
  .stage('deploy', { type: 'end' })
  .edge('build', 'test')
  .edge('test', 'deploy')
  .render({ theme: 'auto' });
```

### Flowchart

```typescript
const svg = diagram.flowchart()
  .node('a', { label: 'Start', shape: 'terminator' })
  .node('b', { label: 'Check', shape: 'decision' })
  .node('c', { label: 'End',   shape: 'terminator' })
  .edge('a', 'b')
  .edge('b', 'c', { label: 'yes' })
  .edge('b', 'a', { label: 'no' })
  .render();
```

### DAG

```typescript
const svg = diagram.dag()
  .node('a', { label: 'A' })
  .node('b', { label: 'B' })
  .edge('a', 'b')
  .layout({ direction: 'TB' })
  .render();
```

### Embedding in Astro

```astro
---
import { diagram } from '@achronyme/achdiagrams';

const svg = diagram.pipeline()
  .stage('parse').stage('lower').stage('optimize').stage('emit')
  .edge('parse', 'lower')
  .edge('lower', 'optimize')
  .edge('optimize', 'emit')
  .render();
---
<div class="diagram" set:html={svg} />
```

---

## Stack

- **TypeScript 5** — strict mode, type-state builders, branded IDs
- **[tsup](https://tsup.egoist.dev)** — ESM + CJS dual build via `dist/`, per-kind subpath exports (`./pipeline`, `./flowchart`, `./dag`)
- **[Vitest](https://vitest.dev)** — unit + property tests; layout invariants checked with [fast-check](https://fast-check.dev)
- **[Biome](https://biomejs.dev)** — single-binary lint + format
- **No runtime deps** — all layout and SVG generation lives in this repo

---

## Development

```bash
npm install

npm run build          # tsup → dist/{index,pipeline,flowchart,dag}.{js,cjs,d.ts}
npm run dev            # tsup --watch
npm test               # vitest run
npm run test:coverage  # vitest run --coverage (v8)
npm run typecheck      # tsc --noEmit
npm run check          # biome check --write . && tsc --noEmit
npm run bench          # BENCH=1 vitest run tests/perf
```

Requires Node 20+.

A standalone HTML demo is in [`demo/`](./demo/):

```bash
node demo/run.mjs       # writes rendered SVG into demo/index.html
```

---

## Project Structure

```
achdiagrams/
├── src/
│   ├── index.ts                Public entry: diagram factory + re-exports
│   ├── types.ts                DiagramIR, branded IDs, RenderOptions, errors
│   ├── pipeline/
│   │   ├── index.ts            PipelineBuilder (type-state DAG check)
│   │   ├── layout.ts           Sugiyama layer assignment for stages
│   │   └── render.ts           SVG output for stages + dependency edges
│   ├── flowchart/
│   │   ├── index.ts            FlowchartBuilder
│   │   ├── shapes.ts           process / decision / terminator / data shapes
│   │   ├── bezier.ts           Edge routing (cubic + label placement)
│   │   ├── layout.ts           Sugiyama for flowchart
│   │   └── render.ts           SVG output
│   └── dag/
│       ├── index.ts            DAGBuilder
│       ├── shapes.ts           Node geometry (rect/circle/ellipse/diamond/...)
│       ├── brandes-kopf/       Brandes-Köpf coordinate assignment (4 sweeps)
│       ├── layout.ts           Cycle removal + layering + crossing reduction
│       └── render.ts           SVG output
├── tests/
│   ├── smoke.test.ts                       Entry-point sanity
│   ├── pipeline-render.test.ts             Pipeline SVG snapshot + invariants
│   ├── flowchart.test.ts                   Flowchart end-to-end
│   ├── dag.test.ts                         DAG end-to-end
│   ├── bezier.test.ts                      Edge curve math
│   ├── brandes-kopf-{alignment,balance,
│   │     compaction,conflicts}.test.ts     Coordinate-assignment invariants
│   └── perf/                               Benchmark harness (BENCH=1)
├── demo/                       Standalone HTML demo
├── SPEC.md                     Full design spec (API, algorithms, roadmap)
├── tsup.config.ts              Build config (ESM + CJS, per-kind exports)
├── vitest.config.ts
├── biome.json
└── tsconfig.json
```

---

## Status

Implementation tracks the roadmap in [`SPEC.md`](./SPEC.md) §7:

- [x] **Phase 1** — Pipeline + flowchart in pure TS, Sugiyama layout, Astro integration
- [x] **Phase 2 (partial)** — Generic DAG with Brandes-Köpf coordinate assignment
- [ ] **Phase 2 (remaining)** — WASM lazy-loaded layout for N > 5,000, Web Worker offload
- [ ] **Phase 3** — Sequence, state diagrams
- [ ] **Phase 4** — Architecture (compound graphs)

API surface, layout algorithms, semantics per diagram kind, theming tokens, and performance budget are documented in [`SPEC.md`](./SPEC.md).

---

## License

Licensed under the [Apache License, Version 2.0](./LICENSE).

See [`NOTICE`](./NOTICE) for attribution. Unless you explicitly state otherwise,
any contribution intentionally submitted for inclusion in this project shall be
licensed as above, without any additional terms or conditions.
