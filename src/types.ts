/**
 * Core type definitions for @achronyme/diagrams.
 * See SPEC.md §1 (API Surface) and §3 (Diagram Semantics).
 */

declare const __nodeId: unique symbol;
declare const __edgeId: unique symbol;
declare const __lifelineId: unique symbol;
declare const __stateId: unique symbol;
declare const __pseudoId: unique symbol;
declare const __regionId: unique symbol;

export type NodeId = string & { readonly [__nodeId]: 'NodeId' };
export type EdgeId = string & { readonly [__edgeId]: 'EdgeId' };
export type LifelineId = string & { readonly [__lifelineId]: 'LifelineId' };
export type StateId = string & { readonly [__stateId]: 'StateId' };
export type PseudoId = string & { readonly [__pseudoId]: 'PseudoId' };
export type RegionId = string & { readonly [__regionId]: 'RegionId' };

export type CompileError<M extends string> = M & {
  readonly __compileError: unique symbol;
};

export type DiagramKind = 'flowchart' | 'pipeline' | 'sequence' | 'state' | 'architecture' | 'dag';

export interface PipelineDiagram {
  readonly kind: 'pipeline';
  readonly stages: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly subtype?: 'start' | 'end' | 'parallel-fork' | 'parallel-join';
  }>;
  readonly edges: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
  }>;
}

export type DiagramIR = PipelineDiagram;

export interface RenderOptions {
  theme?: 'auto' | 'light' | 'dark' | Record<string, string>;
  width?: number;
  height?: number;
  padding?: number;
  accessible?: boolean;
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

export interface DiagramBuildIssue {
  code: string;
  message: string;
  path?: string;
}

export class DiagramBuildError extends Error {
  readonly issues: ReadonlyArray<DiagramBuildIssue>;

  constructor(issues: ReadonlyArray<DiagramBuildIssue>) {
    super(`Diagram build failed with ${issues.length} issue(s)`);
    this.name = 'DiagramBuildError';
    this.issues = issues;
  }
}
