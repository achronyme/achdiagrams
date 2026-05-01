/**
 * Pipeline diagram builder (Fase 1 — MVP).
 */

import type {
  CompileError,
  DiagramBuildIssue,
  PipelineDiagram,
  RenderOptions,
  RenderOutput,
} from '../types.js';
import { DiagramBuildError } from '../types.js';
import { type LayoutOptions, layoutPipeline } from './layout.js';
import { renderPipelineSvg } from './render.js';

export interface StageConfig {
  label?: string;
  subtype?: 'start' | 'end' | 'parallel-fork' | 'parallel-join';
}

type EdgeTuple = readonly [string, string];

type HasReverseEdge<
  E extends readonly EdgeTuple[],
  F extends string,
  T extends string,
> = E extends readonly [infer H, ...infer Tail]
  ? H extends readonly [T, F]
    ? true
    : Tail extends readonly EdgeTuple[]
      ? HasReverseEdge<Tail, F, T>
      : false
  : false;

export interface PipelineBuilder<
  Nodes extends string = never,
  Edges extends readonly EdgeTuple[] = readonly [],
  Built extends boolean = false,
> {
  stage<N extends string>(id: N, config?: StageConfig): PipelineBuilder<Nodes | N, Edges, false>;

  edge<From extends Nodes, To extends Nodes>(
    from: From,
    to: To,
  ): HasReverseEdge<Edges, From, To> extends true
    ? CompileError<`Pipeline DAG violation: edge ${From} -> ${To} creates a cycle`>
    : PipelineBuilder<Nodes, readonly [...Edges, readonly [From, To]], false>;

  build(): Built extends true ? CompileError<'build() can only be called once'> : PipelineDiagram;

  render(
    options?: RenderOptions,
  ): Built extends true ? CompileError<'render() can only be called after build()'> : RenderOutput;
}

interface PipelineState {
  stages: Array<{ id: string; label: string; subtype?: StageConfig['subtype'] }>;
  edges: Array<{ from: string; to: string }>;
}

export function pipeline(): PipelineBuilder {
  return createBuilder({ stages: [], edges: [] });
}

function createBuilder(state: PipelineState): PipelineBuilder {
  // biome-ignore lint/suspicious/noExplicitAny: type-state encoded at the public type level
  const builder: any = {
    stage(id: string, config?: StageConfig) {
      return createBuilder({
        stages: [
          ...state.stages,
          {
            id,
            label: config?.label ?? id,
            ...(config?.subtype !== undefined ? { subtype: config.subtype } : {}),
          },
        ],
        edges: state.edges,
      });
    },

    edge(from: string, to: string) {
      return createBuilder({
        stages: state.stages,
        edges: [...state.edges, { from, to }],
      });
    },

    build(): PipelineDiagram {
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
      const layoutOpts: LayoutOptions = {};
      if (options?.padding !== undefined) layoutOpts.padding = options.padding;

      const layout = layoutPipeline(ir, layoutOpts);
      const result = renderPipelineSvg(layout, {}, options?.accessible ?? true);

      return {
        svg: result.svg,
        viewBox: {
          x: layout.bounds.minX,
          y: layout.bounds.minY,
          width: result.width,
          height: result.height,
        },
        layoutMetrics: {
          nodeCount: layout.stages.length,
          edgeCount: layout.edges.length,
          bounds: layout.bounds,
        },
      };
    },
  };
  return builder;
}

function stateToIr(state: PipelineState): PipelineDiagram {
  return {
    kind: 'pipeline',
    stages: state.stages.map((s) =>
      s.subtype !== undefined
        ? { id: s.id, label: s.label, subtype: s.subtype }
        : { id: s.id, label: s.label },
    ),
    edges: state.edges.map((e) => ({ from: e.from, to: e.to })),
  };
}

function validate(state: PipelineState): DiagramBuildIssue[] {
  const issues: DiagramBuildIssue[] = [];
  const stageIds = new Set(state.stages.map((s) => s.id));

  for (const e of state.edges) {
    if (!stageIds.has(e.from)) {
      issues.push({
        code: 'E001',
        message: `Edge references undeclared stage '${e.from}'`,
        path: 'edges.from',
      });
    }
    if (!stageIds.has(e.to)) {
      issues.push({
        code: 'E001',
        message: `Edge references undeclared stage '${e.to}'`,
        path: 'edges.to',
      });
    }
  }

  if (hasCycle(state)) {
    issues.push({
      code: 'E002',
      message: 'Pipeline DAG must be acyclic; cycle detected',
    });
  }

  return issues;
}

function hasCycle(state: PipelineState): boolean {
  const adj = new Map<string, string[]>();
  for (const s of state.stages) adj.set(s.id, []);
  for (const e of state.edges) adj.get(e.from)?.push(e.to);

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const s of state.stages) color.set(s.id, WHITE);

  const dfs = (u: string): boolean => {
    color.set(u, GRAY);
    for (const v of adj.get(u) ?? []) {
      const c = color.get(v) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && dfs(v)) return true;
    }
    color.set(u, BLACK);
    return false;
  };

  for (const s of state.stages) {
    if (color.get(s.id) === WHITE && dfs(s.id)) return true;
  }
  return false;
}
