import type {
  EffortEstimateFact,
  PlanningTaskFact,
  StudyComponentFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { SemanticWorkloadUnitCode } from './weeklyPlanningSemanticDocument';

export const GENERIC_WORK_ITEM_VERSION = 'weekly-planning-generic-work-item-v1' as const;

export interface WeeklyPlanningGenericWorkGraphView {
  readonly tasks: ReadonlyArray<PlanningTaskFact>;
  readonly components: ReadonlyArray<StudyComponentFact>;
  readonly workloads: ReadonlyArray<WorkloadFact>;
  readonly effortEstimates: ReadonlyArray<EffortEstimateFact>;
}

export interface GenericWorkItemQuantity {
  amount: number;
  unitCode: SemanticWorkloadUnitCode;
  unitLabel: string;
  ordinalRange: {
    start: number;
    end: number;
  } | null;
  actualRange: {
    start: string;
    end: string;
  } | null;
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
  estimateSourceFactIds: string[];
  splitPolicy: 'splittable' | 'atomic' | 'unknown';
  periodExpression: string | null;
  sourceFactRefs: string[];
}

export type GenericWorkItemIssueCode =
  | 'quantity_role_unresolved'
  | 'missing_effort_estimate'
  | 'ambiguous_effort_estimate'
  | 'non_integral_discrete_amount'
  | 'invalid_actual_range'
  | 'orphan_workload'
  | 'completed_workload_skipped';

export interface GenericWorkItemIssue {
  code: GenericWorkItemIssueCode;
  workloadFactId: string;
  blocking: boolean;
  details?: Record<string, string | number | boolean | null>;
}

export interface GenericWorkItemCompilationResult {
  items: GenericPlanningWorkItem[];
  issues: GenericWorkItemIssue[];
  readiness: 'ready' | 'needs_resolution' | 'empty';
}

const DISCRETE_UNITS = new Set<SemanticWorkloadUnitCode>([
  'page',
  'problem',
  'word',
  'lesson',
  'chapter',
  'section',
  'exam_year',
  'mock_exam',
  'session',
]);

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

function taskById(
  graph: WeeklyPlanningGenericWorkGraphView,
): Map<string, PlanningTaskFact> {
  return new Map(graph.tasks.map((task) => [task.id, task]));
}

function componentById(
  graph: WeeklyPlanningGenericWorkGraphView,
): Map<string, StudyComponentFact> {
  return new Map(graph.components.map((component) => [component.id, component]));
}

function buildLabel(params: {
  task: PlanningTaskFact;
  component: StudyComponentFact | null;
  workload: WorkloadFact;
}): string {
  const targetLabel = params.component?.label ?? params.task.title;
  const range = params.workload.rangeStart && params.workload.rangeEnd
    ? `（${params.workload.rangeStart}〜${params.workload.rangeEnd}）`
    : '';
  return `${targetLabel} ${params.workload.amount}${params.workload.unitLabel}${range}`;
}

function ordinalRange(workload: WorkloadFact): GenericWorkItemQuantity['ordinalRange'] {
  if (!DISCRETE_UNITS.has(workload.unitCode) || !Number.isInteger(workload.amount)) {
    return null;
  }
  return { start: 1, end: workload.amount };
}

function actualRange(workload: WorkloadFact): GenericWorkItemQuantity['actualRange'] {
  if (!workload.rangeStart || !workload.rangeEnd) return null;
  return { start: workload.rangeStart, end: workload.rangeEnd };
}

/*
 * Exact reference matching only. The semantic AI has already selected the
 * target. Scheduler compilation must not infer a target from labels or source
 * text; it accepts only the task, component, or exact workload ID.
 */
function targetMatches(
  estimate: EffortEstimateFact,
  workload: WorkloadFact,
): boolean {
  return estimate.taskId === workload.taskId
    && (estimate.targetFactId === workload.id
      || estimate.targetFactId === workload.taskId
      || estimate.targetFactId === workload.componentId);
}

interface EstimateResolution {
  estimatedMinutes: number | null;
  sourceFactIds: string[];
  ambiguous: boolean;
}

function resolveEstimatedMinutes(params: {
  workload: WorkloadFact;
  estimates: ReadonlyArray<EffortEstimateFact>;
}): EstimateResolution {
  const workload = params.workload;

  if (workload.unitCode === 'minute') {
    return { estimatedMinutes: workload.amount, sourceFactIds: [], ambiguous: false };
  }
  if (workload.unitCode === 'hour') {
    return { estimatedMinutes: workload.amount * 60, sourceFactIds: [], ambiguous: false };
  }

  const matching = params.estimates.filter((estimate) => targetMatches(estimate, workload));
  const perUnit = matching.filter((estimate) =>
    estimate.kind === 'duration_per_unit' && estimate.unitCode === workload.unitCode);
  if (perUnit.length === 1) {
    return {
      estimatedMinutes: perUnit[0].minutes * workload.amount,
      sourceFactIds: [perUnit[0].id],
      ambiguous: false,
    };
  }
  if (perUnit.length > 1) {
    return {
      estimatedMinutes: null,
      sourceFactIds: perUnit.map((value) => value.id),
      ambiguous: true,
    };
  }

  const total = matching.filter((estimate) => estimate.kind === 'total_duration');
  if (total.length === 1) {
    return {
      estimatedMinutes: total[0].minutes,
      sourceFactIds: [total[0].id],
      ambiguous: false,
    };
  }
  if (total.length > 1) {
    return {
      estimatedMinutes: null,
      sourceFactIds: total.map((value) => value.id),
      ambiguous: true,
    };
  }

  const session = matching.filter((estimate) => estimate.kind === 'session_duration');
  if (workload.unitCode === 'session' && session.length === 1) {
    return {
      estimatedMinutes: session[0].minutes * workload.amount,
      sourceFactIds: [session[0].id],
      ambiguous: false,
    };
  }
  if (workload.unitCode === 'session' && session.length > 1) {
    return {
      estimatedMinutes: null,
      sourceFactIds: session.map((value) => value.id),
      ambiguous: true,
    };
  }

  return { estimatedMinutes: null, sourceFactIds: [], ambiguous: false };
}

function deriveSplitPolicy(workload: WorkloadFact): GenericPlanningWorkItem['splitPolicy'] {
  if (workload.unitCode === 'minute' || workload.unitCode === 'hour') return 'splittable';
  if (workload.unitCode === 'mock_exam') return 'atomic';
  return 'unknown';
}

export function compileGenericPlanningWorkItems(
  graph: WeeklyPlanningGenericWorkGraphView,
): GenericWorkItemCompilationResult {
  const tasks = taskById(graph);
  const components = componentById(graph);
  const items: GenericPlanningWorkItem[] = [];
  const issues: GenericWorkItemIssue[] = [];

  for (const workload of graph.workloads) {
    const task = tasks.get(workload.taskId);
    const component = workload.componentId ? components.get(workload.componentId) ?? null : null;
    if (!task || (workload.componentId && !component)) {
      issues.push({
        code: 'orphan_workload',
        workloadFactId: workload.id,
        blocking: true,
      });
      continue;
    }

    if (workload.quantityRole === 'completed') {
      issues.push({
        code: 'completed_workload_skipped',
        workloadFactId: workload.id,
        blocking: false,
      });
      continue;
    }

    const unresolvedRole = workload.quantityRole === 'declared'
      || workload.quantityRole === 'unknown';
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
      issues.push({
        code: 'invalid_actual_range',
        workloadFactId: workload.id,
        blocking: true,
      });
    }

    const estimate = resolveEstimatedMinutes({
      workload,
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
      issues.push({
        code: 'missing_effort_estimate',
        workloadFactId: workload.id,
        blocking: true,
      });
    }

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
      estimatedMinutes: estimate.estimatedMinutes,
      estimateSourceFactIds: estimate.sourceFactIds,
      splitPolicy: deriveSplitPolicy(workload),
      periodExpression: workload.periodExpression,
      sourceFactRefs: [
        workload.taskId,
        ...(workload.componentId ? [workload.componentId] : []),
        workload.id,
        ...estimate.sourceFactIds,
      ],
    });
  }

  const blocking = issues.some((issue) => issue.blocking);
  return {
    items,
    issues,
    readiness: items.length === 0
      ? 'empty'
      : blocking
        ? 'needs_resolution'
        : 'ready',
  };
}
