/**
 * Flowchart diagram builder (Fase 2).
 *
 * Unlike pipeline, flowcharts permit cycles (loop-back from a decision is
 * canonical). The runtime cycle detector becomes a no-op here; back-edges
 * are reversed at layout time so the underlying layered algorithm stays
 * acyclic.
 */

import type {
  CompileError,
  DiagramBuildIssue,
  FlowEdge,
  FlowNode,
  FlowShape,
  FlowchartDiagram,
  RenderOptions,
  RenderOutput,
} from '../types.js';
import { DiagramBuildError } from '../types.js';
import { type FlowLayoutOptions, layoutFlowchart } from './layout.js';
import { renderFlowchartSvg } from './render.js';

export interface FlowNodeConfig {
  label?: string;
  shape?: FlowShape;
  subtitle?: string;
}

export interface FlowEdgeConfig {
  label?: string;
}

export interface FlowchartBuilder<Nodes extends string = never, Built extends boolean = false> {
  node<N extends string>(id: N, config?: FlowNodeConfig): FlowchartBuilder<Nodes | N, false>;

  edge<From extends Nodes, To extends Nodes>(
    from: From,
    to: To,
    config?: FlowEdgeConfig,
  ): FlowchartBuilder<Nodes, false>;

  build(): Built extends true ? CompileError<'build() can only be called once'> : FlowchartDiagram;

  render(
    options?: RenderOptions,
  ): Built extends true ? CompileError<'render() can only be called after build()'> : RenderOutput;
}

interface FlowchartState {
  nodes: Array<{ id: string; label: string; shape: FlowShape; subtitle?: string }>;
  edges: Array<{ from: string; to: string; label?: string }>;
}

export function flowchart(): FlowchartBuilder {
  return createBuilder({ nodes: [], edges: [] });
}

function createBuilder(state: FlowchartState): FlowchartBuilder {
  // biome-ignore lint/suspicious/noExplicitAny: type-state encoded at the public type level
  const builder: any = {
    node(id: string, config?: FlowNodeConfig) {
      return createBuilder({
        nodes: [
          ...state.nodes,
          {
            id,
            label: config?.label ?? id,
            shape: config?.shape ?? 'process',
            ...(config?.subtitle !== undefined ? { subtitle: config.subtitle } : {}),
          },
        ],
        edges: state.edges,
      });
    },

    edge(from: string, to: string, config?: FlowEdgeConfig) {
      return createBuilder({
        nodes: state.nodes,
        edges: [
          ...state.edges,
          config?.label !== undefined ? { from, to, label: config.label } : { from, to },
        ],
      });
    },

    build(): FlowchartDiagram {
      const issues = validate(state);
      if (issues.length > 0) {
        throw new DiagramBuildError(issues);
      }
      return stateToIr(state);
    },

    render(options?: RenderOptions): RenderOutput {
      const issues = validate(state);
      if (issues.length > 0) {
        throw new DiagramBuildError(issues);
      }
      const ir = stateToIr(state);
      const layoutOpts: FlowLayoutOptions = {};
      if (options?.padding !== undefined) layoutOpts.padding = options.padding;

      const layout = layoutFlowchart(ir, layoutOpts);
      const result = renderFlowchartSvg(layout, {}, options?.accessible ?? true);

      return {
        svg: result.svg,
        viewBox: {
          x: layout.bounds.minX,
          y: layout.bounds.minY,
          width: result.width,
          height: result.height,
        },
        layoutMetrics: {
          nodeCount: layout.nodes.length,
          edgeCount: layout.edges.length,
          bounds: layout.bounds,
        },
      };
    },
  };
  return builder;
}

function stateToIr(state: FlowchartState): FlowchartDiagram {
  const nodes: FlowNode[] = state.nodes.map((n) =>
    n.subtitle !== undefined
      ? { id: n.id, label: n.label, shape: n.shape, subtitle: n.subtitle }
      : { id: n.id, label: n.label, shape: n.shape },
  );
  const edges: FlowEdge[] = state.edges.map((e) =>
    e.label !== undefined ? { from: e.from, to: e.to, label: e.label } : { from: e.from, to: e.to },
  );
  return { kind: 'flowchart', nodes, edges };
}

function validate(state: FlowchartState): DiagramBuildIssue[] {
  const issues: DiagramBuildIssue[] = [];
  const ids = new Set(state.nodes.map((n) => n.id));

  for (const e of state.edges) {
    if (!ids.has(e.from)) {
      issues.push({
        code: 'F001',
        message: `Edge references undeclared node '${e.from}'`,
        path: 'edges.from',
      });
    }
    if (!ids.has(e.to)) {
      issues.push({
        code: 'F001',
        message: `Edge references undeclared node '${e.to}'`,
        path: 'edges.to',
      });
    }
  }

  return issues;
}
