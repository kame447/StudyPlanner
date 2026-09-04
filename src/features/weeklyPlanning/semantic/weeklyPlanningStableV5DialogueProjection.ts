import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { filterActiveWeeklyPlanningFactsV5 } from './weeklyPlanningFactLifecycleV5';

function activeFacts<T extends { id: string }>(
  graph: WeeklyPlanningFactGraphV5,
  facts: ReadonlyArray<T>,
): T[] {
  // Some legacy/test snapshots predate lifecycle entries. Preserve their readable
  // state, but once lifecycle data exists it is authoritative for dialogue too.
  if (graph.factLifecycles.length === 0) return [...facts];
  return filterActiveWeeklyPlanningFactsV5(graph, facts);
}

export function createWeeklyPlanningStableV5DialogueProjection(
  graph: WeeklyPlanningFactGraphV5,
): Record<string, unknown> & {
  tasks: Array<Record<string, unknown>>;
  temporalConstraints: Array<Record<string, unknown>>;
} {
  const planningWindows = activeFacts(graph, graph.planningWindows);
  const tasks = activeFacts(graph, graph.tasks);
  const studyContexts = activeFacts(graph, graph.studyContexts);
  const components = activeFacts(graph, graph.components);
  const workloads = activeFacts(graph, graph.workloads);
  const effortEstimates = activeFacts(graph, graph.effortEstimates);
  const temporalConstraints = activeFacts(graph, graph.temporalConstraints);
  const taskDateRules = activeFacts(graph, graph.taskDateRules);
  const recurrences = activeFacts(graph, graph.recurrences);
  const relations = activeFacts(graph, graph.relations);
  const uncertainties = activeFacts(graph, graph.uncertainties);
  const availabilityDeclarations = activeFacts(graph, graph.availabilityDeclarations);
  const constraintSourceRequests = activeFacts(graph, graph.constraintSourceRequests);

  return {
    revision: graph.revision,
    planningWindows: planningWindows.map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      value: fact.value,
      start: fact.start,
      end: fact.end,
    })),
    tasks: tasks.map((fact) => ({
      id: fact.id,
      category: fact.category,
      title: fact.title,
    })),
    studyContexts: studyContexts.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      purpose: fact.purpose,
      contextLabel: fact.contextLabel,
    })),
    components: components.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      parentComponentId: fact.parentComponentId,
      role: fact.role,
      label: fact.label,
    })),
    workloads: workloads.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      componentId: fact.componentId,
      quantityRole: fact.quantityRole,
      amount: fact.amount,
      unitCode: fact.unitCode,
      unitLabel: fact.unitLabel,
      rangeStart: fact.rangeStart,
      rangeEnd: fact.rangeEnd,
      perOccurrence: fact.perOccurrence,
      periodExpression: fact.periodExpression,
    })),
    effortEstimates: effortEstimates.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      minutes: fact.minutes,
      unitCode: fact.unitCode,
      precision: fact.precision,
    })),
    temporalConstraints: temporalConstraints.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      constraintLevel: fact.constraintLevel,
      dateExpression: fact.dateExpression,
      namedTimePeriod: fact.namedTimePeriod,
      startTime: fact.startTime,
      endTime: fact.endTime,
      precision: fact.precision,
    })),
    taskDateRules: taskDateRules.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      dateExpression: fact.dateExpression,
      constraintLevel: fact.constraintLevel,
    })),
    recurrences: recurrences.map((fact) => ({
      id: fact.id,
      taskId: fact.taskId,
      targetFactId: fact.targetFactId,
      kind: fact.kind,
      count: fact.count,
      days: fact.days,
    })),
    relations: relations.map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      fromTaskId: fact.fromTaskId,
      toTaskId: fact.toTaskId,
    })),
    uncertainties: uncertainties.map((fact) => ({
      id: fact.id,
      targetFactId: fact.targetFactId,
      field: fact.field,
      reason: fact.reason,
    })),
    availabilityDeclarations: availabilityDeclarations.map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      dateExpression: fact.dateExpression,
      namedTimePeriod: fact.namedTimePeriod,
      startTime: fact.startTime,
      endTime: fact.endTime,
      recurrenceKind: fact.recurrenceKind,
      days: fact.days,
      constraintLevel: fact.constraintLevel,
      capacityMinutes: fact.capacityMinutes ?? null,
      resolutionStatus: fact.resolutionStatus,
    })),
    constraintSourceRequests: constraintSourceRequests.map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      selector: fact.selector,
      requestedAction: fact.requestedAction,
      resolutionStatus: fact.resolutionStatus,
    })),
  };
}
