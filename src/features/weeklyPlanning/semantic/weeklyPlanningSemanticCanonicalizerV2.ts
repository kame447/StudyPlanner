import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION,
  type PlanningFactSource,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
  type WeeklyPlanningFactDiffV2,
  type WeeklyPlanningFactGraphV2,
} from './weeklyPlanningFactGraphV2';
import {
  canonicalizeWeeklyPlanningSemanticDocument,
  type WeeklyPlanningSemanticCanonicalizationContext,
} from './weeklyPlanningSemanticCanonicalizer';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import type { WeeklyPlanningSemanticDocumentV2 } from './weeklyPlanningSemanticDocumentV2';
import { validateWeeklyPlanningSemanticValueV2 } from './weeklyPlanningSemanticValidatorV2';

export interface WeeklyPlanningSemanticCanonicalizationResultV2 {
  status: 'applied' | 'duplicate' | 'rejected';
  graph: WeeklyPlanningFactGraphV2;
  diff: WeeklyPlanningFactDiffV2 | null;
  errors: string[];
  localToFactId: Record<string, string>;
}

function stableHash(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createFactId(params: {
  context: WeeklyPlanningSemanticCanonicalizationContext;
  kind: string;
  semanticLocalId: string;
}): string {
  const input = [
    params.context.conversationId,
    params.context.turnId,
    params.kind,
    params.semanticLocalId,
  ].join('|');
  return `wpf_${params.kind}_${stableHash(input, 2166136261)}${stableHash(input, 374761393)}`;
}

function createSource(params: {
  context: WeeklyPlanningSemanticCanonicalizationContext;
  semanticLocalId: string;
  sourceText: string;
}): PlanningFactSource {
  return {
    conversationId: params.context.conversationId,
    turnId: params.context.turnId,
    semanticLocalId: params.semanticLocalId,
    sourceText: params.sourceText,
    origin: 'user',
  };
}

function projectDocumentToV1(
  document: WeeklyPlanningSemanticDocumentV2,
): WeeklyPlanningSemanticDocument {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION,
    planningIntent: document.planningIntent,
    planningWindow: document.planningWindow,
    tasks: document.tasks.map((task) => ({
      ...task,
      temporalConstraints: task.temporalConstraints.map(({
        constraintLevel: _level,
        namedTimePeriod: _namedTimePeriod,
        ...rest
      }) => rest),
    })),
    relations: document.relations,
    uncertainties: document.uncertainties,
    corrections: document.corrections,
    decisions: document.decisions,
  };
}

function projectGraphToV1(graph: WeeklyPlanningFactGraphV2): WeeklyPlanningFactGraph {
  return {
    version: WEEKLY_PLANNING_FACT_GRAPH_VERSION,
    revision: graph.revision,
    appliedTurnKeys: [...graph.appliedTurnKeys],
    planningWindows: [...graph.planningWindows],
    tasks: [...graph.tasks],
    studyContexts: [...graph.studyContexts],
    components: [...graph.components],
    workloads: [...graph.workloads],
    effortEstimates: [...graph.effortEstimates],
    temporalConstraints: graph.temporalConstraints.map(({
      constraintLevel: _level,
      namedTimePeriod: _namedTimePeriod,
      ...rest
    }) => rest),
    recurrences: [...graph.recurrences],
    relations: [...graph.relations],
    uncertainties: [...graph.uncertainties],
    correctionIntents: [...graph.correctionIntents],
    decisionIntents: [...graph.decisionIntents],
  };
}

function collectFactIds(graph: WeeklyPlanningFactGraphV2): Set<string> {
  return new Set([
    ...graph.planningWindows.map((fact) => fact.id),
    ...graph.tasks.map((fact) => fact.id),
    ...graph.studyContexts.map((fact) => fact.id),
    ...graph.components.map((fact) => fact.id),
    ...graph.workloads.map((fact) => fact.id),
    ...graph.effortEstimates.map((fact) => fact.id),
    ...graph.temporalConstraints.map((fact) => fact.id),
    ...graph.recurrences.map((fact) => fact.id),
    ...graph.relations.map((fact) => fact.id),
    ...graph.uncertainties.map((fact) => fact.id),
    ...graph.correctionIntents.map((fact) => fact.id),
    ...graph.decisionIntents.map((fact) => fact.id),
    ...graph.availabilityDeclarations.map((fact) => fact.id),
    ...graph.constraintSourceRequests.map((fact) => fact.id),
  ]);
}

function rejected(
  graph: WeeklyPlanningFactGraphV2,
  errors: string[],
): WeeklyPlanningSemanticCanonicalizationResultV2 {
  return {
    status: 'rejected',
    graph,
    diff: null,
    errors,
    localToFactId: {},
  };
}

export function canonicalizeWeeklyPlanningSemanticDocumentV2(params: {
  graph: WeeklyPlanningFactGraphV2;
  document: WeeklyPlanningSemanticDocumentV2;
  context: WeeklyPlanningSemanticCanonicalizationContext;
}): WeeklyPlanningSemanticCanonicalizationResultV2 {
  if (params.graph.version !== WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2) {
    return rejected(params.graph, ['fact-graph-version-v2']);
  }

  const validation = validateWeeklyPlanningSemanticValueV2(params.document);
  if (!validation.document) {
    return rejected(params.graph, validation.errors);
  }

  const base = canonicalizeWeeklyPlanningSemanticDocument({
    graph: projectGraphToV1(params.graph),
    document: projectDocumentToV1(validation.document),
    context: params.context,
  });

  if (base.status === 'duplicate') {
    return {
      status: 'duplicate',
      graph: params.graph,
      diff: null,
      errors: [],
      localToFactId: {},
    };
  }
  if (base.status !== 'applied' || !base.diff) {
    return rejected(params.graph, base.errors);
  }

  const errors: string[] = [];
  const localToFactId = new Map(Object.entries(base.localToFactId));
  const existingIds = collectFactIds(params.graph);
  for (const id of collectFactIds({
    ...params.graph,
    version: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
    planningWindows: base.graph.planningWindows,
    tasks: base.graph.tasks,
    studyContexts: base.graph.studyContexts,
    components: base.graph.components,
    workloads: base.graph.workloads,
    effortEstimates: base.graph.effortEstimates,
    temporalConstraints: [],
    recurrences: base.graph.recurrences,
    relations: base.graph.relations,
    uncertainties: base.graph.uncertainties,
    correctionIntents: base.graph.correctionIntents,
    decisionIntents: base.graph.decisionIntents,
  })) {
    existingIds.add(id);
  }

  const registerAdditional = (kind: string, localId: string): string => {
    const id = createFactId({ context: params.context, kind, semanticLocalId: localId });
    if (existingIds.has(id)) errors.push(`fact-id-collision:${id}`);
    if (localToFactId.has(localId)) errors.push(`local-id-mapped-twice:${localId}`);
    existingIds.add(id);
    localToFactId.set(localId, id);
    return id;
  };

  const availabilityDeclarations = validation.document.availabilityDeclarations.map((declaration) => ({
    id: registerAdditional('availability', declaration.localId),
    kind: declaration.kind,
    dateExpression: declaration.dateExpression,
    namedTimePeriod: declaration.namedTimePeriod,
    startTime: declaration.startTime,
    endTime: declaration.endTime,
    recurrenceKind: declaration.recurrenceKind,
    days: [...declaration.days],
    constraintLevel: declaration.constraintLevel,
    resolutionStatus: 'unresolved' as const,
    source: createSource({
      context: params.context,
      semanticLocalId: declaration.localId,
      sourceText: declaration.sourceText,
    }),
    createdRevision: base.graph.revision,
  }));

  const constraintSourceRequests = validation.document.constraintSourceRequests.map((request) => ({
    id: registerAdditional('source_request', request.localId),
    kind: request.kind,
    selector: request.selector,
    requestedAction: request.requestedAction,
    resolutionStatus: 'unresolved' as const,
    source: createSource({
      context: params.context,
      semanticLocalId: request.localId,
      sourceText: request.sourceText,
    }),
    createdRevision: base.graph.revision,
  }));

  if (errors.length > 0) return rejected(params.graph, errors);

  const existingTemporalById = new Map(
    params.graph.temporalConstraints.map((constraint) => [constraint.id, constraint]),
  );
  const semanticTemporalByLocalId = new Map(
    validation.document.tasks
      .flatMap((task) => task.temporalConstraints)
      .map((constraint) => [constraint.localId, constraint]),
  );
  const temporalConstraints = base.graph.temporalConstraints.map((constraint) => {
    const existing = existingTemporalById.get(constraint.id);
    if (existing) return existing;
    const semantic = semanticTemporalByLocalId.get(constraint.source.semanticLocalId);
    if (!semantic) {
      errors.push(`missing-temporal-extension:${constraint.source.semanticLocalId}`);
      return {
        ...constraint,
        constraintLevel: 'unknown' as const,
        namedTimePeriod: null,
      };
    }
    return {
      ...constraint,
      constraintLevel: semantic.constraintLevel,
      namedTimePeriod: semantic.namedTimePeriod,
    };
  });

  if (errors.length > 0) return rejected(params.graph, errors);

  const nextGraph: WeeklyPlanningFactGraphV2 = {
    version: WEEKLY_PLANNING_FACT_GRAPH_VERSION_V2,
    revision: base.graph.revision,
    appliedTurnKeys: base.graph.appliedTurnKeys,
    planningWindows: base.graph.planningWindows,
    tasks: base.graph.tasks,
    studyContexts: base.graph.studyContexts,
    components: base.graph.components,
    workloads: base.graph.workloads,
    effortEstimates: base.graph.effortEstimates,
    temporalConstraints,
    recurrences: base.graph.recurrences,
    relations: base.graph.relations,
    uncertainties: base.graph.uncertainties,
    correctionIntents: base.graph.correctionIntents,
    decisionIntents: base.graph.decisionIntents,
    availabilityDeclarations: [
      ...params.graph.availabilityDeclarations,
      ...availabilityDeclarations,
    ],
    constraintSourceRequests: [
      ...params.graph.constraintSourceRequests,
      ...constraintSourceRequests,
    ],
  };

  const diff: WeeklyPlanningFactDiffV2 = {
    fromRevision: base.diff.fromRevision,
    toRevision: base.diff.toRevision,
    added: [
      ...base.diff.added,
      ...availabilityDeclarations.map((fact) => ({
        kind: 'availability_declaration' as const,
        id: fact.id,
      })),
      ...constraintSourceRequests.map((fact) => ({
        kind: 'constraint_source_request' as const,
        id: fact.id,
      })),
    ],
    superseded: [...base.diff.superseded],
    removed: [...base.diff.removed],
  };

  return {
    status: 'applied',
    graph: nextGraph,
    diff,
    errors: [],
    localToFactId: Object.fromEntries(localToFactId.entries()),
  };
}
