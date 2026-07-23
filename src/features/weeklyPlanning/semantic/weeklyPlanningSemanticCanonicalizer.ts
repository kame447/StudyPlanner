import {
  type SemanticReference,
  type WeeklyPlanningSemanticDocument,
} from './weeklyPlanningSemanticDocument';
import {
  createEmptyWeeklyPlanningFactGraph,
  WEEKLY_PLANNING_FACT_GRAPH_VERSION,
  type CanonicalSemanticReference,
  type PlanningFactSource,
  type WeeklyPlanningFactDiff,
  type WeeklyPlanningFactDiffEntry,
  type WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import { validateWeeklyPlanningSemanticValue } from './weeklyPlanningSemanticValidator';

export interface WeeklyPlanningSemanticCanonicalizationContext {
  conversationId: string;
  turnId: string;
  expectedRevision: number;
}

export interface WeeklyPlanningSemanticCanonicalizationResult {
  status: 'applied' | 'duplicate' | 'rejected';
  graph: WeeklyPlanningFactGraph;
  diff: WeeklyPlanningFactDiff | null;
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
  conversationId: string;
  turnId: string;
  kind: string;
  semanticLocalId: string;
}): string {
  const input = [params.conversationId, params.turnId, params.kind, params.semanticLocalId].join('|');
  return `wpf_${params.kind}_${stableHash(input, 2166136261)}${stableHash(input, 374761393)}`;
}

function createTurnKey(context: WeeklyPlanningSemanticCanonicalizationContext): string {
  return `${context.conversationId}:${context.turnId}`;
}

function collectExistingFactIds(graph: WeeklyPlanningFactGraph): Set<string> {
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
  ]);
}

function registerFactId(params: {
  semanticLocalId: string;
  kind: string;
  context: WeeklyPlanningSemanticCanonicalizationContext;
  existingFactIds: Set<string>;
  localToFactId: Map<string, string>;
  errors: string[];
}): string {
  const id = createFactId({
    conversationId: params.context.conversationId,
    turnId: params.context.turnId,
    kind: params.kind,
    semanticLocalId: params.semanticLocalId,
  });
  if (params.existingFactIds.has(id)) {
    params.errors.push(`fact-id-collision:${id}`);
  }
  const existingForLocal = params.localToFactId.get(params.semanticLocalId);
  if (existingForLocal && existingForLocal !== id) {
    params.errors.push(`local-id-mapped-twice:${params.semanticLocalId}`);
  }
  params.localToFactId.set(params.semanticLocalId, id);
  params.existingFactIds.add(id);
  return id;
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

function mapSemanticReference(
  reference: SemanticReference,
  localToFactId: Map<string, string>,
): CanonicalSemanticReference {
  return {
    kind: reference.kind,
    publicId: reference.publicId,
    factId: reference.localId ? localToFactId.get(reference.localId) ?? null : null,
    mention: reference.mention,
  };
}

function toRecord(map: Map<string, string>): Record<string, string> {
  return Object.fromEntries(map.entries());
}

export function canonicalizeWeeklyPlanningSemanticDocument(params: {
  graph?: WeeklyPlanningFactGraph;
  document: WeeklyPlanningSemanticDocument;
  context: WeeklyPlanningSemanticCanonicalizationContext;
}): WeeklyPlanningSemanticCanonicalizationResult {
  const graph = params.graph ?? createEmptyWeeklyPlanningFactGraph();
  const emptyResult = (errors: string[]): WeeklyPlanningSemanticCanonicalizationResult => ({
    status: 'rejected',
    graph,
    diff: null,
    errors,
    localToFactId: {},
  });

  if (graph.version !== WEEKLY_PLANNING_FACT_GRAPH_VERSION) {
    return emptyResult(['fact-graph-version']);
  }
  if (params.context.expectedRevision !== graph.revision) {
    return emptyResult([
      `revision-mismatch:expected=${params.context.expectedRevision}:actual=${graph.revision}`,
    ]);
  }

  const turnKey = createTurnKey(params.context);
  if (graph.appliedTurnKeys.includes(turnKey)) {
    return {
      status: 'duplicate',
      graph,
      diff: null,
      errors: [],
      localToFactId: {},
    };
  }

  const validation = validateWeeklyPlanningSemanticValue(params.document);
  if (!validation.document) {
    return emptyResult(validation.errors);
  }
  const document = validation.document;
  const nextRevision = graph.revision + 1;
  const existingFactIds = collectExistingFactIds(graph);
  const localToFactId = new Map<string, string>();
  const errors: string[] = [];

  const register = (semanticLocalId: string, kind: string): string => registerFactId({
    semanticLocalId,
    kind,
    context: params.context,
    existingFactIds,
    localToFactId,
    errors,
  });

  if (document.planningWindow) register(document.planningWindow.localId, 'window');
  for (const task of document.tasks) {
    register(task.localId, 'task');
    for (const workload of task.workloads) register(workload.localId, 'workload');
    for (const component of task.study?.components ?? []) {
      register(component.localId, 'component');
      for (const workload of component.workloads) register(workload.localId, 'workload');
    }
    for (const estimate of task.effortEstimates) register(estimate.localId, 'effort');
    for (const constraint of task.temporalConstraints) register(constraint.localId, 'temporal');
    for (const recurrence of task.recurrence) register(recurrence.localId, 'recurrence');
  }
  for (const relation of document.relations) register(relation.localId, 'relation');
  for (const uncertainty of document.uncertainties) register(uncertainty.localId, 'uncertainty');
  for (const correction of document.corrections) register(correction.localId, 'correction');
  for (const decision of document.decisions) register(decision.localId, 'decision');

  if (errors.length > 0) {
    return emptyResult(errors);
  }

  const requireFactId = (localId: string): string => {
    const factId = localToFactId.get(localId);
    if (!factId) throw new Error(`Validated semantic local ID was not registered: ${localId}`);
    return factId;
  };

  const added: WeeklyPlanningFactDiffEntry[] = [];
  const markAdded = (kind: WeeklyPlanningFactDiffEntry['kind'], id: string): void => {
    added.push({ kind, id });
  };

  const planningWindows = document.planningWindow
    ? [{
        id: requireFactId(document.planningWindow.localId),
        kind: document.planningWindow.kind,
        value: document.planningWindow.value,
        start: document.planningWindow.start,
        end: document.planningWindow.end,
        source: createSource({
          context: params.context,
          semanticLocalId: document.planningWindow.localId,
          sourceText: document.planningWindow.sourceText,
        }),
        createdRevision: nextRevision,
      }]
    : [];
  planningWindows.forEach((fact) => markAdded('planning_window', fact.id));

  const tasks = document.tasks.map((task) => {
    const fact = {
      id: requireFactId(task.localId),
      category: task.category,
      title: task.title,
      source: createSource({
        context: params.context,
        semanticLocalId: task.localId,
        sourceText: task.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('task', fact.id);
    return fact;
  });

  const studyContexts = document.tasks.flatMap((task) => {
    if (!task.study) return [];
    const id = createFactId({
      conversationId: params.context.conversationId,
      turnId: params.context.turnId,
      kind: 'study-context',
      semanticLocalId: task.localId,
    });
    if (existingFactIds.has(id)) errors.push(`fact-id-collision:${id}`);
    existingFactIds.add(id);
    const fact = {
      id,
      taskId: requireFactId(task.localId),
      purpose: task.study.purpose,
      contextLabel: task.study.contextLabel,
      source: createSource({
        context: params.context,
        semanticLocalId: task.localId,
        sourceText: task.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('study_context', fact.id);
    return [fact];
  });

  const components = document.tasks.flatMap((task) =>
    (task.study?.components ?? []).map((component) => {
      const fact = {
        id: requireFactId(component.localId),
        taskId: requireFactId(task.localId),
        parentComponentId: component.parentLocalId
          ? requireFactId(component.parentLocalId)
          : null,
        role: component.role,
        label: component.label,
        source: createSource({
          context: params.context,
          semanticLocalId: component.localId,
          sourceText: component.sourceText,
        }),
        createdRevision: nextRevision,
      };
      markAdded('component', fact.id);
      return fact;
    }));

  const workloads = document.tasks.flatMap((task) => {
    const taskId = requireFactId(task.localId);
    const taskWorkloads = task.workloads.map((workload) => ({
      workload,
      componentId: null as string | null,
    }));
    const componentWorkloads = (task.study?.components ?? []).flatMap((component) =>
      component.workloads.map((workload) => ({
        workload,
        componentId: requireFactId(component.localId),
      })));
    return [...taskWorkloads, ...componentWorkloads].map(({ workload, componentId }) => {
      const fact = {
        id: requireFactId(workload.localId),
        taskId,
        componentId,
        quantityRole: workload.quantityRole,
        amount: workload.amount,
        unitCode: workload.unitCode,
        unitLabel: workload.unitLabel,
        rangeStart: workload.rangeStart,
        rangeEnd: workload.rangeEnd,
        perOccurrence: workload.perOccurrence,
        periodExpression: workload.periodExpression,
        source: createSource({
          context: params.context,
          semanticLocalId: workload.localId,
          sourceText: workload.sourceText,
        }),
        createdRevision: nextRevision,
      };
      markAdded('workload', fact.id);
      return fact;
    });
  });

  const effortEstimates = document.tasks.flatMap((task) =>
    task.effortEstimates.map((estimate) => {
      const fact = {
        id: requireFactId(estimate.localId),
        taskId: requireFactId(task.localId),
        targetFactId: requireFactId(estimate.targetLocalId),
        kind: estimate.kind,
        minutes: estimate.minutes,
        unitCode: estimate.unitCode,
        precision: estimate.precision,
        source: createSource({
          context: params.context,
          semanticLocalId: estimate.localId,
          sourceText: estimate.sourceText,
        }),
        createdRevision: nextRevision,
      };
      markAdded('effort_estimate', fact.id);
      return fact;
    }));

  const temporalConstraints = document.tasks.flatMap((task) =>
    task.temporalConstraints.map((constraint) => {
      const fact = {
        id: requireFactId(constraint.localId),
        taskId: requireFactId(task.localId),
        targetFactId: requireFactId(constraint.targetLocalId),
        kind: constraint.kind,
        dateExpression: constraint.dateExpression,
        startTime: constraint.startTime,
        endTime: constraint.endTime,
        precision: constraint.precision,
        source: createSource({
          context: params.context,
          semanticLocalId: constraint.localId,
          sourceText: constraint.sourceText,
        }),
        createdRevision: nextRevision,
      };
      markAdded('temporal_constraint', fact.id);
      return fact;
    }));

  const recurrences = document.tasks.flatMap((task) =>
    task.recurrence.map((recurrence) => {
      const fact = {
        id: requireFactId(recurrence.localId),
        taskId: requireFactId(task.localId),
        targetFactId: requireFactId(recurrence.targetLocalId),
        kind: recurrence.kind,
        count: recurrence.count,
        days: [...recurrence.days],
        source: createSource({
          context: params.context,
          semanticLocalId: recurrence.localId,
          sourceText: recurrence.sourceText,
        }),
        createdRevision: nextRevision,
      };
      markAdded('recurrence', fact.id);
      return fact;
    }));

  const relations = document.relations.map((relation) => {
    const fact = {
      id: requireFactId(relation.localId),
      kind: relation.kind,
      fromTaskId: requireFactId(relation.fromLocalId),
      toTaskId: requireFactId(relation.toLocalId),
      source: createSource({
        context: params.context,
        semanticLocalId: relation.localId,
        sourceText: relation.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('relation', fact.id);
    return fact;
  });

  const uncertainties = document.uncertainties.map((uncertainty) => {
    const fact = {
      id: requireFactId(uncertainty.localId),
      targetFactId: uncertainty.targetLocalId === 'document'
        ? null
        : requireFactId(uncertainty.targetLocalId),
      field: uncertainty.field,
      reason: uncertainty.reason,
      source: createSource({
        context: params.context,
        semanticLocalId: uncertainty.localId,
        sourceText: uncertainty.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('uncertainty', fact.id);
    return fact;
  });

  const correctionIntents = document.corrections.map((correction) => {
    const fact = {
      id: requireFactId(correction.localId),
      target: mapSemanticReference(correction.target, localToFactId),
      operation: correction.operation,
      replacementFactId: correction.replacementLocalId
        ? requireFactId(correction.replacementLocalId)
        : null,
      source: createSource({
        context: params.context,
        semanticLocalId: correction.localId,
        sourceText: correction.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('correction_intent', fact.id);
    return fact;
  });

  const decisionIntents = document.decisions.map((decision) => {
    const fact = {
      id: requireFactId(decision.localId),
      target: mapSemanticReference(decision.target, localToFactId),
      decision: decision.decision,
      source: createSource({
        context: params.context,
        semanticLocalId: decision.localId,
        sourceText: decision.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('decision_intent', fact.id);
    return fact;
  });

  if (errors.length > 0) {
    return emptyResult(errors);
  }

  const nextGraph: WeeklyPlanningFactGraph = {
    ...graph,
    revision: nextRevision,
    appliedTurnKeys: [...graph.appliedTurnKeys, turnKey],
    planningWindows: [...graph.planningWindows, ...planningWindows],
    tasks: [...graph.tasks, ...tasks],
    studyContexts: [...graph.studyContexts, ...studyContexts],
    components: [...graph.components, ...components],
    workloads: [...graph.workloads, ...workloads],
    effortEstimates: [...graph.effortEstimates, ...effortEstimates],
    temporalConstraints: [...graph.temporalConstraints, ...temporalConstraints],
    recurrences: [...graph.recurrences, ...recurrences],
    relations: [...graph.relations, ...relations],
    uncertainties: [...graph.uncertainties, ...uncertainties],
    correctionIntents: [...graph.correctionIntents, ...correctionIntents],
    decisionIntents: [...graph.decisionIntents, ...decisionIntents],
  };

  return {
    status: 'applied',
    graph: nextGraph,
    diff: {
      fromRevision: graph.revision,
      toRevision: nextRevision,
      added,
      superseded: [],
      removed: [],
    },
    errors: [],
    localToFactId: toRecord(localToFactId),
  };
}
