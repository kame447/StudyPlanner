import type {
  PlanningWindowFact,
  TaskRelationFact,
} from './weeklyPlanningFactGraph';
import type {
  AvailabilityDeclarationFactV5,
  ConstraintSourceRequestFactV5,
  UncertaintyFactV5,
} from './weeklyPlanningFactGraphV5';
import {
  compileGenericPlanningWorkItems,
  type GenericPlanningWorkItem,
  type GenericWorkItemIssue,
  type WeeklyPlanningGenericWorkGraphView,
} from './weeklyPlanningGenericWorkItems';
import {
  calibrateGenericPlanningWorkItemsV5,
} from './weeklyPlanningGenericWorkItemCalibrationV5';
import {
  getWeeklyPlanningEstimateCalibrationRuntimeV5,
} from '../personalization/weeklyPlanningEstimateCalibrationRuntimeV5';
import {
  type AvailabilityResolutionContext,
  type AvailabilityResolutionIssue,
  type AvailabilityWindowFact,
  type ConstraintSourceSelectionFact,
  type ExternalConstraintSourceSnapshot,
} from './weeklyPlanningAvailabilityResolver';
import {
  resolveWeeklyPlanningAvailabilityWithFullDayRules,
} from './weeklyPlanningAvailabilityFullDayAdapter';
import {
  createWeeklyPlanningAvailabilityResolverGraphV5,
} from './weeklyPlanningSchedulerAvailabilityProjectionV5';
import type {
  TaskCommitmentReservation,
  TaskCommitmentResolutionIssue,
} from './weeklyPlanningTaskCommitmentResolver';
import {
  resolveWeeklyPlanningTaskCommitmentsWithDateRules,
  type WeeklyPlanningTaskCommitmentDateRuleGraphView,
} from './weeklyPlanningTaskCommitmentDateRuleAdapter';
import type {
  ResolvedTaskDateEligibility,
  TaskDateRuleResolutionIssue,
} from './weeklyPlanningTaskDateRuleResolver';
import { isValidCalendarDate } from './weeklyPlanningCalendarResolver';
import {
  distributeGenericSchedulerWorkItemsV5,
} from './weeklyPlanningSchedulerWorkDistributionV5';
import {
  detectWeeklyPlanningRelationCycleV5,
} from './weeklyPlanningRelationCycleV5';

export const GENERIC_SCHEDULER_INPUT_VERSION =
  'weekly-planning-generic-scheduler-input-v2' as const;

export type WeeklyPlanningGenericSchedulerGraphView =
  WeeklyPlanningGenericWorkGraphView
  & WeeklyPlanningTaskCommitmentDateRuleGraphView
  & {
    readonly revision: number;
    readonly availabilityDeclarations: ReadonlyArray<AvailabilityDeclarationFactV5>;
    readonly constraintSourceRequests: ReadonlyArray<ConstraintSourceRequestFactV5>;
    readonly planningWindows: ReadonlyArray<PlanningWindowFact>;
    readonly relations: ReadonlyArray<TaskRelationFact>;
    readonly uncertainties: ReadonlyArray<UncertaintyFactV5>;
  };

export interface GenericSchedulerObservedEstimateOverride {
  workloadFactId: string;
  estimatedMinutes: number;
  evidenceKind: 'observed_memory_pace';
  observationCount: number;
}

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
  taskDateEligibilities: ResolvedTaskDateEligibility[];
  availabilityWindows: AvailabilityWindowFact[];
  sourceSelections: ConstraintSourceSelectionFact[];
  relations: GenericSchedulerTaskRelation[];
  sourceFactRefs: string[];
}

export type GenericSchedulerInputIssue =
  | {
      domain: 'semantic_uncertainty';
      code: 'semantic_uncertainty';
      blocking: true;
      factId: string;
      details: {
        targetFactId: string | null;
        field: string;
        reason: string;
        sourceText: string;
      };
    }
  | {
      domain: 'planning_horizon';
      code: 'invalid_planning_horizon' | 'ambiguous_planning_window';
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
      domain: 'task_date_rule';
      code: TaskDateRuleResolutionIssue['code'];
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
      code: 'orphan_relation_task' | 'self_relation' | 'relation_cycle';
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

export type GenericSchedulerInputContext = AvailabilityResolutionContext;

function semanticUncertaintyIssues(
  graph: WeeklyPlanningGenericSchedulerGraphView,
): GenericSchedulerInputIssue[] {
  return graph.uncertainties.map((uncertainty) => ({
    domain: 'semantic_uncertainty' as const,
    code: 'semantic_uncertainty' as const,
    blocking: true as const,
    factId: uncertainty.id,
    details: {
      targetFactId: uncertainty.targetFactId,
      field: uncertainty.field,
      reason: uncertainty.reason,
      sourceText: uncertainty.source.sourceText,
    },
  }));
}

function validateHorizon(params: {
  graph: WeeklyPlanningGenericSchedulerGraphView;
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
      code: 'ambiguous_planning_horizon',
      blocking: true,
      factId: null,
      details: { planningWindowCount: params.graph.planningWindows.length },
    } as GenericSchedulerInputIssue);
  }
  return issues;
}

function compileRelations(params: {
  graph: WeeklyPlanningGenericSchedulerGraphView;
  issues: GenericSchedulerInputIssue[];
}): GenericSchedulerTaskRelation[] {
  const taskIds = new Set(params.graph.tasks.map((task) => task.id));
  const relations: GenericSchedulerTaskRelation[] = [];
  const validFacts: TaskRelationFact[] = [];
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
    validFacts.push(relation);
    relations.push({
      factId: relation.id,
      kind: relation.kind,
      fromTaskId: relation.fromTaskId,
      toTaskId: relation.toTaskId,
    });
  }
  const cycle = detectWeeklyPlanningRelationCycleV5(validFacts);
  if (cycle) {
    params.issues.push({
      domain: 'relation',
      code: 'relation_cycle',
      blocking: true,
      factId: cycle.relationFactIds[0] ?? validFacts[0]?.id ?? 'relation-cycle',
      details: {
        relationFactIds: cycle.relationFactIds.join(','),
        taskIds: cycle.taskIds.join(','),
      },
    });
  }
  return relations;
}

function collectSourceFactRefs(params: {
  graph: WeeklyPlanningGenericSchedulerGraphView;
  movableWorkItems: GenericPlanningWorkItem[];
  reservations: TaskCommitmentReservation[];
  taskDateEligibilities: ResolvedTaskDateEligibility[];
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
  for (const eligibility of params.taskDateEligibilities) {
    refs.add(eligibility.taskId);
    for (const ref of eligibility.sourceFactIds) refs.add(ref);
  }
  for (const window of params.windows) refs.add(window.sourceRef);
  for (const selection of params.selections) refs.add(selection.requestFactId);
  for (const relation of params.relations) refs.add(relation.factId);
  return [...refs].sort();
}

function uniqueObservedEstimateOverrides(
  overrides: readonly GenericSchedulerObservedEstimateOverride[],
): Map<string, GenericSchedulerObservedEstimateOverride> {
  const grouped = new Map<string, GenericSchedulerObservedEstimateOverride[]>();
  overrides.forEach((override) => {
    if (
      !override.workloadFactId.trim()
      || !Number.isFinite(override.estimatedMinutes)
      || override.estimatedMinutes <= 0
      || !Number.isFinite(override.observationCount)
      || override.observationCount <= 0
    ) return;
    grouped.set(override.workloadFactId, [
      ...(grouped.get(override.workloadFactId) ?? []),
      override,
    ]);
  });
  return new Map(
    [...grouped.entries()]
      .filter(([, values]) => values.length === 1)
      .map(([workloadFactId, values]) => [workloadFactId, values[0]]),
  );
}

function applyObservedEstimateOverrides(params: {
  items: readonly GenericPlanningWorkItem[];
  overrides: readonly GenericSchedulerObservedEstimateOverride[];
}): {
  items: GenericPlanningWorkItem[];
  appliedWorkloadFactIds: Set<string>;
} {
  const overrides = uniqueObservedEstimateOverrides(params.overrides);
  const appliedWorkloadFactIds = new Set<string>();
  const items = params.items.map((item) => {
    if (item.estimatedMinutes !== null) return { ...item };
    const override = overrides.get(item.workloadFactId);
    if (!override) return { ...item };
    appliedWorkloadFactIds.add(item.workloadFactId);
    return {
      ...item,
      estimatedMinutes: override.estimatedMinutes,
      baseEstimatedMinutes: override.estimatedMinutes,
      calibrationMultiplier: null,
      roundingStepMinutes: null,
      estimateBasis: 'observed_pace' as const,
      estimateSourceFactIds: [],
      estimateSourceWorkloadFactIds: [],
    };
  });
  return { items, appliedWorkloadFactIds };
}

export function compileGenericSchedulerInput(params: {
  graph: WeeklyPlanningGenericSchedulerGraphView;
  context: GenericSchedulerInputContext;
  externalSources?: ExternalConstraintSourceSnapshot[];
  estimateCalibrationMultiplier?: number | null;
  observedEstimateOverrides?: readonly GenericSchedulerObservedEstimateOverride[];
}): GenericSchedulerInputCompilationResult {
  const issues: GenericSchedulerInputIssue[] = [
    ...semanticUncertaintyIssues(params.graph),
    ...validateHorizon(params),
  ];

  const commitmentResolution = resolveWeeklyPlanningTaskCommitmentsWithDateRules({
    graph: params.graph,
    context: {
      currentDate: params.context.currentDate,
      planningStartDate: params.context.planningStartDate,
      planningEndDate: params.context.planningEndDate,
      timeZone: params.context.timeZone,
    },
  });
  const commitments = commitmentResolution.commitments;
  const taskDateRules = commitmentResolution.dateRules;
  issues.push(...taskDateRules.issues.map((issue): GenericSchedulerInputIssue => ({
    domain: 'task_date_rule',
    code: issue.code,
    blocking: issue.blocking,
    factId: issue.taskDateRuleFactId,
    details: {
      taskId: issue.taskId,
      ...(issue.details ?? {}),
    },
  })));
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

  const fixedTaskIds = new Set([
    ...commitments.reservations.map((reservation) => reservation.taskId),
    ...params.graph.temporalConstraints
      .filter((constraint) =>
        constraint.kind === 'fixed_interval' && constraint.constraintLevel === 'hard')
      .map((constraint) => constraint.taskId),
  ]);
  const workloadTaskById = new Map(
    params.graph.workloads.map((workload) => [workload.id, workload.taskId]),
  );

  const work = compileGenericPlanningWorkItems(params.graph);
  const aggregateMovableWorkItems = work.items.filter((item) => {
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
  const runtimeCalibration = getWeeklyPlanningEstimateCalibrationRuntimeV5(
    params.context.ownerId,
  );
  const calibratedAggregateMovableWorkItems = calibrateGenericPlanningWorkItemsV5({
    items: aggregateMovableWorkItems,
    calibrationMultiplier: params.estimateCalibrationMultiplier
      ?? runtimeCalibration?.multiplier
      ?? null,
  });
  const observedEstimateApplication = applyObservedEstimateOverrides({
    items: calibratedAggregateMovableWorkItems,
    overrides: params.observedEstimateOverrides ?? [],
  });

  for (const issue of work.issues) {
    const issueTaskId = workloadTaskById.get(issue.workloadFactId);
    if (issueTaskId && fixedTaskIds.has(issueTaskId)) continue;
    if (
      issue.code === 'missing_effort_estimate'
      && observedEstimateApplication.appliedWorkloadFactIds.has(issue.workloadFactId)
    ) continue;
    issues.push({
      domain: 'work_item',
      code: issue.code,
      blocking: issue.blocking,
      factId: issue.questionTargetWorkloadFactId ?? issue.workloadFactId,
      details: issue.details,
    });
  }

  const availability = resolveWeeklyPlanningAvailabilityWithFullDayRules({
    graph: createWeeklyPlanningAvailabilityResolverGraphV5({
      revision: params.graph.revision,
      availabilityDeclarations: params.graph.availabilityDeclarations,
      constraintSourceRequests: params.graph.constraintSourceRequests,
    }),
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

  const relations = compileRelations({ graph: params.graph, issues });
  const blocking = issues.some((issue) => issue.blocking);
  if (blocking) {
    return { status: 'needs_resolution', input: null, issues };
  }

  const movableTasksWithoutWorkload = params.graph.tasks.filter((task) =>
    !fixedTaskIds.has(task.id)
    && !params.graph.workloads.some((workload) => workload.taskId === task.id));
  if (movableTasksWithoutWorkload.length > 0) {
    return { status: 'needs_resolution', input: null, issues };
  }

  const movableWorkItems = distributeGenericSchedulerWorkItemsV5({
    graph: params.graph,
    items: observedEstimateApplication.items,
    startDate: params.context.planningStartDate,
    endDate: params.context.planningEndDate,
  });

  if (movableWorkItems.length === 0 && commitments.reservations.length === 0) {
    return { status: 'empty', input: null, issues };
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
    taskDateEligibilities: taskDateRules.eligibilities,
    availabilityWindows: availability.windows,
    sourceSelections: availability.sourceSelections,
    relations,
    sourceFactRefs: collectSourceFactRefs({
      graph: params.graph,
      movableWorkItems,
      reservations: commitments.reservations,
      taskDateEligibilities: taskDateRules.eligibilities,
      windows: availability.windows,
      selections: availability.sourceSelections,
      relations,
    }),
  };

  return { status: 'ready', input, issues };
}
