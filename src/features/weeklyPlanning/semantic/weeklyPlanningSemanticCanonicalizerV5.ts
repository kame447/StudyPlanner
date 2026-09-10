import {
  createEmptyWeeklyPlanningFactGraphV5,
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
  type CanonicalSemanticReferenceV5,
  type PlanningFactSourceV5,
  type TemporalConstraintFactV5,
  type WeeklyPlanningFactDiffEntryV5,
  type WeeklyPlanningFactDiffV5,
  type WeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  SEMANTIC_TASK_DATE_RULE_KINDS_V5,
  type SemanticReferenceV5,
  type SemanticTaskDateRuleKindV5,
  type SemanticTemporalConstraintV5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';

export interface WeeklyPlanningSemanticCanonicalizationContextV5 {
  conversationId: string;
  turnId: string;
  expectedRevision: number;
}

export interface WeeklyPlanningSemanticCanonicalizationResultV5 {
  status: 'applied' | 'duplicate' | 'rejected';
  graph: WeeklyPlanningFactGraphV5;
  diff: WeeklyPlanningFactDiffV5 | null;
  errors: string[];
  localToFactId: Record<string, string>;
}

type SemanticTaskDateRuleConstraintV5 = SemanticTemporalConstraintV5 & {
  kind: SemanticTaskDateRuleKindV5;
};

type SemanticBaseTemporalConstraintV5 = SemanticTemporalConstraintV5 & {
  kind:
    | 'earliest_start'
    | 'latest_end'
    | 'fixed_interval'
    | 'deadline'
    | 'preferred_window'
    | 'avoid_window';
};

function stableHash(input: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createFactId(params: {
  context: WeeklyPlanningSemanticCanonicalizationContextV5;
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

function createTurnKey(context: WeeklyPlanningSemanticCanonicalizationContextV5): string {
  return `${context.conversationId}:${context.turnId}`;
}

function createSource(params: {
  context: WeeklyPlanningSemanticCanonicalizationContextV5;
  semanticLocalId: string;
  sourceText: string;
}): PlanningFactSourceV5 {
  return {
    conversationId: params.context.conversationId,
    turnId: params.context.turnId,
    semanticLocalId: params.semanticLocalId,
    sourceText: params.sourceText,
    origin: 'user',
  };
}

function isTaskDateRuleKind(value: string): value is SemanticTaskDateRuleKindV5 {
  return (SEMANTIC_TASK_DATE_RULE_KINDS_V5 as readonly string[]).includes(value);
}

function isTaskDateRuleConstraint(
  value: SemanticTemporalConstraintV5,
): value is SemanticTaskDateRuleConstraintV5 {
  return isTaskDateRuleKind(value.kind);
}

function isBaseTemporalConstraint(
  value: SemanticTemporalConstraintV5,
): value is SemanticBaseTemporalConstraintV5 {
  return !isTaskDateRuleKind(value.kind);
}

function collectExistingFactIds(graph: WeeklyPlanningFactGraphV5): Set<string> {
  return new Set([
    ...graph.planningWindows.map((fact) => fact.id),
    ...graph.tasks.map((fact) => fact.id),
    ...graph.studyContexts.map((fact) => fact.id),
    ...graph.components.map((fact) => fact.id),
    ...graph.workloads.map((fact) => fact.id),
    ...graph.effortEstimates.map((fact) => fact.id),
    ...graph.temporalConstraints.map((fact) => fact.id),
    ...graph.taskDateRules.map((fact) => fact.id),
    ...graph.recurrences.map((fact) => fact.id),
    ...graph.relations.map((fact) => fact.id),
    ...graph.uncertainties.map((fact) => fact.id),
    ...graph.correctionIntents.map((fact) => fact.id),
    ...graph.decisionIntents.map((fact) => fact.id),
    ...graph.availabilityDeclarations.map((fact) => fact.id),
    ...graph.constraintSourceRequests.map((fact) => fact.id),
  ]);
}

function mapSemanticReference(
  reference: SemanticReferenceV5,
  localToFactId: Map<string, string>,
): CanonicalSemanticReferenceV5 {
  return {
    kind: reference.kind,
    publicId: reference.publicId,
    factId: reference.localId ? localToFactId.get(reference.localId) ?? null : null,
    mention: reference.mention,
  };
}

export function canonicalizeWeeklyPlanningSemanticDocumentV5(params: {
  graph?: WeeklyPlanningFactGraphV5;
  document: WeeklyPlanningSemanticDocumentV5;
  context: WeeklyPlanningSemanticCanonicalizationContextV5;
}): WeeklyPlanningSemanticCanonicalizationResultV5 {
  const graph = params.graph ?? createEmptyWeeklyPlanningFactGraphV5();
  const rejected = (errors: string[]): WeeklyPlanningSemanticCanonicalizationResultV5 => ({
    status: 'rejected',
    graph,
    diff: null,
    errors,
    localToFactId: {},
  });

  if (graph.version !== WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5) {
    return rejected(['fact-graph-version-v5']);
  }
  if (params.context.expectedRevision !== graph.revision) {
    return rejected([
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

  const validation = validateWeeklyPlanningSemanticValueV5(params.document);
  if (!validation.document) return rejected(validation.errors);
  const document = validation.document;
  // Proposal acceptance belongs to the application/UI approval boundary, not
  // the Fact Graph. Keep it in the accepted semantic document for traceability,
  // but do not turn it into a durable fact that invalidates an unchanged preview.
  const graphDecisions = document.decisions.filter(
    (decision) => decision.target.kind !== 'proposal',
  );
  const nextRevision = graph.revision + 1;
  const existingFactIds = collectExistingFactIds(graph);
  const localToFactId = new Map<string, string>();
  const errors: string[] = [];

  const register = (semanticLocalId: string, kind: string): string => {
    const id = createFactId({
      context: params.context,
      kind,
      semanticLocalId,
    });
    if (existingFactIds.has(id)) errors.push(`fact-id-collision:${id}`);
    const existingForLocal = localToFactId.get(semanticLocalId);
    if (existingForLocal && existingForLocal !== id) {
      errors.push(`local-id-mapped-twice:${semanticLocalId}`);
    }
    existingFactIds.add(id);
    localToFactId.set(semanticLocalId, id);
    return id;
  };

  if (document.planningWindow) register(document.planningWindow.localId, 'window');
  for (const task of document.tasks) {
    register(task.localId, 'task');
    for (const workload of task.workloads) register(workload.localId, 'workload');
    for (const component of task.study?.components ?? []) {
      register(component.localId, 'component');
      for (const workload of component.workloads) register(workload.localId, 'workload');
    }
    for (const estimate of task.effortEstimates) register(estimate.localId, 'effort');
    for (const constraint of task.temporalConstraints) {
      register(
        constraint.localId,
        isTaskDateRuleConstraint(constraint) ? 'task_date_rule' : 'temporal',
      );
    }
    for (const recurrence of task.recurrence) register(recurrence.localId, 'recurrence');
  }
  for (const relation of document.relations) register(relation.localId, 'relation');
  for (const declaration of document.availabilityDeclarations) {
    register(declaration.localId, 'availability');
  }
  for (const request of document.constraintSourceRequests) {
    register(request.localId, 'source_request');
  }
  for (const uncertainty of document.uncertainties) register(uncertainty.localId, 'uncertainty');
  for (const correction of document.corrections) register(correction.localId, 'correction');
  for (const decision of graphDecisions) register(decision.localId, 'decision');

  if (errors.length > 0) return rejected(errors);

  const requireFactId = (localId: string): string => {
    const factId = localToFactId.get(localId);
    if (!factId) throw new Error(`Validated semantic local ID was not registered: ${localId}`);
    return factId;
  };
  const added: WeeklyPlanningFactDiffEntryV5[] = [];
  const markAdded = (kind: WeeklyPlanningFactDiffEntryV5['kind'], id: string): void => {
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
      context: params.context,
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
    const entries = [
      ...task.workloads.map((workload) => ({ workload, componentId: null as string | null })),
      ...(task.study?.components ?? []).flatMap((component) =>
        component.workloads.map((workload) => ({
          workload,
          componentId: requireFactId(component.localId),
        }))),
    ];
    return entries.map(({ workload, componentId }) => {
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

  const temporalConstraints: TemporalConstraintFactV5[] = document.tasks.flatMap((task) =>
    task.temporalConstraints.filter(isBaseTemporalConstraint).map((constraint) => {
      const fact: TemporalConstraintFactV5 = {
        id: requireFactId(constraint.localId),
        taskId: requireFactId(task.localId),
        targetFactId: requireFactId(constraint.targetLocalId),
        kind: constraint.kind,
        constraintLevel: constraint.constraintLevel,
        dateExpression: constraint.dateExpression,
        namedTimePeriod: constraint.namedTimePeriod,
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

  const taskDateRules = document.tasks.flatMap((task) =>
    task.temporalConstraints.filter(isTaskDateRuleConstraint).map((constraint) => {
      const fact = {
        id: requireFactId(constraint.localId),
        taskId: requireFactId(task.localId),
        targetFactId: requireFactId(constraint.targetLocalId),
        kind: constraint.kind,
        dateExpression: constraint.dateExpression ?? '',
        constraintLevel: constraint.constraintLevel,
        source: createSource({
          context: params.context,
          semanticLocalId: constraint.localId,
          sourceText: constraint.sourceText,
        }),
        createdRevision: nextRevision,
      };
      markAdded('task_date_rule', fact.id);
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

  const availabilityDeclarations = document.availabilityDeclarations.map((declaration) => {
    const fact = {
      id: requireFactId(declaration.localId),
      kind: declaration.kind,
      dateExpression: declaration.dateExpression,
      namedTimePeriod: declaration.namedTimePeriod,
      startTime: declaration.startTime,
      endTime: declaration.endTime,
      recurrenceKind: declaration.recurrenceKind,
      days: [...declaration.days],
      constraintLevel: declaration.constraintLevel,
      capacityMinutes: declaration.capacityMinutes ?? null,
      resolutionStatus: 'unresolved' as const,
      source: createSource({
        context: params.context,
        semanticLocalId: declaration.localId,
        sourceText: declaration.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('availability_declaration', fact.id);
    return fact;
  });

  const constraintSourceRequests = document.constraintSourceRequests.map((request) => {
    const fact = {
      id: requireFactId(request.localId),
      kind: request.kind,
      selector: request.selector,
      requestedAction: request.requestedAction,
      resolutionStatus: 'unresolved' as const,
      source: createSource({
        context: params.context,
        semanticLocalId: request.localId,
        sourceText: request.sourceText,
      }),
      createdRevision: nextRevision,
    };
    markAdded('constraint_source_request', fact.id);
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

  const decisionIntents = graphDecisions.map((decision) => {
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

  if (errors.length > 0) return rejected(errors);

  const nextGraph: WeeklyPlanningFactGraphV5 = {
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
    taskDateRules: [...graph.taskDateRules, ...taskDateRules],
    recurrences: [...graph.recurrences, ...recurrences],
    relations: [...graph.relations, ...relations],
    uncertainties: [...graph.uncertainties, ...uncertainties],
    correctionIntents: [...graph.correctionIntents, ...correctionIntents],
    decisionIntents: [...graph.decisionIntents, ...decisionIntents],
    availabilityDeclarations: [
      ...graph.availabilityDeclarations,
      ...availabilityDeclarations,
    ],
    constraintSourceRequests: [
      ...graph.constraintSourceRequests,
      ...constraintSourceRequests,
    ],
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
    localToFactId: Object.fromEntries(localToFactId.entries()),
  };
}
