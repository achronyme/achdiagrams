/**
 * @achronyme/diagrams — programmatic SVG diagram engine.
 *
 * Public entry point. See SPEC.md §1 (API Surface) and §7 (Roadmap).
 *
 * Implementation status: Fase 1 scaffolding (pipeline only).
 * Other diagram types (flowchart, sequence, state, architecture, dag) land
 * in subsequent fases per the SPEC roadmap.
 */

import { type PipelineBuilder, pipeline } from './pipeline/index.js';

export type {
  CompileError,
  DiagramBuildIssue,
  DiagramIR,
  DiagramKind,
  EdgeId,
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

export interface DiagramFactory {
  pipeline(): PipelineBuilder;
}

export const diagram: DiagramFactory = {
  pipeline,
};
