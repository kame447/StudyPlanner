import type {
  EffortEstimateFact,
  PlanningTaskFact,
  StudyComponentFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';
import {
  allocateWeeklyPlanningEffort,
  type WeeklyPlanningAllocationStepMinutes,
} from './weeklyPlanningEffortAllocation';
import {
  findObservedPaceEvidenceQuestionTarget,
  resolveGenericWorkItemEstimate,
  type GenericWorkItemEstimateBasis,
  type GenericWorkItemEstimateResolution,
} from './weeklyPlanningGenericWorkEstimation';

export type { GenericWorkItemEstimateBasis } from './weeklyPlanningGenericWorkEstimation';

export const GENERIC_WORK_ITEM_VERSION = 'weekly-planning-generic-work-item-v1' as const;

export type GenericWorkloadFact = WorkloadFact | (Omit<WorkloadFact, 'quantityRole'> & {
  quantityRole: 'scope_total';
});

export interface WeeklyPlanningGenericWorkGraphView {
  readonly tasks: ReadonlyArray<PlanningTaskFact>;
  readonly components: ReadonlyArray<StudyComponentFact>;
  readonly workloads: ReadonlyArray<GenericWorkloadFact>;
  readonly effortEstimates: ReadonlyArray<EffortEstimateFact>;
}

export interface GenericWorkItemQuantity {
  amount: number;
  unitCode: SemanticWorkloadUnitCode;
  unitLabel: string;
  ordinalRange: { start: number; end: number } | null;
  actualRange: { start: string; end: string } | null;
}

export interface GenericPlanningWorkSession {
  kind: 'learning';
  quantityAmount: number;
  quantityUnitCode: SemanticWorkloadUnitCode;
  quantityUnitLabel: string;
  baseDurationMinutes: number;
  durationMinutes: number;
  label: string;
}

export interface GenericPlanningWorkItem {
  version: typeof GENERIC_WORK_ITEM_VERSION;
  id: string;
  taskId: string;
  componentId: string | null;
  workloadFactId: string;
  label: string;
  quantityRole: WorkloadFact['quantityRole'];
  actionability: 'actionable' | 'needs_resolution';
  quantity: GenericWorkItemQuantity;
  estimatedMinutes: number | null;
  baseEstimatedMinutes?: number | null;
  calibrationMultiplier?: number | null;
  roundingStepMinutes?: WeeklyPlanningAllocationStepMinutes | null;
  estimateBasis: GenericWorkItemEstimateBasis | null;
  estimateSourceFactIds: string[];
  estimateSourceWorkloadFactIds: string[];
  plannedSessions?: GenericPlanningWorkSession[];
  splitPolicy: 'splittable' | 'atomic' | 'unknown';
  periodExpression: string | null;
  requiredDate?: string | null;
  sourceFactRefs: string[];
}

export type GenericWorkItemIssueCode =
  | 'quantity_role_unresolved'
  | 'missing_effort_estimate'
  | 'ambiguous_effort_estimate'
  | 'non_integral_discrete_amount'
  | 'invalid_actual_range'
  | 'orphan_workload'
  | 'scope_total_workload_skipped'
  | 'completed_workload_skipped'
  | 'remaining_workload_skipped_for_target';

export interface GenericWorkItemIssue {
  code: GenericWorkItemIssueCode;
  workloadFactId: string;
  questionTargetWorkloadFactId?: string;
  blocking: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface GenericWorkItemCompilationResult {
  items: GenericPlanningWorkItem[];
  issues: GenericWorkItemIssue[];
  readiness: 'ready' | 'needs_resolution' | 'empty';
}

const DISCRETE_UNITS = new Set<SemanticWorkloadUnitCode>([
  'page', 'problem', 'word', 'lesson', 'chapter', 'section',
  'exam_year', 'mock_exam', 'session',
]);

function isPlanningWorkload(workload: GenericWorkloadFact): workload is WorkloadFact {
  return workload.quantityRole !== 'scope_total';
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createWorkItemId(workloadFactId: string): string {
  return `wpwi_${stableHash(`${GENERIC_WORK_ITEM_VERSION}|${workloadFactId}`)}`;
}

function taskById(graph: WeeklyPlanningGenericWorkGraphView): Map<string, PlanningTaskFact> {
  return new Map(graph.tasks.map((task) => [task.id, task]));
}

function componentById(graph: WeeklyPlanningGenericWorkGraphView): Map<string, StudyComponentFact> {
  return new Map(graph.components.map((component) => [component.id, component]));
}

function planningScopeKey(workload: GenericWorkloadFact): string {
  return [
    workload.taskId,
    workload.componentId ?? '',
    workload.unitCode,
  ].join('|');
}

function workloadsByPlanningScope(
  workloads: ReadonlyArray<WorkloadFact>,
  quantityRole: 'target' | 'remaining',
): Map<string, WorkloadFact[]> {
  const grouped = new Map<string, WorkloadFact[]>();
  for (const workload of workloads) {
    if (workload.quantityRole !== quantityRole) continue;
    const key = planningScopeKey(workload);
    grouped.set(key, [...(grouped.get(key) ?? []), workload]);
  }
  return grouped;
}

function targetLabel(params: {
  task: PlanningTaskFact;
  component: StudyComponentFact | null;
}): string {
  return params.component?.label ?? params.task.title;
}

function buildLabel(params: {
  task: PlanningTaskFact;
  component: StudyComponentFact | null;
  workload: WorkloadFact;
}): string {
  const label = targetLabel(params);
  const range = params.workload.rangeStart && params.workload.rangeEnd
    ? `（${params.workload.rangeStart}〜${params.workload.rangeEnd}）`
    : '';
  return `${label} ${params.workload.amount}${params.workload.unitLabel}${range}`;
}

function ordinalRange(workload: WorkloadFact): GenericWorkItemQuantity['ordinalRange'] {
  if (!DISCRETE_UNITS.has(workload.unitCode) || !Number.isInteger(workload.amount)) return null;
  return { start: 1, end: workload.amount };
}

function actualRange(workload: WorkloadFact): GenericWorkItemQuantity['actualRange'] {
  if (!workload.rangeStart || !workload.rangeEnd) return null;
  return { start: workload.rangeStart, end: workload.rangeEnd };
}

function deriveSplitPolicy(workload: WorkloadFact): GenericPlanningWorkItem['splitPolicy'] {
  if (workload.unitCode === 'minute' || workload.unitCode === 'hour') return 'splittable';
  if (workload.unitCode === 'mock_exam') return 'atomic';
  return 'unknown';
}

function sourceFactRefs(params: {
  workload: WorkloadFact;
  estimate: GenericWorkItemEstimateResolution;
  relatedWorkloadFactIds?: ReadonlyArray<string>;
}): string[] {
  return [
    params.workload.taskId,
    ...(params.workload.componentId ? [params.workload.componentId] : []),
    params.workload.id,
    ...(params.relatedWorkloadFactIds ?? []),
    ...params.estimate.sourceWorkloadFactIds,
    ...params.estimate.sourceFactIds,
  ];
}

export function compileGenericPlanningWorkItems(
  graph: WeeklyPlanningGenericWorkGraphView,
): GenericWorkItemCompilationResult {
  const tasks = taskById(graph);
  const components = componentById(graph);
  const items: GenericPlanningWorkItem[] = [];
  const issues: GenericWorkItemIssue[] = [];
  const planningWorkloads = graph.workloads.filter(isPlanningWorkload);
  const targetWorkloadsByScope = workloadsByPlanningScope(planningWorkloads, 'target');
  const remainingWorkloadsByScope = workloadsByPlanningScope(planningWorkloads, 'remaining');

  for (const candidate of graph.workloads) {
    const task = tasks.get(candidate.taskId);
    const component = candidate.componentId ? components.get(candidate.componentId) ?? null : null;
    if (!task || (candidate.componentId && !component)) {
      issues.push({ code: 'orphan_workload', workloadFactId: candidate.id, blocking: true });
      continue;
    }
    if (candidate.quantityRole === 'scope_total') {
      issues.push({
        code: 'scope_total_workload_skipped',
        workloadFactId: candidate.id,
        blocking: false,
      });
      continue;
    }
    const workload: WorkloadFact = candidate;
    if (workload.quantityRole === 'completed') {
      issues.push({ code: 'completed_workload_skipped', workloadFactId: workload.id, blocking: false });
      continue;
    }
    const scopeKey = planningScopeKey(workload);
    const targetWorkloads = targetWorkloadsByScope.get(scopeKey) ?? [];
    if (workload.quantityRole === 'remaining' && targetWorkloads.length > 0) {
      issues.push({
        code: 'remaining_workload_skipped_for_target',
        workloadFactId: workload.id,
        blocking: false,
        details: {
          targetWorkloadFactId: targetWorkloads.length === 1 ? targetWorkloads[0].id : null,
          targetWorkloadCount: targetWorkloads.length,
        },
      });
      continue;
    }
    const relatedWorkloadFactIds = workload.quantityRole === 'target'
      ? (remainingWorkloadsByScope.get(scopeKey) ?? []).map((fact) => fact.id)
      : [];

    const unresolvedRole = workload.quantityRole === 'declared' || workload.quantityRole === 'unknown';
    if (unresolvedRole) {
      issues.push({
        code: 'quantity_role_unresolved',
        workloadFactId: workload.id,
        blocking: true,
        details: { quantityRole: workload.quantityRole },
      });
    }
    if (DISCRETE_UNITS.has(workload.unitCode) && !Number.isInteger(workload.amount)) {
      issues.push({
        code: 'non_integral_discrete_amount',
        workloadFactId: workload.id,
        blocking: true,
        details: { amount: workload.amount, unitCode: workload.unitCode },
      });
    }
    const range = actualRange(workload);
    if ((workload.rangeStart === null) !== (workload.rangeEnd === null)) {
      issues.push({ code: 'invalid_actual_range', workloadFactId: workload.id, blocking: true });
    }

    const estimate = resolveGenericWorkItemEstimate({
      workload,
      workloads: planningWorkloads,
      estimates: graph.effortEstimates,
    });
    if (estimate.ambiguous) {
      issues.push({
        code: 'ambiguous_effort_estimate',
        workloadFactId: workload.id,
        blocking: true,
        details: { matchingEstimateCount: estimate.sourceFactIds.length },
      });
    } else if (estimate.estimatedMinutes === null) {
      const observedPaceTarget = findObservedPaceEvidenceQuestionTarget({
        workload,
        workloads: planningWorkloads,
        estimates: graph.effortEstimates,
      });
      issues.push({
        code: 'missing_effort_estimate',
        workloadFactId: workload.id,
        ...(observedPaceTarget
          ? {
              questionTargetWorkloadFactId: observedPaceTarget.id,
              details: {
                estimateForWorkloadFactId: workload.id,
                questionBasis: 'completed_workload_total',
              },
            }
          : {}),
        blocking: true,
      });
    }

    const allocation = estimate.estimatedMinutes === null
      ? null
      : allocateWeeklyPlanningEffort({
          baseEstimateMinutes: estimate.estimatedMinutes,
          safetyBufferMultiplier: estimate.basis === 'intrinsic_duration' ? 1 : undefined,
        });

    items.push({
      version: GENERIC_WORK_ITEM_VERSION,
      id: createWorkItemId(workload.id),
      taskId: workload.taskId,
      componentId: workload.componentId,
      workloadFactId: workload.id,
      label: buildLabel({ task, component, workload }),
      quantityRole: workload.quantityRole,
      actionability: unresolvedRole ? 'needs_resolution' : 'actionable',
      quantity: {
        amount: workload.amount,
        unitCode: workload.unitCode,
        unitLabel: workload.unitLabel,
        ordinalRange: ordinalRange(workload),
        actualRange: range,
      },
      estimatedMinutes: allocation?.allocationMinutes ?? null,
      baseEstimatedMinutes: estimate.estimatedMinutes,
      calibrationMultiplier: allocation?.calibrationMultiplier ?? null,
      roundingStepMinutes: allocation?.roundingStepMinutes ?? null,
      estimateBasis: estimate.basis,
      estimateSourceFactIds: estimate.sourceFactIds,
      estimateSourceWorkloadFactIds: estimate.sourceWorkloadFactIds,
      splitPolicy: deriveSplitPolicy(workload),
      periodExpression: workload.periodExpression,
      sourceFactRefs: sourceFactRefs({
        workload,
        estimate,
        relatedWorkloadFactIds,
      }),
    });
  }

  const blocking = issues.some((issue) => issue.blocking);
  return {
    items,
    issues,
    readiness: items.length === 0 ? 'empty' : blocking ? 'needs_resolution' : 'ready',
  };
}
