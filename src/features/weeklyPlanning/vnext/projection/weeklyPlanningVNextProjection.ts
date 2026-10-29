// The single deterministic projector of the VNext core: amount of work, minutes,
// and typed questions per owner, recomputed from stated facts every turn.
import { filterActiveWeeklyPlanningFactsV5 } from '../../semantic/weeklyPlanningFactLifecycleV5';
import type { WorkloadFactV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import type {
  VNextEffortEstimateFact,
  VNextEstimateBasis,
  VNextOwnerProjection,
  VNextQuestion,
  VNextQuestionCode,
  VNextQuestionOption,
  VNextTurnDelta,
  VNextWorkItem,
  VNextWorkRelationKind,
  WeeklyPlanningVNextProjection,
  WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import {
  computeVNextWorkUnits,
  vnextLineageIdByFactId,
  vnextOwnerKey,
  vnextUnitIdentity,
  type VNextWorkUnit,
  type VNextWorkUnitIssue,
} from '../weeklyPlanningVNextWorkIdentity';

const EMPTY_DELTA: VNextTurnDelta = { add: [], patch: [], remove: [], relate: [], defer: [] };

function nullWorkloadChanges() {
  return {
    amount: null, unitCode: null, unitLabel: null, quantityRole: null,
    rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null,
  };
}

function questionKey(params: {
  code: VNextQuestionCode;
  ownerKey: string;
  lineageIds: string[];
  amount: number | null;
}): string {
  return [params.code, params.ownerKey, [...params.lineageIds].sort().join(','), params.amount ?? '']
    .join(':');
}

interface ProjectionContext {
  state: WeeklyPlanningVNextState;
  lineageOf: (factId: string) => string;
  leafOfLineage: Map<string, string>;
  workloadsById: Map<string, WorkloadFactV5>;
  activeWorkloads: WorkloadFactV5[];
  efforts: VNextEffortEstimateFact[];
}

function hasRelation(
  context: ProjectionContext,
  kind: VNextWorkRelationKind,
  a: string,
  b: string,
): boolean {
  const [first, second] = a < b ? [a, b] : [b, a];
  return context.state.workRelations.some((relation) =>
    relation.kind === kind && relation.lineageIds[0] === first && relation.lineageIds[1] === second);
}

function allPairs(lineages: string[], test: (a: string, b: string) => boolean): boolean {
  return lineages.every((a, index) => lineages.slice(index + 1).every((b) => test(a, b)));
}

function relateOptions(context: ProjectionContext, lineageIds: string[]): VNextQuestionOption[] {
  const ref = (lineageId: string) => ({ factId: context.leafOfLineage.get(lineageId) ?? lineageId });
  const pairs = lineageIds.flatMap((a, index) => lineageIds.slice(index + 1).map((b) => [a, b] as const));
  const option = (kind: VNextWorkRelationKind): VNextQuestionOption => ({
    optionId: kind,
    value: kind === 'same' ? 1 : 0,
    delta: { ...EMPTY_DELTA, relate: pairs.map(([a, b]) => ({ kind, a: ref(a), b: ref(b) })) },
  });
  // "Same" is a single answer only for a pair; for more work it would hide which ones.
  return lineageIds.length === 2 ? [option('same'), option('distinct')] : [option('distinct')];
}

function issueQuestion(issue: VNextWorkUnitIssue, owner: { taskId: string; componentId: string | null }): VNextQuestion {
  const base = {
    code: issue.code,
    key: questionKey({ code: issue.code, ownerKey: issue.ownerKey, lineageIds: issue.lineageIds, amount: null }),
    ownerKey: issue.ownerKey,
    taskId: owner.taskId,
    componentId: owner.componentId,
    subjectLineageIds: issue.lineageIds,
    forWork: null,
    options: [] as VNextQuestionOption[],
  };
  if (issue.code !== 'remaining_inconsistent') return base;
  const patchAmount = (optionId: string, targetFactId: string, amount: number): VNextQuestionOption => ({
    optionId,
    value: amount,
    delta: {
      ...EMPTY_DELTA,
      patch: [{
        kind: 'workload',
        localId: optionId,
        targetFactId,
        changes: { ...nullWorkloadChanges(), amount },
        amountDelta: null,
      }],
    },
  });
  // Either the stated remaining follows progress, or progress follows the stated remaining.
  const completedForStated = issue.totalAmount - issue.statedAmount;
  const options = [patchAmount('remaining_follows_progress', issue.remainingFactId, issue.derivedAmount)];
  if (completedForStated >= 0) {
    options.push(patchAmount('completed_follows_remaining', issue.completedFactId, completedForStated));
  }
  return { ...base, options };
}

/** Owner scope of an effort's target: a workload's owner, a component, or the whole task. */
function effortAppliesToWork(
  context: ProjectionContext,
  effort: VNextEffortEstimateFact,
  unit: VNextWorkUnit,
): boolean {
  if (effort.taskId !== unit.workload.taskId) return false;
  const leaf = context.leafOfLineage.get(context.lineageOf(effort.targetFactId)) ?? effort.targetFactId;
  if (leaf === unit.workload.taskId) return true;
  if (unit.workload.componentId !== null && leaf === unit.workload.componentId) return true;
  const target = context.workloadsById.get(leaf);
  return target !== undefined && vnextOwnerKey(target) === unit.ownerKey;
}

interface EstimateCandidate {
  minutes: number;
  basis: VNextEstimateBasis;
  effortIds: string[];
}

function estimateCandidates(
  context: ProjectionContext,
  unit: VNextWorkUnit,
  unitCountInTaskScope: number,
): EstimateCandidate[] {
  const workload = unit.workload;
  if (workload.unitCode === 'minute') return [{ minutes: unit.amount, basis: 'intrinsic_duration', effortIds: [] }];
  if (workload.unitCode === 'hour') return [{ minutes: unit.amount * 60, basis: 'intrinsic_duration', effortIds: [] }];
  const workIdentity = vnextUnitIdentity(workload);
  const candidates: EstimateCandidate[] = [];
  for (const effort of context.efforts) {
    if (effort.kind === 'duration_per_unit') {
      if (effortAppliesToWork(context, effort, unit)
        && vnextUnitIdentity({ unitCode: effort.unitCode, unitLabel: effort.unitLabel }) === workIdentity) {
        candidates.push({ minutes: effort.minutes * unit.amount, basis: 'rate', effortIds: [effort.id] });
      }
      continue;
    }
    if (effort.kind === 'session_duration') {
      if (workload.unitCode === 'session' && effortAppliesToWork(context, effort, unit)) {
        candidates.push({ minutes: effort.minutes * unit.amount, basis: 'session_duration', effortIds: [effort.id] });
      }
      continue;
    }
    const binding = effort.workBinding;
    if (binding === null) {
      // A total about the whole task/component measures this work only when it is the only work there.
      if (unitCountInTaskScope === 1 && effortAppliesToWork(context, effort, unit)) {
        candidates.push({ minutes: effort.minutes, basis: 'task_total', effortIds: [effort.id] });
      }
      continue;
    }
    if (binding.workLineageId === unit.workLineageId) {
      if (binding.boundAmount === unit.amount) {
        candidates.push({ minutes: effort.minutes, basis: 'work_total', effortIds: [effort.id] });
      }
      continue;
    }
    // A total stated for completed work of the same owner and unit is an observed pace.
    const paceWork = context.workloadsById.get(context.leafOfLineage.get(binding.workLineageId) ?? '');
    if (paceWork && paceWork.quantityRole === 'completed' && binding.boundAmount > 0
      && vnextOwnerKey(paceWork) === unit.ownerKey && vnextUnitIdentity(paceWork) === workIdentity) {
      candidates.push({
        minutes: (effort.minutes / binding.boundAmount) * unit.amount,
        basis: 'observed_pace',
        effortIds: [effort.id],
      });
    }
  }
  return candidates;
}

function sameMinutes(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-9;
}

function workItem(unit: VNextWorkUnit, estimate: EstimateCandidate | null): VNextWorkItem {
  const workload = unit.workload;
  return {
    workLineageId: unit.workLineageId,
    definingFactId: unit.definingFactId,
    ownerKey: unit.ownerKey,
    taskId: workload.taskId,
    componentId: workload.componentId,
    quantityRole: unit.role,
    derivedFromTotal: unit.derivedFromTotal,
    amount: unit.amount,
    unitCode: workload.unitCode,
    unitLabel: workload.unitLabel,
    rangeStart: workload.rangeStart,
    rangeEnd: workload.rangeEnd,
    perOccurrence: workload.perOccurrence,
    periodExpression: workload.periodExpression,
    minutes: estimate?.minutes ?? null,
    estimateBasis: estimate?.basis ?? null,
    estimateFactIds: estimate?.effortIds ?? [],
  };
}

function projectWorkloadOwner(
  context: ProjectionContext,
  owner: ReturnType<typeof computeVNextWorkUnits>[number],
  unitsPerTask: Map<string, number>,
): VNextOwnerProjection {
  const result = (status: VNextOwnerProjection['status'], work: VNextWorkItem[], question: VNextQuestion | null) =>
    ({ ownerKey: owner.ownerKey, taskId: owner.taskId, componentId: owner.componentId, status, work, question });
  const ask = (code: VNextQuestionCode, lineageIds: string[], extra: Partial<VNextQuestion> = {}) =>
    result('question', [], {
      code,
      key: questionKey({ code, ownerKey: owner.ownerKey, lineageIds, amount: extra.forWork?.amount ?? null }),
      ownerKey: owner.ownerKey,
      taskId: owner.taskId,
      componentId: owner.componentId,
      subjectLineageIds: lineageIds,
      forWork: null,
      options: [],
      ...extra,
    });
  if (owner.issue) return result('question', [], issueQuestion(owner.issue, owner));
  let units = owner.units;
  if (units.length === 0) return result('nothing_to_schedule', [], null);

  // A target stands for other work of the owner only when the user said it is the same work;
  // explicitly distinct work is scheduled beside it; anything else is asked, never dropped.
  const same = (a: string, b: string) => hasRelation(context, 'same', a, b);
  const distinct = (a: string, b: string) => hasRelation(context, 'distinct', a, b);
  const targets = units.filter((unit) => unit.role === 'target');
  const others = units.filter((unit) => unit.role !== 'target');
  if (targets.length > 0) {
    const targetLineages = targets.map((unit) => unit.workLineageId);
    const open = others.filter((unit) =>
      !allPairs([...targetLineages, unit.workLineageId], distinct)
      && !targetLineages.every((target) => same(target, unit.workLineageId)));
    if (open.length > 0) {
      const lineageIds = [...targetLineages, ...open.map((unit) => unit.workLineageId)];
      return ask('same_or_distinct_work', lineageIds, { options: relateOptions(context, lineageIds) });
    }
    units = [...targets, ...others.filter((unit) => allPairs([...targetLineages, unit.workLineageId], distinct))];
  } else if (others.length > 1 && !allPairs(others.map((unit) => unit.workLineageId), distinct)) {
    const lineageIds = others.map((unit) => unit.workLineageId);
    return ask('same_or_distinct_work', lineageIds, { options: relateOptions(context, lineageIds) });
  }

  const work: VNextWorkItem[] = [];
  for (const unit of units) {
    const candidates = estimateCandidates(context, unit, unitsPerTask.get(unit.workload.taskId) ?? 0);
    const forWork = { workLineageId: unit.workLineageId, definingFactId: unit.definingFactId, amount: unit.amount };
    if (candidates.length === 0) {
      return ask('missing_effort_estimate', [unit.workLineageId], { forWork });
    }
    if (candidates.some((candidate) => !sameMinutes(candidate.minutes, candidates[0].minutes))) {
      const effortLineages = candidates.flatMap((candidate) => candidate.effortIds.map(context.lineageOf));
      return ask('effort_inconsistent', [unit.workLineageId, ...effortLineages], { forWork });
    }
    work.push(workItem(unit, {
      ...candidates[0],
      effortIds: candidates.flatMap((candidate) => candidate.effortIds),
    }));
  }
  return result('ready', work, null);
}

/** A task with no stated workload but a stated total time is minute work of that size. */
function projectTaskTotalOwner(
  context: ProjectionContext,
  taskId: string,
  totals: VNextEffortEstimateFact[],
): VNextOwnerProjection {
  const ownerKey = vnextOwnerKey({ taskId, componentId: null });
  const lineageIds = totals.map((effort) => context.lineageOf(effort.id));
  if (totals.some((effort) => !sameMinutes(effort.minutes, totals[0].minutes))) {
    return {
      ownerKey, taskId, componentId: null, status: 'question', work: [],
      question: {
        code: 'effort_inconsistent',
        key: questionKey({ code: 'effort_inconsistent', ownerKey, lineageIds, amount: null }),
        ownerKey, taskId, componentId: null, subjectLineageIds: lineageIds, forWork: null, options: [],
      },
    };
  }
  return {
    ownerKey, taskId, componentId: null, status: 'ready', question: null,
    work: [{
      workLineageId: context.lineageOf(taskId),
      definingFactId: taskId,
      ownerKey, taskId, componentId: null,
      quantityRole: 'target',
      derivedFromTotal: false,
      amount: totals[0].minutes,
      unitCode: 'minute',
      unitLabel: '分',
      rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
      minutes: totals[0].minutes,
      estimateBasis: 'task_total',
      estimateFactIds: totals.map((effort) => effort.id),
    }],
  };
}

export function projectWeeklyPlanningVNext(state: WeeklyPlanningVNextState): WeeklyPlanningVNextProjection {
  const graph = state.graph;
  const lineage = vnextLineageIdByFactId(graph);
  const lineageOf = (factId: string) => lineage.get(factId) ?? factId;
  const activeIds = new Set(graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  const leafOfLineage = new Map<string, string>();
  for (const [factId, root] of lineage) if (activeIds.has(factId)) leafOfLineage.set(root, factId);
  const activeWorkloads = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads);
  const context: ProjectionContext = {
    state,
    lineageOf,
    leafOfLineage,
    workloadsById: new Map(graph.workloads.map((workload) => [workload.id, workload])),
    activeWorkloads,
    efforts: filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates),
  };

  const workOwners = computeVNextWorkUnits(graph);
  const unitsPerTask = new Map<string, number>();
  for (const owner of workOwners) {
    unitsPerTask.set(owner.taskId, (unitsPerTask.get(owner.taskId) ?? 0) + owner.units.length);
  }
  const owners = workOwners.map((owner) => projectWorkloadOwner(context, owner, unitsPerTask));

  const tasks = filterActiveWeeklyPlanningFactsV5(graph, graph.tasks);
  for (const task of tasks) {
    if (activeWorkloads.some((workload) => workload.taskId === task.id)) continue;
    const totals = context.efforts.filter((effort) =>
      effort.taskId === task.id && effort.kind === 'total_duration' && effort.targetFactId === task.id);
    if (totals.length > 0) owners.push(projectTaskTotalOwner(context, task.id, totals));
  }
  const taskOrder = new Map(tasks.map((task, index) => [task.id, index]));
  owners.sort((left, right) => (taskOrder.get(left.taskId) ?? 0) - (taskOrder.get(right.taskId) ?? 0));

  const deferredKeys = new Set(state.deferrals.map((deferral) => deferral.questionKey));
  const allQuestions = owners.flatMap((owner) => (owner.question ? [owner.question] : []));
  const questions = allQuestions.filter((question) => !deferredKeys.has(question.key));
  const deferredQuestions = allQuestions.filter((question) => deferredKeys.has(question.key));
  const hasWork = owners.some((owner) => owner.work.length > 0);
  return {
    graphRevision: graph.revision,
    owners,
    questions,
    deferredQuestions,
    readiness: questions.length > 0 ? 'needs_resolution' : hasWork ? 'ready' : 'empty',
  };
}
