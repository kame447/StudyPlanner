import type { WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { filterActiveWeeklyPlanningFactsV5 } from '../semantic/weeklyPlanningFactLifecycleV5';
import type {
  WeeklyPlanningStableV5DialogueActionKind,
  WeeklyPlanningStableV5DialogueCurrentTurnGrounding,
  WeeklyPlanningStableV5DialogueGroundingFact,
} from './weeklyPlanningStableV5DialogueContracts';

type SourceFact = {
  id: string;
  source: {
    turnId: string;
    sourceText: string;
  };
};

function currentTurnFacts<T extends SourceFact>(
  graph: WeeklyPlanningFactGraphV5,
  facts: ReadonlyArray<T>,
  turnId: string,
): T[] {
  return filterActiveWeeklyPlanningFactsV5(graph, facts)
    .filter((fact) => fact.source.turnId === turnId);
}

function groundingFact(
  kind: WeeklyPlanningStableV5DialogueGroundingFact['kind'],
  fact: SourceFact,
  data: Record<string, unknown>,
): WeeklyPlanningStableV5DialogueGroundingFact {
  return {
    factId: fact.id,
    kind,
    sourceText: fact.source.sourceText,
    data,
  };
}

function acceptedFactsForTurn(
  graph: WeeklyPlanningFactGraphV5,
  turnId: string,
): WeeklyPlanningStableV5DialogueGroundingFact[] {
  return [
    ...currentTurnFacts(graph, graph.planningWindows, turnId).map((fact) =>
      groundingFact('planning_window', fact, {
        kind: fact.kind,
        value: fact.value,
        start: fact.start,
        end: fact.end,
      })),
    ...currentTurnFacts(graph, graph.tasks, turnId).map((fact) =>
      groundingFact('task', fact, {
        category: fact.category,
        title: fact.title,
      })),
    ...currentTurnFacts(graph, graph.components, turnId).map((fact) =>
      groundingFact('component', fact, {
        taskId: fact.taskId,
        parentComponentId: fact.parentComponentId,
        role: fact.role,
        label: fact.label,
      })),
    ...currentTurnFacts(graph, graph.workloads, turnId).map((fact) =>
      groundingFact('workload', fact, {
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
    ...currentTurnFacts(graph, graph.effortEstimates, turnId).map((fact) =>
      groundingFact('effort_estimate', fact, {
        taskId: fact.taskId,
        targetFactId: fact.targetFactId,
        kind: fact.kind,
        minutes: fact.minutes,
        unitCode: fact.unitCode,
        precision: fact.precision,
      })),
    ...currentTurnFacts(graph, graph.temporalConstraints, turnId).map((fact) =>
      groundingFact('temporal_constraint', fact, {
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
    ...currentTurnFacts(graph, graph.taskDateRules, turnId).map((fact) =>
      groundingFact('task_date_rule', fact, {
        taskId: fact.taskId,
        targetFactId: fact.targetFactId,
        kind: fact.kind,
        dateExpression: fact.dateExpression,
        constraintLevel: fact.constraintLevel,
      })),
    ...currentTurnFacts(graph, graph.recurrences, turnId).map((fact) =>
      groundingFact('recurrence', fact, {
        taskId: fact.taskId,
        targetFactId: fact.targetFactId,
        kind: fact.kind,
        count: fact.count,
        days: fact.days,
      })),
    ...currentTurnFacts(graph, graph.relations, turnId).map((fact) =>
      groundingFact('relation', fact, {
        kind: fact.kind,
        fromTaskId: fact.fromTaskId,
        toTaskId: fact.toTaskId,
      })),
    ...currentTurnFacts(graph, graph.availabilityDeclarations, turnId).map((fact) =>
      groundingFact('availability_declaration', fact, {
        kind: fact.kind,
        dateExpression: fact.dateExpression,
        namedTimePeriod: fact.namedTimePeriod,
        startTime: fact.startTime,
        endTime: fact.endTime,
        recurrenceKind: fact.recurrenceKind,
        days: fact.days,
        constraintLevel: fact.constraintLevel,
      })),
    ...currentTurnFacts(graph, graph.constraintSourceRequests, turnId).map((fact) =>
      groundingFact('constraint_source_request', fact, {
        kind: fact.kind,
        selector: fact.selector,
        requestedAction: fact.requestedAction,
      })),
  ];
}

export function createWeeklyPlanningStableV5CurrentTurnGrounding(params: {
  graph: WeeklyPlanningFactGraphV5 | null | undefined;
  turnId: string;
  actionKind: WeeklyPlanningStableV5DialogueActionKind;
  previousQuestionCode: string | null;
  currentQuestionCode: string | null;
}): WeeklyPlanningStableV5DialogueCurrentTurnGrounding {
  if (!params.graph) return { mode: 'none', acceptedFacts: [] };
  const acceptedFacts = acceptedFactsForTurn(params.graph, params.turnId);
  if (acceptedFacts.length === 0) return { mode: 'none', acceptedFacts: [] };

  const sameQuestionStillPending = params.actionKind === 'question'
    && params.previousQuestionCode !== null
    && params.previousQuestionCode === params.currentQuestionCode;

  return {
    mode: sameQuestionStillPending ? 'required_before_resume' : 'recommended',
    acceptedFacts,
  };
}
