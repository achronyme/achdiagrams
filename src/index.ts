/**
 * @achronyme/achdiagrams — programmatic SVG diagram engine.
 *
 * Public entry point. See SPEC.md §1 (API Surface) and §7 (Roadmap).
 *
 * Implementation status: Fase 1 (pipeline) + Fase 2 partial (flowchart).
 * Remaining: DAG, sequence, state, architecture, WASM lazy-loaded.
 */

import { type DAGBuilder, dag } from './dag/index.js';
import { type FlowchartBuilder, flowchart } from './flowchart/index.js';
import { type PipelineBuilder, pipeline } from './pipeline/index.js';

export type {
  CompileError,
  DAGDiagram,
  DAGEdge,
  DAGEdgeStyle,
  DAGNode,
  DAGShape,
  DiagramBuildIssue,
  DiagramIR,
  DiagramKind,
  EdgeId,
  FlowEdge,
  FlowNode,
  FlowShape,
  FlowchartDiagram,
  LifelineId,
  NodeId,
  PipelineDiagram,
  PseudoId,
  RegionId,
  RenderOptions,
  RenderOutput,
  StateId,
} from './types.js';

export { DiagramBuildError } from './types.js';
export { pipeline, type PipelineBuilder, type StageConfig } from './pipeline/index.js';
export {
  flowchart,
  type FlowchartBuilder,
  type FlowNodeConfig,
  type FlowEdgeConfig,
} from './flowchart/index.js';
export {
  dag,
  type DAGBuilder,
  type DAGNodeConfig,
  type DAGEdgeConfig,
  type DAGLayoutConfig,
  type CoordinateAssignment,
} from './dag/index.js';

export interface DiagramFactory {
  pipeline(): PipelineBuilder;
  flowchart(): FlowchartBuilder;
  dag(): DAGBuilder;
}

export const diagram: DiagramFactory = {
  pipeline,
  flowchart,
  dag,
};
