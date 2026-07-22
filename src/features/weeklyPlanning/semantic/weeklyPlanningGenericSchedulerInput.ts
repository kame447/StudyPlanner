import type {
  TaskRelationFact,
  WeeklyPlanningFactGraph,
} from './weeklyPlanningFactGraph';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION,
} from './weeklyPlanningFactGraph';
import type { WeeklyPlanningFactGraphV2 } from './weeklyPlanningFactGraphV2';
import {
  compileGenericPlanningWorkItems,
  type GenericPlanningWorkItem,
  type GenericWorkItemIssue,
} from './weeklyPlanningGenericWorkItems';
import {
  resolveWeeklyPlanningAvailability,
  type AvailabilityResolutionContext,
  type AvailabilityResolutionIssue,
  type AvailabilityWindowFact,
  type ConstraintSourceSelectionFact,
  type ExternalConstraintSourceSnapshot,
} from './weeklyPlanningAvailabilityResolver';
import {
  resolveWeeklyPlanningTaskCommitments,
  type TaskCommitmentReservation,
  type TaskCommitmentResolutionIssue,
} from './weeklyPlanningTaskCommitmentResolver';
import {
  isValidCalendarDate,
} from './weeklyPlanningCalendarResolver';

export const GENERIC_SCHEDULER_INPUT_VERSION =
  'weekly-planning-generic-scheduler-input-v1' as const;

export interface GenericSchedulerPlanningHorizon {
  startDate: string;
  endDate: string;
  timeZone: string;
  planningWindowFactIds: string[];
}

export interface GenericSchedulerTaskRelation {
  factId: string;
  kind: TaskRelationFact['kind'];
  fromTaskId: string;
  toTaskId: string;
}

export interface GenericSchedulerInput {
  version: typeof GENERIC_SCHEDULER_INPUT_VERSION;
  graphRevision: number;
  ownerId: string;
  horizon: GenericSchedulerPlanningHorizon;
  movableWorkItems: GenericPlanningWorkItem[];
  fixedTaskReservations: TaskCommitmentReservation[];
  availabilityWindows: AvailabilityWindowFact[];
  sourceSelections: ConstraintSourceSelectionFact[];
  relations: GenericSchedulerTaskRelation[];
  sourceFactRefs: string[];
}

export type GenericSchedulerInputIssue =
  | {
      domain: 'planning_horizon';
      code:
        | 'invalid_planning_horizon'
        | 'ambiguous_planning_window';
      blocking: true;
      factId: string | null;
      details?: Record<string, string | number | boolean | null>;
    }
  | {
      domain: 'work_item';
      code: GenericWorkItemIssue['code'];
      blocking: boolean;
      factId: string;
      details?: Record<string, string | number | boolean | null>;
    }
  | {
      domain: 'commitment';
      code: TaskCommitmentResolutionIssue['code'];
      blocking: boolean;
      factId: string;
      details?: Record<string, string | number | boolean | null>;
    }
  | {
      domain: 'availability';
      code: AvailabilityResolutionIssue['code'];
      blocking: boolean;
      factId: string;
      details?: Record<string, string | number | boolean | null>;
    }
  | {
      domain: 'relation';
      code: 'orphan_relation_task' | 'self_relation';
      blocking: true;
      factId: string;
      details?: Record<string, string | number | boolean | null>;
    }
  | {
      domain: 'deduplication';
      code: 'fixed_task_movable_work_suppressed';
      blocking: false;
      factId: string;
      details: {
        taskId: string;
        workItemId: string;
      };
    };

export interface GenericSchedulerInputCompilationResult {
  status: 'ready' | 'needs_resolution' | 'empty';
  input: GenericSchedulerInput | null;
  issues: GenericSchedulerInputIssue[];
}

export interface GenericSchedulerInputContext
  extends AvailabilityResolutionContext {}

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
      constraintLevel: _constraintLevel,
      namedTimePeriod: _namedTimePeriod,
      ...constraint
    }) => constraint),
    recurrences: [...graph.recurrences],
    relations: [...graph.relations],
    uncertainties: [...graph.uncertainties],
    correctionIntents: [...graph.correctionIntents],
    decisionIntents: [...graph.decisionIntents],
  };
}

function validateHorizon(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: GenericSchedulerInputContext;
}): GenericSchedulerInputIssue[] {
  const issues: GenericSchedulerInputIssue[] = [];
  if (
    !isValidCalendarDate(params.context.currentDate)
    || !isValidCalendarDate(params.context.planningStartDate)
    || !isValidCalendarDate(params.context.planningEndDate)
    || params.context.planningStartDate > params.context.planningEndDate
    || !params.context.timeZone.trim()
    || !params.context.ownerId.trim()
  ) {
    issues.push({
      domain: 'planning_horizon',
      code: 'invalid_planning_horizon',
      blocking: true,
      factId: null,
    });
  }

  if (params.graph.planningWindows.length > 1) {
    issues.push({
      domain: 'planning_horizon',
      code: 'ambiguous_planning_window',
      blocking: true,
      factId: null,
      details: { planningWindowCount: params.graph.planningWindows.length },
    });
  }
  return issues;
}

function relationCompilation(params: {
  graph: WeeklyPlanningFactGraphV2;
  issues: GenericSchedulerInputIssue[];
}): GenericSchedulerTaskRelation[] {
  const taskIds = new Set(params.graph.tasks.map((task) => task.id));
  const relations: GenericSchedulerTaskRelation[] = [];
  for (const relation of params.graph.relations) {
    if (!taskIds.has(relation.fromTaskId) || !taskIds.has(relation.toTaskId)) {
      params.issues.push({
        domain: 'relation',
        code: 'orphan_relation_task',
        blocking: true,
        factId: relation.id,
        details: {
          fromTaskExists: taskIds.has(relation.fromTaskId),
          toTaskExists: taskIds.has(relation.toTaskId),
        },
      });
      continue;
    }
    if (relation.fromTaskId === relation.toTaskId) {
      params.issues.push({
        domain: 'relation',
        code: 'self_relation',
        blocking: true,
        factId: relation.id,
      });
      continue;
    }
    relations.push({
      factId: relation.id,
      kind: relation.kind,
      fromTaskId: relation.fromTaskId,
      toTaskId: relation.toTaskId,
    });
  }
  return relations;
}

function collectSourceFactRefs(params: {
  graph: WeeklyPlanningFactGraphV2;
  movableWorkItems: GenericPlanningWorkItem[];
  reservations: TaskCommitmentReservation[];
  windows: AvailabilityWindowFact[];
  selections: ConstraintSourceSelectionFact[];
  relations: GenericSchedulerTaskRelation[];
}): string[] {
  const refs = new Set<string>();
  for (const fact of params.graph.planningWindows) refs.add(fact.id);
  for (const item of params.movableWorkItems) {
    for (const ref of item.sourceFactRefs) refs.add(ref);
  }
  for (const reservation of params.reservations) {
    refs.add(reservation.taskId);
    refs.add(reservation.temporalConstraintFactId);
  }
  for (const window of params.windows) refs.add(window.sourceRef);
  for (const selection of params.selections) refs.add(selection.requestFactId);
  for (const relation of params.relations) refs.add(relation.factId);
  return [...refs].sort();
}

export function compileGenericSchedulerInput(params: {
  graph: WeeklyPlanningFactGraphV2;
  context: GenericSchedulerInputContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
}): GenericSchedulerInputCompilationResult {
  const issues: GenericSchedulerInputIssue[] = validateHorizon(params);

  const work = compileGenericPlanningWorkItems(projectGraphToV1(params.graph));
  issues.push(...work.issues.map((issue): GenericSchedulerInputIssue => ({
    domain: 'work_item',
    code: issue.code,
    blocking: issue.blocking,
    factId: issue.workloadFactId,
    details: issue.details,
  })));

  const commitments = resolveWeeklyPlanningTaskCommitments({
    graph: params.graph,
    context: {
      currentDate: params.context.currentDate,
      planningStartDate: params.context.planningStartDate,
      planningEndDate: params.context.planningEndDate,
      timeZone: params.context.timeZone,
    },
  });
  issues.push(...commitments.issues.map((issue): GenericSchedulerInputIssue => ({
    domain: 'commitment',
    code: issue.code,
    blocking: issue.blocking,
    factId: issue.temporalConstraintFactId,
    details: {
      taskId: issue.taskId,
      ...(issue.details ?? {}),
    },
  })));

  const availability = resolveWeeklyPlanningAvailability({
    graph: params.graph,
    context: params.context,
    externalSources: params.externalSources,
  });
  issues.push(...availability.issues.map((issue): GenericSchedulerInputIssue => ({
    domain: 'availability',
    code: issue.code,
    blocking: issue.blocking,
    factId: issue.sourceFactId,
    details: issue.details,
  })));

  const fixedTaskIds = new Set(
    commitments.reservations.map((reservation) => reservation.taskId),
  );
  const movableWorkItems = work.items.filter((item) => {
    if (!fixedTaskIds.has(item.taskId)) return true;
    issues.push({
      domain: 'deduplication',
      code: 'fixed_task_movable_work_suppressed',
      blocking: false,
      factId: item.workloadFactId,
      details: {
        taskId: item.taskId,
        workItemId: item.id,
      },
    });
    return false;
  });

  const relations = relationCompilation({ graph: params.graph, issues });
  const blocking = issues.some((issue) => issue.blocking);
  if (blocking) {
    return {
      status: 'needs_resolution',
      input: null,
      issues,
    };
  }

  if (movableWorkItems.length === 0 && commitments.reservations.length === 0) {
    return {
      status: 'empty',
      input: null,
      issues,
    };
  }

  const input: GenericSchedulerInput = {
    version: GENERIC_SCHEDULER_INPUT_VERSION,
    graphRevision: params.graph.revision,
    ownerId: params.context.ownerId,
    horizon: {
      startDate: params.context.planningStartDate,
      endDate: params.context.planningEndDate,
      timeZone: params.context.timeZone,
      planningWindowFactIds: params.graph.planningWindows.map((fact) => fact.id),
    },
    movableWorkItems,
    fixedTaskReservations: commitments.reservations,
    availabilityWindows: availability.windows,
    sourceSelections: availability.sourceSelections,
    relations,
    sourceFactRefs: collectSourceFactRefs({
      graph: params.graph,
      movableWorkItems,
      reservations: commitments.reservations,
      windows: availability.windows,
      selections: availability.sourceSelections,
      relations,
    }),
  };

  return {
    status: 'ready',
    input,
    issues,
  };
}
