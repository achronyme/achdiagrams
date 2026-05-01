# `@achronyme/diagrams` — SPEC de implementación

> **Estado:** investigación completada. No empezar a programar hasta que este documento sea aprobado.  
> **Fecha:** 2026-05-01  
> **Alcance:** Librería TypeScript de generación programática de diagramas SVG. Seis tipos nativos: flowchart, pipeline, sequence, state, architecture, DAG.

---

## 1. API Surface (TypeScript)

### 1.1 Filosofía

- **Type-state over classes:** cada método de la cadena retorna un nuevo tipo que acumula invariantes (nodos declarados, aristas existentes). Cero costo en runtime.
- **Fail fast en compile-time; runtime como safety net:** si el compilador puede prohibirlo, lo prohíbe. Validaciones semánticas globales se delegan a `.build()`.
- **Serialización explícita:** `build()` produce `DiagramIR`, un JSON plano que puede cruzar Workers, Astro SSR y el inspector.
- **Inmutabilidad:** ningún builder muta su estado interno.

### 1.2 Branded IDs (zero runtime cost)

```typescript
declare const __nodeId: unique symbol;
export type NodeId     = string & { readonly [__nodeId]: 'NodeId' };
export type EdgeId     = string & { readonly [__edgeId]: 'EdgeId' };
export type LifelineId = string & { readonly [__lifelineId]: 'LifelineId' };
export type StateId    = string & { readonly [__stateId]: 'StateId' };
export type PseudoId   = string & { readonly [__pseudoId]: 'PseudoId' };
export type RegionId   = string & { readonly [__regionId]: 'RegionId' };

export type CompileError<M extends string> = M & { readonly __compileError: unique symbol };
```

### 1.3 DiagramIR — Representación intermedia

```typescript
export type DiagramKind =
  | 'flowchart' | 'pipeline' | 'sequence'
  | 'state' | 'architecture' | 'dag';

export type DiagramIR =
  | FlowchartDiagram | PipelineDiagram | SequenceDiagram
  | StateDiagram | ArchitectureDiagram | DAGDiagram;
```

Cada tipo de `DiagramIR` es una discriminated union que mapea 1:1 a las gramáticas formales de la §3. Ver las interfaces completas en la sección de semántica (§3.1).

### 1.4 Builders con type-state

#### FlowchartBuilder

```typescript
export interface FlowchartBuilder<Nodes extends string = never, Built extends boolean = false> {
  node<N extends string>(id: N, config: FlowNodeConfig): FlowchartBuilder<Nodes | N, false>;
  edge<From extends Nodes, To extends Nodes>(from: From, to: To, config?: FlowEdgeConfig): FlowchartBuilder<Nodes, false>;
  build():  Built extends true ? CompileError<'build() can only be called once'> : DiagramIR<'flowchart'>;
  render(options?: RenderOptions): Built extends true ? CompileError<...> : string;
}

export interface FlowNodeConfig {
  label: string;
  shape?: 'process' | 'decision' | 'terminator' | 'data' | 'predefined-process';
  style?: NodeStyle;
}
export interface FlowEdgeConfig { label?: string; style?: EdgeStyle; }
```

#### PipelineBuilder (detección CT de 2-ciclos)

```typescript
type EdgeTuple = readonly [string, string];
type HasReverseEdge<E extends readonly EdgeTuple[], F extends string, T extends string> =
  E extends readonly [infer H, ...infer Tail]
    ? H extends readonly [T, F] ? true
    : Tail extends readonly EdgeTuple[] ? HasReverseEdge<Tail, F, T> : false
    : false;

export interface PipelineBuilder<Nodes extends string = never, Edges extends readonly EdgeTuple[] = readonly [], Built extends boolean = false> {
  stage<N extends string>(id: N, config?: StageConfig): PipelineBuilder<Nodes | N, Edges, false>;
  edge<From extends Nodes, To extends Nodes>(from: From, to: To):
    HasReverseEdge<Edges, From, To> extends true
      ? CompileError<`Pipeline DAG violation: edge ${From} -> ${To} creates a cycle`>
      : PipelineBuilder<Nodes, readonly [...Edges, readonly [From, To]], false>;
  build(): Built extends true ? CompileError<'build() can only be called once'> : DiagramIR<'pipeline'>;
  render(options?: RenderOptions): Built extends true ? CompileError<...> : string;
}
```

#### SequenceBuilder

```typescript
export interface SequenceBuilder<Lifelines extends string = never, Built extends boolean = false> {
  lifeline<L extends string>(id: L, config?: LifelineConfig): SequenceBuilder<Lifelines | L, false>;
  message<From extends Lifelines, To extends Lifelines>(from: From, to: To, config: MessageConfig): SequenceBuilder<Lifelines, false>;
  selfMessage<L extends Lifelines>(lifeline: L, config: Omit<MessageConfig, 'type'> & { type: 'sync' | 'async' }): SequenceBuilder<Lifelines, false>;
  activate<L extends Lifelines>(lifeline: L): SequenceBuilder<Lifelines, false>;
  deactivate<L extends Lifelines>(lifeline: L): SequenceBuilder<Lifelines, false>;
  note(config: { position: 'left' | 'right' | 'over' | 'between'; target: Lifelines | [Lifelines, Lifelines]; text: string }): SequenceBuilder<Lifelines, false>;
  fragment(config: { operator: 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'seq' | 'strict'; guard?: string; operands: Array<(b: SequenceBuilder<Lifelines, false>) => SequenceBuilder<Lifelines, false>> }): SequenceBuilder<Lifelines, false>;
  build(): Built extends true ? CompileError<'build() can only be called once'> : DiagramIR<'sequence'>;
  render(options?: RenderOptions): Built extends true ? CompileError<...> : string;
}
```

#### StateBuilder

```typescript
export interface StateBuilder<States extends string = never, Built extends boolean = false> {
  state<N extends string>(id: N, config: StateConfig): StateBuilder<States | N, false>;
  initial<S extends States>(id: S): StateBuilder<States, false>;
  transition<From extends States, To extends States>(from: From, to: To, config?: TransitionConfig): StateBuilder<States, false>;
  build(): Built extends true ? CompileError<'build() can only be called once'> : DiagramIR<'state'>;
  render(options?: RenderOptions): Built extends true ? CompileError<...> : string;
}
```

#### ArchitectureBuilder

```typescript
export interface ArchitectureBuilder<Elements extends string = never, Built extends boolean = false> {
  container<N extends string>(id: N, config: ContainerConfig): ArchitectureBuilder<Elements | N, false>;
  component<N extends string>(id: N, config: ComponentConfig): ArchitectureBuilder<Elements | N, false>;
  connector<From extends Elements, To extends Elements>(from: From, to: To, config?: ConnectorConfig): ArchitectureBuilder<Elements, false>;
  build(): Built extends true ? CompileError<'build() can only be called once'> : DiagramIR<'architecture'>;
  render(options?: RenderOptions): Built extends true ? CompileError<...> : string;
}
```

#### DAGBuilder

```typescript
export interface DAGBuilder<Nodes extends string = never, Built extends boolean = false> {
  node<N extends string>(id: N, config?: DAGNodeConfig): DAGBuilder<Nodes | N, false>;
  edge<From extends Nodes, To extends Nodes>(from: From, to: To, config?: DAGEdgeConfig): DAGBuilder<Nodes, false>;
  layout(config: LayoutConfig): DAGBuilder<Nodes, false>;
  build(): Built extends true ? CompileError<'build() can only be called once'> : DiagramIR<'dag'>;
  render(options?: RenderOptions): Built extends true ? CompileError<...> : string;
}
```

### 1.5 Top-level factory

```typescript
export interface DiagramFactory<Plugins extends readonly DiagramPlugin[] = readonly []> {
  flowchart(): FlowchartBuilder;
  pipeline(): PipelineBuilder;
  sequence(): SequenceBuilder;
  state(): StateBuilder;
  architecture(): ArchitectureBuilder;
  dag(): DAGBuilder;
  use<P extends DiagramPlugin>(plugin: P): DiagramFactory<[...Plugins, P]>;
}

export declare const diagram: DiagramFactory;
```

### 1.6 RenderOptions y salidas

```typescript
export interface RenderOptions {
  theme?: 'auto' | 'light' | 'dark' | Record<string, string>;
  width?: number;
  height?: number;
  padding?: number;
  accessible?: boolean; // default: true
}

export interface RenderOutput {
  svg: string;
  viewBox: { x: number; y: number; width: number; height: number };
  layoutMetrics: {
    nodeCount: number;
    edgeCount: number;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
  };
}
```

### 1.7 Ejemplos canónicos (6)

**Flowchart:**
```typescript
const flow = diagram.flowchart()
  .node('a', { label: 'Start', shape: 'terminator' })
  .node('b', { label: 'Check', shape: 'decision' })
  .node('c', { label: 'End', shape: 'terminator' })
  .edge('a', 'b')
  .edge('b', 'c', { label: 'yes' })
  .edge('b', 'a', { label: 'no' })
  .build();
```

**Pipeline:**
```typescript
const pipe = diagram.pipeline()
  .stage('build', { type: 'start' })
  .stage('test')
  .stage('deploy', { type: 'end' })
  .edge('build', 'test')
  .edge('test', 'deploy')
  .build();
```

**Sequence:**
```typescript
const seq = diagram.sequence()
  .lifeline('alice')
  .lifeline('bob')
  .message('alice', 'bob', { label: 'hello()', type: 'sync' })
  .activate('bob')
  .message('bob', 'alice', { label: 'hi()', type: 'return' })
  .deactivate('bob')
  .build();
```

**State:**
```typescript
const st = diagram.state()
  .state('idle', { type: 'simple' })
  .state('active', { type: 'composite', children: ['running', 'paused'] })
  .initial('idle')
  .transition('idle', 'active', { event: 'start' })
  .build();
```

**Architecture:**
```typescript
const arch = diagram.architecture()
  .container('frontend', { label: 'Web App' })
  .component('api', { label: 'API Gateway' })
  .connector('frontend', 'api')
  .build();
```

**DAG:**
```typescript
const dag = diagram.dag()
  .node('a', { label: 'A' })
  .node('b', { label: 'B' })
  .edge('a', 'b')
  .layout({ direction: 'TB' })
  .build();
```

### 1.8 Errores que DEBEN fallar en compile-time

```typescript
// ❌ 'a' y 'b' no están en el NodeSet.
diagram.flowchart().edge('a', 'b').render();

// ❌ 'alice' no ha sido declarada como lifeline.
diagram.sequence().activate('alice').render();

// ❌ render() retorna string, que no tiene .node().
diagram.flowchart().render().node('a');

// ❌ Pipeline detecta 2-ciclo en compile-time.
diagram.pipeline()
  .stage('a').stage('b')
  .edge('a', 'b').edge('b', 'a');
```

### 1.9 Error handling: `DiagramBuildError`

**Decisión:** los builders acumulan estado sin lanzar excepciones. La validación semántica completa ocurre en `.build()`.

```typescript
export class DiagramBuildError extends Error {
  readonly issues: DiagramValidationIssue[];
  constructor(message: string, issues: DiagramValidationIssue[]) {
    super(message);
    this.issues = issues;
  }
}

export interface DiagramValidationIssue {
  code: string;                 // ej. 'PIPELINE_CYCLE', 'SEQUENCE_LIFELINE_MISSING'
  message: string;
  path: (string | number)[];    // ej. ['edges', 2, 'from']
  severity: 'error' | 'warning';
}
```

- **Warnings** se emiten vía `console.warn` y se incluyen en `DiagramIR.meta.warnings`.
- **Errores** lanzan `DiagramBuildError` con `.issues` detalladas.
- **Modo estricto:** `diagram.flowchart({ strict: true })` promueve warnings a errores.

### 1.10 Plugins (`defineDiagramType`)

**Decisión:** module augmentation para type-level registry + factory genérica.

```typescript
export interface DiagramPlugin<K extends string = string> {
  readonly name: K;
  readonly schema: DiagramSchema<K>;
  readonly layout: LayoutFn<K>;
  readonly render: RenderFn<K>;
}

export interface DiagramSchema<K extends string> {
  readonly kind: K;
  readonly nodeTypes: readonly string[];
  readonly edgeTypes: readonly string[];
  readonly validate?: (ir: unknown) => DiagramValidationIssue[];
}

export interface DiagramRegistry { /* extensible por plugins */ }

export function defineDiagramType<P extends DiagramPlugin>(plugin: P): P;
```

**Uso:**
```typescript
const erPlugin = defineDiagramType({
  name: 'er-diagram',
  schema: { kind: 'er-diagram', nodeTypes: ['entity', 'attribute'], edgeTypes: ['relationship'] },
  layout: (ir) => /* ... */, render: (ir, opts) => /* ... */,
});

declare module '@achronyme/diagrams' { interface DiagramRegistry { 'er-diagram': ERDiagramBuilder; } }

const extended = diagram.use(erPlugin);
const er = extended.erDiagram().entity('user', { keys: ['id'] }).build();
```

### 1.11 Diff / Update API (inspector)

```typescript
export interface DiagramHandle<K extends DiagramKind = DiagramKind> {
  update(updater: (builder: BuilderFor<K>) => BuilderFor<K>): Promise<void>;
  destroy(): void;
  toSVG(): string;
  toIR(): DiagramIR<K>;
  setTheme(theme: RenderOptions['theme']): void;
}

export type BuilderFor<K extends DiagramKind> =
  K extends 'flowchart' ? FlowchartBuilder :
  K extends 'pipeline' ? PipelineBuilder :
  K extends 'sequence' ? SequenceBuilder :
  K extends 'state' ? StateBuilder :
  K extends 'architecture' ? ArchitectureBuilder :
  K extends 'dag' ? DAGBuilder : never;
```

**Estrategia de diff:**
1. El updater recibe un builder clonado del estado actual.
2. Se compara IR anterior vs. nueva: O(N + E).
3. Decisión de layout:
   - Solo attrs visuales → patch SVG directo, sin re-layout.
   - Subgrafo afectado pequeño (< 5% y < 500 nodos) → re-layout incremental del *closed neighborhood*.
   - Cambio estructural masivo → re-layout completo con debounce.
4. Patch DOM: fade-in/out (150ms), morph de `transform` (150ms CSS transition), stroke-dashoffset para edges.

---

## 2. Algoritmos de Layout por Tipo

### 2.1 Tabla resumen

| Tipo | Algoritmo | Referencia | Complejidad |
|------|-----------|------------|-------------|
| **DAG** | Sugiyama completo (4 fases) + Brandes-Köpf | Sugiyama et al. 1981; Brandes & Köpf 2001 | O(k·(V+E)) |
| **Flowchart** | Sugiyama + routing ortogonal/polyline | Gansner et al. 1993 (GKNV) | O(k·(V+E)) |
| **Pipeline** | Sugiyama + layer assignment network simplex | GKNV 1993 | O(k·(V+E)) |
| **Sequence** | Layout determinista custom (X=lifeline, Y=tiempo) | — | O(M log M) |
| **State** | Sugiyama variant + compound states (Sander/ELK) | Sander 1996; Schulze et al. 2014 | O(k·(V+E)·depth) |
| **Architecture** | Recursive layered bottom-up + global layers | Sander 1996; ELK Layered | O(k·(V+E)·depth) |

### 2.2 Sugiyama Framework — Fases

| Fase | Algoritmo | Complejidad |
|------|-----------|-------------|
| Cycle removal | **Eades-Lin-Smyth** greedy | O(V+E) |
| Layer assignment | **Network Simplex** (GKNV) | O(V+E) · iteraciones; prácticamente lineal |
| Crossing reduction | **Barycenter** con sweeps alternados | O(k·(V+E)) |
| Coordinate assignment | **Brandes-Köpf** | O(V+E) |

**Pseudocódigo — Eades-Lin-Smyth Cycle Removal:**

```
Algorithm EadesLinSmythCycleRemoval(G = (V, E)):
  E_rev ← ∅
  while V ≠ ∅ do
    while exists sink s in V do remove s and incoming edges
    while exists source s in V do remove s and outgoing edges
    if V ≠ ∅ then
      v ← argmax_{u ∈ V} (out_degree(u) - in_degree(u))
      E_rev ← E_rev ∪ {incoming edges of v}
      remove v and all incident edges
  return E_rev
```

**Pseudocódigo — Brandes-Köpf Vertical Alignment:**

```
Algorithm VerticalAlignment(G, layer_order, direction):
  root[v] ← v;  align[v] ← v  for all v ∈ V ∪ B
  layers ← orden según direction
  for each layer Li in layers do
    r ← 0
    for k ← 1 to |Li| do
      v ← Li[k]
      neighbors ← upper_neighbors(v)  // o lower
      if |neighbors| > 0 then
        d ← |neighbors|
        for m in {⌊(d+1)/2⌋, ⌈(d+1)/2⌉} do
          u ← neighbors[m]
          if align[v] == v AND r < pos[u] then
            align[u] ← v;  root[v] ← root[u]
            align[v] ← root[v];  r ← pos[u]
  return (root, align)
```

Las 4 pasadas (left-up, left-down, right-up, right-down) se promedian para el resultado final balanceado.

### 2.3 Sequence Layout (determinista)

```
Algorithm SequenceLayout(diagram):
  lifelines ← sortByFirstAppearance(diagram.participants)
  for i ← 0 to lifelines.length - 1 do
    lifelines[i].x ← i * (lifeline_width + lifeline_spacing)
  y_cursor ← header_height
  for each fragment in diagram.orderedFragments() do
    if fragment is Message then
      fragment.y ← y_cursor;  y_cursor += message_height
    else if fragment is CombinedFragment then
      fragment.y_top ← y_cursor
      layoutOperandRegions(fragment)
      y_cursor += fragment.total_height
    else if fragment is ActivationBar then
      extendActivation(lifeline, fragment.start_y, fragment.end_y)
  for each lifeline do lifeline.y_bottom ← y_cursor + footer_margin
```

### 2.4 Compound Graphs (Architecture / State)

**Decisión:** recursive layered layout **bottom-up**, inspirado en Sander 1996 y ELK Layered.

1. Construir inclusion tree T del grafo compuesto.
2. Post-order: aplicar Sugiyama a cada grafo interno → ajustar tamaño del compound node.
3. Hierarchical edges cortas (entre hermanos) en crossing reduction del padre.
4. Hierarchical edges largas (entre niveles distantes) como secuencias de edges a través de dummy compound ports.
5. Linear segments: alinear dummy nodes de compound edges en líneas rectas.

### 2.5 Routing de aristas por tipo

| Tipo | Routing default | Routing alternativo |
|------|----------------|---------------------|
| DAG | Spline cúbico | Polyline |
| Flowchart | Ortogonal | Polyline |
| Pipeline | Spline cúbico | Ortogonal |
| Sequence | Recta / Arco semicircular (self) | — |
| State | Ortogonal | Spline |
| Architecture | Ortogonal | Spline |

**Splines:** control points por heurística de tensión: `cp1 = (x1, y1 + dy*0.5)`, `cp2 = (x2, y2 - dy*0.5)`.

**Ortogonal:** waypoints horizontales/verticales con esquinas redondeadas (`r = min(strokeWidth*1.5, 8px)`).

### 2.6 Teoremas relevantes

1. **Crossing Number es NP-hard** (Garey-Johnson 1983). Justifica heurísticas (barycenter) en lugar de exactos.
2. **Orthogonal Min-Bends con embedding fijo** es polinomial (Tamassia 1987, O(n² log n)), pero **sin embedding fijo** es NP-hard (Garg-Tamassia 2001). Para diagramas generales usamos heurísticas (Biedl-Madden-Tollis).
3. **Planarity Test en O(V)** (Hopcroft-Tarjan 1974). Si un diagrama es planar, podemos detectarlo y aplicar algoritmos especializados.
4. **Lower Bound de Cruces en Kₙ** (Guy / Harary-Hill). `cr(Kₙ) = Θ(n⁴)`, confirmando que crossing reduction heurístico es inevitable.
5. **Feedback Arc Set es NP-hard** (Karp 1972). Justifica usar Eades-Lin-Smyth O(V+E) en lugar de aproximaciones polinomiales complejas.

---

## 3. Semántica por Tipo de Diagrama

### 3.1 Gramáticas formales (DU TypeScript)

#### Flowchart

```typescript
type FlowchartDiagram = {
  kind: 'flowchart';
  direction: 'TB' | 'LR' | 'BT' | 'RL';
  nodes: FlowNode[];
  edges: FlowEdge[];
};

type FlowNode =
  | { id: NodeId; kind: 'process'; label: string; style?: NodeStyle }
  | { id: NodeId; kind: 'decision'; label: string; branches: 2 | 3; style?: NodeStyle }
  | { id: NodeId; kind: 'terminator'; label: string; subkind: 'start' | 'end' | 'start-end'; style?: NodeStyle }
  | { id: NodeId; kind: 'data'; label: string; style?: NodeStyle }
  | { id: NodeId; kind: 'predefined-process'; label: string; style?: NodeStyle };

type FlowEdge = {
  id: EdgeId; from: NodeId; to: NodeId;
  kind: 'flow' | 'conditional'; label?: string; style?: EdgeStyle;
};
```

Restricciones: `terminator start` tiene in-degree === 0; `terminator end` out-degree === 0; `decision` out-degree ∈ {1,2,3}; edge condicional solo desde `decision`.

#### Pipeline

```typescript
type PipelineDiagram = {
  kind: 'pipeline';
  nodes: PipelineNode[];
  edges: PipelineEdge[];
};

type PipelineNode =
  | { id: NodeId; kind: 'stage'; subkind: 'task'; label: string; style?: NodeStyle }
  | { id: NodeId; kind: 'stage'; subkind: 'start' | 'end' | 'parallel-fork' | 'parallel-join'; label?: string; style?: NodeStyle };

type PipelineEdge = { id: EdgeId; from: NodeId; to: NodeId; kind: 'dependency'; style?: EdgeStyle };
```

Restricciones: DAG estricto (sin ciclos); `parallel-fork` out-degree ≥ 2; `parallel-join` in-degree ≥ 2; sin multi-edges.

#### Sequence

```typescript
type SequenceDiagram = {
  kind: 'sequence';
  lifelines: Lifeline[];
  elements: SeqElement[];
};

type Lifeline = {
  id: LifelineId; label: string;
  kind: 'actor' | 'participant' | 'boundary' | 'control' | 'entity' | 'database';
  createdAt?: number; destroyedAt?: number;
};

type SeqElement =
  | { kind: 'message'; id: MsgId; from: LifelineId; to: LifelineId; type: 'sync' | 'async' | 'return'; label: string }
  | { kind: 'self-message'; id: MsgId; lifeline: LifelineId; label: string; type: 'sync' | 'async' }
  | { kind: 'activation'; id: ActId; lifeline: LifelineId; startMsg: MsgId; endMsg?: MsgId }
  | { kind: 'fragment'; id: FragId; operator: 'alt' | 'opt' | 'loop' | 'par' | 'break' | 'seq' | 'strict'; guard?: string; operands: SeqElement[][] }
  | { kind: 'note'; id: NoteId; position: 'left' | 'right' | 'over' | 'between'; target: LifelineId | [LifelineId, LifelineId]; text: string }
  | { kind: 'separator'; id: SepId; label: string };
```

Restricciones: `return` después de `sync` matching; mensaje dentro de rango de vida (`createdAt`/`destroyedAt`); fragmentos pueden anidarse arbitrariamente.

#### State

```typescript
type StateDiagram = {
  kind: 'state';
  regions: StateRegion[];
};

type StateRegion = {
  id: RegionId;
  vertices: (State | Pseudostate)[];
  transitions: Transition[];
};

type State =
  | { id: StateId; kind: 'simple'; label: string; entry?: string; do?: string; exit?: string }
  | { id: StateId; kind: 'composite'; label: string; regions: StateRegion[]; entry?: string; exit?: string }
  | { id: StateId; kind: 'submachine'; label: string; submachineRef: string; entry?: string; exit?: string };

type Pseudostate =
  | { id: PseudoId; kind: 'initial' | 'final' | 'choice' | 'fork' | 'join' | 'shallow-history' | 'deep-history' | 'junction' | 'terminate' };

type Transition = {
  id: TransId; source: StateId | PseudoId; target: StateId | PseudoId;
  trigger?: string; guard?: string; action?: string; kind: 'external' | 'local' | 'internal';
};
```

Restricciones: un `initial` por región; `fork` 1 entrada ≥2 salidas; `join` ≥2 entradas 1 salida; `history` solo dentro de composite; `internal` requiere `source === target` y source es `State`.

#### Architecture

```typescript
type ArchitectureDiagram = {
  kind: 'architecture';
  root: ArchContainer;
  edges: ArchEdge[];
};

type ArchElement = ArchComponent | ArchContainer;

type ArchComponent = {
  id: CompId; kind: 'component'; label: string; description?: string; technology?: string;
  badges: ArchBadge[]; tags: string[]; ports?: ArchPort[];
};

type ArchContainer = {
  id: ContId; kind: 'container'; label: string; description?: string; technology?: string;
  children: ArchElement[]; badges: ArchBadge[]; tags: string[]; ports?: ArchPort[];
};

type ArchPort = { id: PortId; side: 'top' | 'right' | 'bottom' | 'left'; offset: number; label?: string };
type ArchBadge = { text: string; shape: 'rect' | 'pill' | 'dot'; color: string };

type ArchEdge = {
  id: EdgeId; from: CompId | ContId | PortId; to: CompId | ContId | PortId;
  label?: string; technology?: string; style: 'solid' | 'dashed';
};
```

Restricciones: grafo de contención es un árbol (sin ciclos); no edges directos ancestro-descendiente; label obligatorio en componentes/containers.

#### DAG genérico

```typescript
type DAGDiagram = {
  kind: 'dag';
  nodes: DAGNode[];
  edges: DAGEdge[];
};

type DAGNode = {
  id: NodeId; label?: string; shape: 'rect' | 'circle' | 'ellipse' | 'diamond' | 'hexagon' | 'none';
  width?: number; height?: number; fill?: string; stroke?: string; strokeWidth?: number;
  metadata?: Record<string, unknown>;
};

type DAGEdge = {
  id: EdgeId; from: NodeId; to: NodeId; directed: boolean;
  label?: string; style: 'solid' | 'dashed' | 'dotted';
};
```

Restricciones: self-loops permitidos (loop Bézier); multi-edges permitidos (offset o badge `×N`); componentes desconectados en grid determinista.

### 3.2 Casos borde transversales

| ID | Caso | Comportamiento |
|----|------|----------------|
| T-C01 | Diagrama vacío | Renderiza canvas vacío con placeholder "Empty diagram". No lanza error. |
| T-C02 | Single-node | Centrado en viewport. Sin crossing reduction. |
| T-C03 | Label largo | Word-wrap a 24 chars o truncamiento con ellipsis. Tooltip `<title>` con texto completo. |
| T-C04 | Unicode complejo | LTR por defecto; RTL detectado vía BiDi regex invierte alineamiento. Emoji ZWJ: 2 cols aprox en SSR. |
| T-C05 | Referencia a nodo inexistente | RT error: `UnknownNodeError`. En render loop: edge no dibujado + log. |
| T-C06 | Ciclo donde no se espera | RT error en tipos que exigen DAG (pipeline, flowchart strict). En flowchart normal: cycle removal + dash. |
| T-C07 | Viewport < 100 px | `preserveAspectRatio="xMidYMid meet"`. Si < 40 px: modo icono (solo geometría, sin labels). |
| T-C08 | Viewport > 8192 px | Limitar `viewBox` a 8192 px por dimensión. Activar zoom + virtualización. |
| T-C09 | Id duplicado | RT error: `ValidationError.DUPLICATE_ID`. |
| T-C10 | Self-loop implícito (from === to) | DAG: self-loop soportado. Pipeline/flowchart: warning. State: self-transition. Sequence: self-message. |

### 3.3 Tabla de validaciones (compile-time vs runtime)

| Tipo | Validación | Fase | Detalle |
|------|-----------|------|---------|
| **Flowchart** | `direction` ∈ enum | CT | Literal union |
| | `id` único | RT | `Set<string>` en constructor |
| | `from`/`to` existe | RT | `UnknownNodeError` |
| | Decision out-degree ∈ {1,2,3} | RT | `FlowchartError.DECISION_OUT_OF_RANGE` |
| | Ciclo en `strictDAG` | RT | `FlowchartError.CYCLE` |
| **Pipeline** | DAG estricto | RT | `PipelineError.CYCLE_DETECTED` (DFS) |
| | Sin multi-edges | RT | `PipelineError.MULTI_EDGE` |
| | Fork out-degree ≥ 2 | RT | Warning |
| **Sequence** | `from`/`to` lifeline existe | RT | `SequenceError.UNKNOWN_LIFELINE` |
| | Mensaje dentro rango de vida | RT | `SequenceError.MESSAGE_AFTER_DESTROY` |
| | `return` después de `sync` | RT | Warning si no empareja |
| **State** | 1 `initial` por región | RT | `StateError.MULTIPLE_INITIAL` |
| | `history` dentro de composite | RT | `StateError.HISTORY_OUTSIDE_COMPOSITE` |
| | Contención sin ciclos | RT | `StateError.CONTAINMENT_CYCLE` |
| **Architecture** | Árbol de contención válido | RT | `ArchitectureError.CONTAINMENT_CYCLE` |
| | Label no vacío | RT | `ArchitectureError.EMPTY_LABEL` |
| | No edges ancestro-descendiente | RT | `ArchitectureError.INVALID_HIERARCHICAL_EDGE` |
| **DAG** | `shape` ∈ enum | CT | Literal union |
| | `from`/`to` existe | RT | `UnknownNodeError` |

### 3.4 Mapeo a estándares

**UML 2.5:** State machine (simple, composite, submachine; todos los pseudostates excepto entry/exit point). Sequence (lifeline, sync/async/return, activation, combined fragments alt/opt/loop/par/break/seq/strict; sin state invariant ni interaction use). No class/component/deployment.

**C4 Model:** Container y Component soportados (con label, description, technology, badges). No Person (nivel 1), ni Code (nivel 4), ni Deployment diagrams.

**BPMN 2.0 (BPMN-light):** Task → `process`; Exclusive Gateway → `decision`; Start/End → `terminator`; Data object → `data`. No pools, lanes, subprocess, ni otros gateways.

---

## 4. Rendering & Theming

### 4.1 Sistema de tokens CSS (lista exhaustiva)

**Universales:**
```css
--diagrams-bg: var(--color-void, #121217);
--diagrams-fg: var(--color-text-primary, #FBFBFE);
--diagrams-grid: var(--color-subtle, #303038);

--diagrams-font-family: var(--font-sans, "Geist Variable", ui-sans-serif, system-ui);
--diagrams-font-family-mono: var(--font-mono, "Geist Mono Variable", ui-monospace);
--diagrams-font-size-sm: 12px;
--diagrams-font-size-md: 14px;
--diagrams-font-size-lg: 16px;
--diagrams-line-height: 1.35;

--diagrams-node-bg: var(--color-surface, #19191E);
--diagrams-node-border: var(--color-subtle, #303038);
--diagrams-node-border-width: 1px;
--diagrams-node-text: var(--color-text-primary, #FBFBFE);
--diagrams-node-radius: var(--radius-md, 10px);
--diagrams-node-shadow: none;

--diagrams-edge: var(--color-text-muted, #9C9CB0);
--diagrams-edge-width: 1.5px;
--diagrams-edge-label-bg: var(--color-surface, #19191E);
--diagrams-edge-label-text: var(--color-text-secondary, #D2D2E0);

--diagrams-accent: var(--color-proof, #A855F7);
--diagrams-accent-dim: var(--color-proof-dim, #7C3AED);
--diagrams-warn: var(--color-warn, #FBBF24);
--diagrams-error: var(--color-error, #F87171);
--diagrams-valid: var(--color-valid, #34D399);
--diagrams-info: var(--color-info, #60A5FA);
```

**Por tipo:**
```css
/* Flowchart */
--diagrams-decision-bg: var(--diagrams-node-bg);
--diagrams-decision-border: var(--diagrams-accent);
--diagrams-terminator-bg: var(--diagrams-node-bg);
--diagrams-terminator-radius: 9999px;

/* Pipeline */
--diagrams-stage-bg: var(--diagrams-node-bg);
--diagrams-stage-border: var(--diagrams-accent-dim);
--diagrams-stage-active-bg: var(--diagrams-accent);
--diagrams-stage-active-text: var(--diagrams-bg);

/* Sequence */
--diagrams-lifeline: var(--color-subtle, #303038);
--diagrams-lifeline-dash: 4 4;
--diagrams-activation-bg: var(--color-subtle, #303038);
--diagrams-activation-border: var(--diagrams-edge);
--diagrams-fragment-bg: color-mix(in srgb, var(--diagrams-bg) 95%, var(--diagrams-accent));
--diagrams-fragment-border: var(--diagrams-accent);

/* State */
--diagrams-state-simple-bg: var(--diagrams-node-bg);
--diagrams-state-composite-bg: color-mix(in srgb, var(--diagrams-bg) 90%, var(--diagrams-edge));
--diagrams-state-initial-fill: var(--diagrams-fg);
--diagrams-state-final-outer: var(--diagrams-fg);
--diagrams-state-final-inner: var(--diagrams-bg);

/* Architecture */
--diagrams-container-bg: color-mix(in srgb, var(--diagrams-bg) 97%, var(--diagrams-info));
--diagrams-container-border: var(--diagrams-info);
--diagrams-component-bg: var(--diagrams-node-bg);
--diagrams-component-border: var(--diagrams-edge);
--diagrams-port-fill: var(--diagrams-bg);
--diagrams-port-border: var(--diagrams-edge);

/* DAG */
--diagrams-dag-node-bg: var(--diagrams-node-bg);
--diagrams-dag-highlight-bg: color-mix(in srgb, var(--diagrams-warn) 20%, var(--diagrams-node-bg));
--diagrams-dag-failure-bg: color-mix(in srgb, var(--diagrams-error) 20%, var(--diagrams-node-bg));
```

**Modo light/dark:** controlado por `data-theme` en contenedor padre, con fallback a `prefers-color-scheme`.

### 4.2 Text measurement (híbrida: estimación SSR + refinamiento cliente)

**Decisión:** estrategia de tres fases.

- **Fase 1 (SSR / build-time):** `EstimatedMetricsEngine` con tablas hardcoded de métricas font-normalizadas.
  - `width = text.length * fontSize * avgWidth * weightFactor` (+5% conservador)
  - Tablas iniciales para Geist (avgCharWidth 0.52, lineHeight 1.35) y JetBrains Mono (avgCharWidth 0.60, lineHeight 1.40).
- **Fase 2 (Hydration):** si la fuente real difiere ≥ 2%, re-layout incremental de nodos afectados con `getBBox()` o `canvas.measureText()`, morph suave de 150ms en `transform`.
- **Fase 3 (Runtime inspector):** `canvas.measureText()` inmediato; para >10k nodos se desactiva refinamiento per-nodo y se usa estimador exclusivamente.

```typescript
export interface TextMetricsEngine {
  measure(text: string, style: TextStyle): BoundingBox;
  estimate(text: string, style: TextStyle): BoundingBox; // SSR-safe
}
```

### 4.3 SSR / hydration en Astro (híbrida por modo de uso)

| Modo de uso | Layout | Hydration |
|-------------|--------|-----------|
| Docs estáticos (achronyme-web) | 100% build-time con estimador | `client:idle` para reconciliación silenciosa (opt-in) |
| Docs estático (embed img) | 100% build-time | Ninguna |
| Inspector (interactivo) | Estimador + canvas inmediato | `client:only` (React/Svelte) |
| Playground / live editor | 100% runtime | Full SPA; layout en Worker |

**Implementación Astro:**
```astro
---
import { diagram } from '@achronyme/diagrams';
const svgString = diagram[type](code).render({ theme: 'auto' });
---
<div class="diagram-wrapper" set:html={svgString} />
<script>
  import { reconcile } from '@achronyme/diagrams/client';
  document.querySelectorAll('.diagram-wrapper > svg').forEach(svg => {
    reconcile(svg, { threshold: 0.02 });
  });
</script>
```

### 4.4 Guidelines de accesibilidad

- **ARIA:** SVG raíz con `role="img"`, `aria-labelledby` apuntando a `<title>` (obligatorio) y `<desc>` (opcional).
- **Nodos interactivos:** `role="button"`, `tabindex="0"`, `aria-label` conciso. Roving tabindex en modo inspector.
- **Navegación por teclado:**
  - `Tab` / `Shift+Tab`: foco entre nodos interactivos (orden visual top-to-bottom, left-to-right).
  - `Enter` / `Space`: activar nodo enfocado.
  - `Arrow keys`: navegación espacial (k-d tree o brute-force para N < 1000).
  - `Escape`: cerrar panel de detalle / deseleccionar.
  - `Home` / `End`: primer/último nodo topológico.
- **Contraste WCAG AA:**
  - Texto normal: ratio ≥ 4.5:1.
  - Texto grande / componentes UI: ratio ≥ 3:1.
  - Verificados: `#FBFBFE` sobre `#19191E` (15.8:1), `#9C9CB0` sobre `#121217` (5.4:1), etc.
- **Reduced motion:** `prefers-reduced-motion: reduce` desactiva transiciones.

---

## 5. Performance & WASM

### 5.1 Presupuesto de performance

| Fase | Algoritmo | Complejidad | Carga |
|------|-----------|-------------|-------|
| Cycle removal | Eades-Lin-Smyth | O(V+E) | Baja |
| Layer assignment | Network Simplex | O(VE) teórica; práctica O(E·d) | **Extrema** |
| Crossing reduction | Barycenter | O(k·\|E\| log \|E\|) | **Alta** |
| Coordinate assignment | Brandes-Köpf | O(V+E) | Media |
| Edge routing (ortogonal) | Biedl-Madden-Tollis | O(E log E) | Media-Alta |
| Edge routing (splines) | Obstacle avoidance | O(E·k) | Alta |
| Compound graphs | Recursive layered | O(V·E) | Alta |
| Sequence | Determinista custom | O(N) | Baja |

### 5.2 Decisión: Opción C (híbrida)

**Decisión:** TypeScript puro inicial, WASM lazy-loaded para N > 5,000.

| N nodos | JS optimizado | WASM Rust | Speedup |
|---------|---------------|-----------|---------|
| 100 | 3–5 ms | 1–2 ms | ~2.5× |
| 1,000 | 80–150 ms | 25–50 ms | ~3.0× |
| 10,000 | 3–6 s | 600–1,200 ms | ~5.0× |
| 200,000 | 2–5 min | 15–40 s | ~7.5× |

### 5.3 Bundle budget

| Componente | Budget gzip | Estrategia |
|------------|-------------|------------|
| Core | < 150 KB | TS puro, sin deps externas pesadas, tree-shakeable |
| Layout engine TS | < 80 KB | Sugiyama TS para <10k nodos |
| Layout engine WASM | < 120 KB | Lazy-loaded; blob ~300 KB raw / ~100 KB gzip |
| Renderer SVG | < 50 KB | Primitivas SVG puras |
| Por tipo de diagrama | < 100 KB c/u | Dynamic import |

**Total first-load (docs, sin WASM):** < 250 KB gzip.  
**Total inspector con WASM lazy:** < 350 KB gzip inicial + 120 KB WASM bajo demanda.

### 5.4 Worker thread architecture

**Decisión:** layout en Web Worker; WASM instanciado dentro del Worker.

```
Main Thread:    Parser → Coordinator → SVG Renderer
                      postMessage ↑↓
Worker Thread:  Deserialize → Algorithm (TS or WASM) → Serialize
```

**SSR fallback:** si `typeof Worker === 'undefined'` o grafo pequeño, layout síncrono en main thread.

### 5.5 Marshalling

**Decisión:** híbrido por tamaño.

- **N < 10,000:** JSON.stringify / JSON.parse vía `postMessage` (más rápido en lado JS).
- **N > 10,000:** ArrayBuffer plano con schema fijo:
  ```typescript
  interface LayoutOutput {
    nodePositions: Float64Array; // [x0, y0, x1, y1, ...]
    edgeRoutes:    Uint32Array;  // índices a waypoints
    bounds:        Float64Array; // [minX, minY, maxX, maxY]
  }
  ```

### 5.6 Crossover N\*

**N\* ≈ 3,000–5,000 nodos.** Por debajo, TS puro en main thread es más eficiente considerando todo el ciclo de vida. Por encima, WASM en Worker con ArrayBuffers planos es claramente superior.

### 5.7 Estrategia para grafos enormes (200k nodos)

**Decisión:** `@achronyme/diagrams` NO soporta 200k nodos con layout completo en un único paso. Exporta API de clustering y level-of-detail; el consumer (`achronyme-inspector`) aplica la estrategia de agrupación apropiada.

- `layoutCompact(nodes, edges, options)`: rápido para N < 5,000.
- `layoutHierarchical(nodes, edges, grouping, options)`: recursivo por niveles si se proveen grupos.
- `suggestClusters(nodes, edges, algorithm)`: helper opcional (lazy-loaded) con Louvain/Leiden en WASM.

**Meta UX para 200k nodos:**
- Primera vista (clusters nivel superior): < 500 ms.
- Expandir cluster de 1,000 nodos: < 200 ms.
- Pan/zoom: > 30 fps.

---

## 6. Testing Strategy

### 6.1 Invariantes formales

**Universales:**
- `U1` No overlap de nodos (permitiendo padding).
- `U2` Aristas no atraviesan nodos ajenos.
- `U3` Bboxes positivas (width > 0, height > 0, no NaN/Infinity).
- `U4` Consistencia de IDs (`edge.source`/`target` existen).
- `U5` Ports en frontera.
- `U6` SVG válido con `viewBox` definido.

**Por tipo (selección):**
- Flowchart: dirección de flujo preservada; ciclos visibles con `reversed === true` o indicador.
- Pipeline: orden topológico en eje del flujo; alineación de etapa.
- Sequence: orden temporal en Y; lifelines verticales (`x = cte`); activación contenida.
- State: estado inicial único; contención de composite (`bbox(padre) ⊃ ⋃ bbox(hijos)`); no solapamiento de regiones.
- Architecture: jerarquía de contención; no cruce de frontera por hijos.
- DAG: monotonía Y; layer assignment válida (`layer(v) - layer(u) ≥ 1`); dummy nodes en aristas largas.

**Rendering SVG:** IDs únicos; referencias resueltas; `viewBox` abarca contenido; z-order correcto.

### 6.2 Stack recomendado

- **Layer 1 — Unit:** Vitest. Objetivo: < 5 s. Line coverage ≥ 85%, branch ≥ 75%.
- **Layer 2 — Property / Integration:** fast-check + Vitest. Invariantes en grafos aleatorios. 1000 runs en PR, 10,000 en nightly.
- **Layer 3 — Visual:** Playwright `toHaveScreenshot()` + `toMatchSnapshot()` de string SVG. Docker consistente (`mcr.microsoft.com/playwright`).

### 6.3 Fixtures (~5 grafos canónicos por tipo)

| Tipo | Fixtures representativos |
|------|-------------------------|
| Flowchart | simple 4 nodos, decision diamond, loop while, mix complejo 12 nodos, ortogonal vs spline |
| Pipeline | linear 5 etapas, branch/merge 3 paralelos, loopback, multi-rank, vacío |
| Sequence | 3 participantes 4 mensajes, activations anidados, alt/loop/par, self-calls, notas |
| State | 3 estados lineales, compuesto con subestados, ortogonal 2 regiones, history, choice con guards |
| Architecture | flat 4 servicios, nested 2 grupos, deep 4 niveles, cross-edge, servicios + DB |
| DAG | cadena 10 nodos, árbol binario completo, diamond, denso 20 nodos, 2 componentes desconectadas |

### 6.4 Conformance suite

- **Fase 1 (inmediato):** adoptar modelos `eclipse-elk/elk-models` (JSON). Convertir a nuestro formato, layoutear, verificar invariantes. Esfuerzo medio-bajo; valor muy alto.
- **Fase 2:** extraer subset de fixtures Mermaid (flowchart, sequence, state). Requiere parser subset Mermaid→nuestro AST.

### 6.5 Fuzzing

Structure-aware fuzzing con fast-check. 5,000 inputs malformados en nightly. Verificar 0 crashes no controlados. Todo input debe terminar en: (a) SVG válido, (b) `AchronymeError` con código descriptivo, o (c) SVG de fallback.

---

## 7. Roadmap de Implementación

### Fase 1 — MVP (pipeline)

**Objetivo:** reemplazar Mermaid en el docs site (`achronyme-web`).

- Implementar `PipelineBuilder` + `FlowchartBuilder` en TS puro.
- Layout Sugiyama completo en TS (cycle removal, network simplex, barycenter, Brandes-Köpf).
- Renderer SVG con sistema de tokens CSS.
- Text measurement híbrida (estimador SSR + reconciliación cliente).
- Integración Astro: helper `.render()` + componente `<Diagram />`.
- **WASM boundary:** diseñar API como funciones puras con estructuras planas (arrays de números), pero implementadas en TS. Esto prepara el swap WASM sin cambiar firmas.

### Fase 2 — flowchart, DAG, WASM lazy-loaded

- Extender layout a flowchart (routing ortogonal) y DAG genérico (splines).
- `achronyme-inspector`: montaje interactivo con `DiagramHandle.update()`.
- Implementar Rust/WASM para Network Simplex + crossing reduction, lazy-loaded cuando `N > 5,000`.
- Web Worker para layout no-bloqueante.
- Conformance: 50+ modelos ELK.

### Fase 3 — sequence, state

- Sequence layout determinista custom (lifelines, mensajes, activations, fragments).
- State diagrams con composite states y recursive layered layout.
- Conformance: fixtures Mermaid (flowchart, sequence, state).

### Fase 4 — architecture (compound)

- Recursive layered bottom-up con global layers.
- Hierarchical ports, edge clipping a contenedores, badges C4.
- Clustering helper (`suggestClusters`) en Rust/WASM para grafos masivos.

### Milestones de migración WASM

| Fase | WASM |
|------|------|
| Fase 1 | TS puro con boundary plana diseñada |
| Fase 2 | WASM lazy-loaded para algoritmos costosos (Network Simplex, crossing reduction) |
| Fase 3 | Clustering (Louvain/Leiden) en WASM para escala masiva |
| Fase 4 | Layout jerárquico recursivo en WASM opcional |

---

## 8. Open Questions — RESUELTAS (2026-05-01)

Las 7 preguntas abiertas fueron decididas el 2026-05-01 antes de comenzar la implementación.

1. **Compatibilidad con Mermaid:** ¿Se requiere compatibilidad sintáctica con Mermaid?
   → **Decisión: NO.** El objetivo es reemplazar Mermaid, no mantener parser dual. La migración de los diagramas existentes en docs es one-shot manual (~<20 diagramas). Mantener un parser Mermaid permanente es coste técnico desproporcionado.

2. **Layout incremental / mental map** (Misue-Eades-Lai-Sugiyama 1995):
   → **Decisión: SÍ pero diferido a Fase 2+.** Lo necesita el inspector cuando consume la diff/update API (§1.11), no las docs estáticas. Fase 1 (pipeline en docs) es 100% estático — implementarlo ahora es over-engineering.

3. **Fuentes web custom en SSR:**
   → **Decisión: self-hosted del sitio + system fonts**, sin Google Fonts dinámicas. El sitio ya self-hostea sus fuentes (Geist, Inter, JetBrains Mono); descargar Google Fonts en build añade dep externa frágil. Fuentes nuevas se añaden manualmente al repo con su tabla de métricas.

4. **Label placement de aristas:**
   → **Decisión: post-proceso heurístico**, no integrado al layout engine. Heurística inicial: midpoint de la arista con offset perpendicular si overlap. Formann-Wagner exact es NP-hard y la diferencia visual no justifica el coste a nuestros volúmenes. Re-evaluar en Fase 4.

5. **Diagramas radiales / circulares:**
   → **Decisión: fuera de scope core.** Si surge necesidad, se cubre vía `defineDiagramType` plugin (§1.10). Mantenerlo fuera del core protege el bundle budget.

6. **Planarity testing como optimización:**
   → **Decisión: NO en Fase 1-2.** Hopcroft-Tarjan O(V) es barato pero el path Tamassia-para-subgrafos-planares añade complejidad significativa en el routing engine. Solo justificable si Track G revela calidad ortogonal inaceptable empíricamente.

7. **Crossing reduction exacto (branch-and-cut) para capas ≤20 nodos:**
   → **Decisión: NO.** Barycenter + median heurístico es ~6% sub-óptimo en promedio según la literatura, y el ILP exacto puede ser 10-100× más lento. Aceptamos la sub-optimalidad. Revisable si visual regression detecta cruces evitables consistentes.

**Decisión adicional sobre WASM (más allá del SPEC original):** Confirmada Opción C híbrida (§5.2). Rust+WASM lazy-loaded para N > 5,000 (Fase 2+). Justificación: el equipo ya domina Rust (todo achronyme es Rust); inspector con N=200k es donde el speedup 5-10× es realista; coste de doble toolchain en CI es manejable porque ya existe.

---

## 9. Referencias Cruzadas

| Sección | Track fuente | Archivo |
|---------|-------------|---------|
| §1 API Surface | Track D — API Chainable / DX | `track-d-api-design.md` |
| §2 Algoritmos de Layout | Track A — Layout Algorithms | `track-a-layout-algorithms.md` |
| §3 Semántica por Tipo | Track B — Diagram Semantics | `track-b-diagram-semantics.md` |
| §4 Rendering & Theming | Track C — Rendering SVG | `track-c-rendering-svg.md` |
| §5 Performance & WASM | Track F — Performance WASM | `track-f-performance-wasm.md` |
| §6 Testing Strategy | Track G — Testing Strategy | `track-g-testing-strategy.md` |
| §7 Roadmap (contexto prior art) | Track E — Prior Art | `track-e-prior-art.md` |

---

*Documento consolidado generado a partir de los 7 tracks de investigación de `@achronyme/diagrams`. No modificar directamente: actualizar los tracks fuente y regenerar.*
