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
import { splitVocabularyIntoLearningSessionsV5 } from './weeklyPlanningEffortQuestionPolicyV5';
import {
  effortEstimateTargetsWorkload,
  resolveGenericWorkItemEstimate,
  type GenericWorkItemEstimateBasis,
  type GenericWorkItemEstimateResolution,
} from './weeklyPlanningGenericWorkEstimation';

export type { GenericWorkItemEstimateBasis } from './weeklyPlanningGenericWorkEstimation';

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
  'page', 'problem', 'word', 'lesson', 'chapter', 'section',
  'exam_year', 'mock_exam', 'session',
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

function createVocabularySessionWorkItemId(
  workloadFactId: string,
  sessionIndex: number,
): string {
  return `wpwi_${stableHash(
    `${GENERIC_WORK_ITEM_VERSION}|${workloadFactId}|vocabulary-session:${sessionIndex}`,
  )}`;
}

function taskById(graph: WeeklyPlanningGenericWorkGraphView): Map<string, PlanningTaskFact> {
  return new Map(graph.tasks.map((task) => [task.id, task]));
}

function componentById(graph: WeeklyPlanningGenericWorkGraphView): Map<string, StudyComponentFact> {
  return new Map(graph.components.map((component) => [component.id, component]));
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

function vocabularySessionActualRange(params: {
  workload: WorkloadFact;
  ordinalStart: number;
  ordinalEnd: number;
}): GenericWorkItemQuantity['actualRange'] {
  if (!params.workload.rangeStart || !params.workload.rangeEnd) return null;
  const start = Number(params.workload.rangeStart);
  const end = Number(params.workload.rangeEnd);
  if (
    !Number.isInteger(start)
    || !Number.isInteger(end)
    || end - start + 1 !== params.workload.amount
  ) {
    return null;
  }
  return {
    start: String(start + params.ordinalStart - 1),
    end: String(start + params.ordinalEnd - 1),
  };
}

function deriveSplitPolicy(workload: WorkloadFact): GenericPlanningWorkItem['splitPolicy'] {
  if (workload.unitCode === 'minute' || workload.unitCode === 'hour') return 'splittable';
  if (workload.unitCode === 'mock_exam') return 'atomic';
  return 'unknown';
}

function compileVocabularySessions(params: {
  task: PlanningTaskFact;
  component: StudyComponentFact | null;
  workload: WorkloadFact;
  estimates: ReadonlyArray<EffortEstimateFact>;
}): {
  sessions: GenericPlanningWorkSession[];
  baseEstimatedMinutes: number;
  estimatedMinutes: number;
  calibrationMultiplier: number;
  roundingStepMinutes: WeeklyPlanningAllocationStepMinutes;
} | null {
  if (params.workload.unitCode !== 'word') return null;
  const matching = params.estimates.filter((estimate) =>
    effortEstimateTargetsWorkload(estimate, params.workload)
    && estimate.kind === 'session_duration'
    && estimate.unitCode === 'word');
  if (matching.length !== 1) return null;
  const quantities = splitVocabularyIntoLearningSessionsV5(params.workload.amount);
  if (quantities.length <= 1) return null;
  const estimate = matching[0];
  const allocation = allocateWeeklyPlanningEffort({ baseEstimateMinutes: estimate.minutes });
  const label = targetLabel(params);
  const sessions = quantities.map((quantity): GenericPlanningWorkSession => ({
    kind: 'learning',
    quantityAmount: quantity,
    quantityUnitCode: 'word',
    quantityUnitLabel: params.workload.unitLabel,
    baseDurationMinutes: estimate.minutes,
    durationMinutes: allocation.allocationMinutes,
    label: `${label} ${quantity}${params.workload.unitLabel}`,
  }));
  return {
    sessions,
    baseEstimatedMinutes: estimate.minutes * sessions.length,
    estimatedMinutes: allocation.allocationMinutes * sessions.length,
    calibrationMultiplier: allocation.calibrationMultiplier,
    roundingStepMinutes: allocation.roundingStepMinutes,
  };
}

function sourceFactRefs(params: {
  workload: WorkloadFact;
  estimate: GenericWorkItemEstimateResolution;
}): string[] {
  return [
    params.workload.taskId,
    ...(params.workload.componentId ? [params.workload.componentId] : []),
    params.workload.id,
    ...params.estimate.sourceWorkloadFactIds,
    ...params.estimate.sourceFactIds,
  ];
}

function compileVocabularySessionWorkItems(params: {
  task: PlanningTaskFact;
  component: StudyComponentFact | null;
  workload: WorkloadFact;
  estimate: GenericWorkItemEstimateResolution;
  vocabularySessions: NonNullable<ReturnType<typeof compileVocabularySessions>>;
  unresolvedRole: boolean;
}): GenericPlanningWorkItem[] {
  let consumedWords = 0;
  const refs = sourceFactRefs({ workload: params.workload, estimate: params.estimate });
  return params.vocabularySessions.sessions.map((session, sessionIndex) => {
    const ordinalStart = consumedWords + 1;
    consumedWords += session.quantityAmount;
    const ordinalEnd = consumedWords;
    const explicitRange = vocabularySessionActualRange({
      workload: params.workload,
      ordinalStart,
      ordinalEnd,
    });
    const sessionMarker = explicitRange
      ? `（${explicitRange.start}〜${explicitRange.end}）`
      : `（${sessionIndex + 1}/${params.vocabularySessions.sessions.length}）`;
    return {
      version: GENERIC_WORK_ITEM_VERSION,
      id: createVocabularySessionWorkItemId(params.workload.id, sessionIndex),
      taskId: params.workload.taskId,
      componentId: params.workload.componentId,
      workloadFactId: params.workload.id,
      label: `${session.label}${sessionMarker}`,
      quantityRole: params.workload.quantityRole,
      actionability: params.unresolvedRole ? 'needs_resolution' : 'actionable',
      quantity: {
        amount: session.quantityAmount,
        unitCode: session.quantityUnitCode,
        unitLabel: session.quantityUnitLabel,
        ordinalRange: { start: ordinalStart, end: ordinalEnd },
        actualRange: explicitRange,
      },
      estimatedMinutes: session.durationMinutes,
      baseEstimatedMinutes: session.baseDurationMinutes,
      calibrationMultiplier: params.vocabularySessions.calibrationMultiplier,
      roundingStepMinutes: params.vocabularySessions.roundingStepMinutes,
      estimateBasis: params.estimate.basis,
      estimateSourceFactIds: params.estimate.sourceFactIds,
      estimateSourceWorkloadFactIds: params.estimate.sourceWorkloadFactIds,
      splitPolicy: 'atomic',
      periodExpression: params.workload.periodExpression,
      sourceFactRefs: [...refs],
    };
  });
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
      issues.push({ code: 'orphan_workload', workloadFactId: workload.id, blocking: true });
      continue;
    }
    if (workload.quantityRole === 'completed') {
      issues.push({ code: 'completed_workload_skipped', workloadFactId: workload.id, blocking: false });
      continue;
    }

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
      workloads: graph.workloads,
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
      issues.push({ code: 'missing_effort_estimate', workloadFactId: workload.id, blocking: true });
    }

    const vocabularySessions = compileVocabularySessions({
      task,
      component,
      workload,
      estimates: graph.effortEstimates,
    });
    if (vocabularySessions) {
      items.push(...compileVocabularySessionWorkItems({
        task,
        component,
        workload,
        estimate,
        vocabularySessions,
        unresolvedRole,
      }));
      continue;
    }

    const allocation = estimate.estimatedMinutes === null
      ? null
      : allocateWeeklyPlanningEffort({ baseEstimateMinutes: estimate.estimatedMinutes });

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
      sourceFactRefs: sourceFactRefs({ workload, estimate }),
    });
  }

  const blocking = issues.some((issue) => issue.blocking);
  return {
    items,
    issues,
    readiness: items.length === 0 ? 'empty' : blocking ? 'needs_resolution' : 'ready',
  };
}
