/**
 * DAG diagram builder — generic directed graph (cycles, self-loops, multi-edges
 * permitted). See SPEC §3 (DAG genérico) for IR shape and §1.4 for builder
 * surface.
 */

import type {
  CompileError,
  DAGDiagram,
  DAGEdgeStyle,
  DAGNode,
  DAGShape,
  DiagramBuildIssue,
  RenderOptions,
  RenderOutput,
} from '../types.js';
import { DiagramBuildError } from '../types.js';
import { type CoordinateAssignment, type DAGLayoutOptions, layoutDAG } from './layout.js';
import { renderDAGSvg } from './render.js';

export interface DAGNodeConfig {
  label?: string;
  shape?: DAGShape;
  width?: number;
  height?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  metadata?: Record<string, unknown>;
}

export interface DAGEdgeConfig {
  label?: string;
  directed?: boolean;
  style?: DAGEdgeStyle;
}

export interface DAGLayoutConfig {
  direction?: 'TB' | 'LR';
  nodeHeight?: number;
  layerSpacing?: number;
  withinLayerSpacing?: number;
  padding?: number;
  /** Coordinate-assignment strategy. Defaults to `'lerp'`. Set to
   *  `'brandes-kopf'` to use the 4-pass aligned algorithm (Brandes & Köpf
   *  2001 with the 2020 Erratum). Trade-offs measured empirically:
   *  - Consistently 1.7–2.5× slower than `'lerp'` (4 passes vs 1).
   *  - Identical edge-bend count (depends on dummy insertion, not
   *    coordinate assignment); the win is straight horizontal alignment
   *    of long-edge inner segments and dense layers.
   *  - **Caveat**: produces visibly wider bounds than `'lerp'` on
   *    inputs with many multi-layer-spanning ("long") edges. See
   *    `.claude/research/external/perf-2026-05-03-bk-scale.md`. */
  coordinateAssignment?: CoordinateAssignment;
}

export type { CoordinateAssignment };

export interface DAGBuilder<Nodes extends string = never, Built extends boolean = false> {
  node<N extends string>(id: N, config?: DAGNodeConfig): DAGBuilder<Nodes | N, false>;

  edge<From extends Nodes, To extends Nodes>(
    from: From,
    to: To,
    config?: DAGEdgeConfig,
  ): DAGBuilder<Nodes, false>;

  layout(config: DAGLayoutConfig): DAGBuilder<Nodes, false>;

  build(): Built extends true ? CompileError<'build() can only be called once'> : DAGDiagram;

  render(
    options?: RenderOptions,
  ): Built extends true ? CompileError<'render() can only be called after build()'> : RenderOutput;
}

interface DAGState {
  nodes: Array<{
    id: string;
    label?: string;
    shape: DAGShape;
    width?: number;
    height?: number;
    fill?: string;
    stroke?: string;
    strokeWidth?: number;
    metadata?: Record<string, unknown>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    directed: boolean;
    style: DAGEdgeStyle;
    label?: string;
  }>;
  layout: DAGLayoutConfig;
}

export function dag(): DAGBuilder {
  return createBuilder({ nodes: [], edges: [], layout: {} });
}

function createBuilder(state: DAGState): DAGBuilder {
  // biome-ignore lint/suspicious/noExplicitAny: type-state encoded at the public type level
  const builder: any = {
    node(id: string, config?: DAGNodeConfig) {
      const next: DAGState['nodes'][number] = {
        id,
        shape: config?.shape ?? 'rect',
      };
      if (config?.label !== undefined) next.label = config.label;
      if (config?.width !== undefined) next.width = config.width;
      if (config?.height !== undefined) next.height = config.height;
      if (config?.fill !== undefined) next.fill = config.fill;
      if (config?.stroke !== undefined) next.stroke = config.stroke;
      if (config?.strokeWidth !== undefined) next.strokeWidth = config.strokeWidth;
      if (config?.metadata !== undefined) next.metadata = config.metadata;
      return createBuilder({
        nodes: [...state.nodes, next],
        edges: state.edges,
        layout: state.layout,
      });
    },

    edge(from: string, to: string, config?: DAGEdgeConfig) {
      const next: DAGState['edges'][number] = {
        from,
        to,
        directed: config?.directed ?? true,
        style: config?.style ?? 'solid',
      };
      if (config?.label !== undefined) next.label = config.label;
      return createBuilder({
        nodes: state.nodes,
        edges: [...state.edges, next],
        layout: state.layout,
      });
    },

    layout(cfg: DAGLayoutConfig) {
      return createBuilder({
        nodes: state.nodes,
        edges: state.edges,
        layout: { ...state.layout, ...cfg },
      });
    },

    build(): DAGDiagram {
      const issues = validate(state);
      if (issues.length > 0) throw new DiagramBuildError(issues);
      return stateToIr(state);
    },

    render(options?: RenderOptions): RenderOutput {
      const issues = validate(state);
      if (issues.length > 0) throw new DiagramBuildError(issues);
      const ir = stateToIr(state);
      const layoutOpts: DAGLayoutOptions = { ...state.layout };
      if (options?.padding !== undefined) layoutOpts.padding = options.padding;
      if (options?.direction !== undefined) layoutOpts.direction = options.direction;

      const lay = layoutDAG(ir, layoutOpts);
      const result = renderDAGSvg(lay, {}, options?.accessible ?? true);

      return {
        svg: result.svg,
        viewBox: {
          x: lay.bounds.minX,
          y: lay.bounds.minY,
          width: result.width,
          height: result.height,
        },
        layoutMetrics: {
          nodeCount: lay.nodes.length,
          edgeCount: lay.edges.length,
          bounds: lay.bounds,
        },
      };
    },
  };
  return builder;
}

function stateToIr(state: DAGState): DAGDiagram {
  const nodes: DAGNode[] = state.nodes.map((n) => {
    const out: { -readonly [K in keyof DAGNode]: DAGNode[K] } = {
      id: n.id,
      shape: n.shape,
    };
    if (n.label !== undefined) out.label = n.label;
    if (n.width !== undefined) out.width = n.width;
    if (n.height !== undefined) out.height = n.height;
    if (n.fill !== undefined) out.fill = n.fill;
    if (n.stroke !== undefined) out.stroke = n.stroke;
    if (n.strokeWidth !== undefined) out.strokeWidth = n.strokeWidth;
    if (n.metadata !== undefined) out.metadata = n.metadata;
    return out;
  });
  const edges = state.edges.map((e) => ({
    from: e.from,
    to: e.to,
    directed: e.directed,
    style: e.style,
    ...(e.label !== undefined ? { label: e.label } : {}),
  }));
  return { kind: 'dag', nodes, edges };
}

function validate(state: DAGState): DiagramBuildIssue[] {
  const issues: DiagramBuildIssue[] = [];
  const ids = new Set(state.nodes.map((n) => n.id));
  const seenIds = new Set<string>();
  for (const n of state.nodes) {
    if (seenIds.has(n.id)) {
      issues.push({
        code: 'D001',
        message: `Duplicate node id '${n.id}'`,
        path: 'nodes.id',
      });
    }
    seenIds.add(n.id);
  }
  for (const e of state.edges) {
    if (!ids.has(e.from)) {
      issues.push({
        code: 'D002',
        message: `Edge references undeclared node '${e.from}'`,
        path: 'edges.from',
      });
    }
    if (!ids.has(e.to)) {
      issues.push({
        code: 'D002',
        message: `Edge references undeclared node '${e.to}'`,
        path: 'edges.to',
      });
    }
  }
  return issues;
}
