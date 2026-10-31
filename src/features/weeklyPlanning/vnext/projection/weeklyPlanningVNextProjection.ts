// The single deterministic projector of the VNext core: amount of work, minutes,
// and typed questions per owner, recomputed from stated facts every turn.
// Why here only: nothing derived (remaining, minutes, which estimate applies) is
// stored, so a correction can never leave a stale copy behind (the V5 failure mode,
// #881 C). New estimate bases and question kinds are added here, in one place.
// Breaks if bypassed: a second computation of amounts disagrees after a correction.
// Tests: weeklyPlanningVNextProjection.test.ts ("derives remaining from total and
// completed…", "binds a same-turn quantity and total correction in either order",
// "never silently drops or double-counts other-basis work…").
import { filterActiveWeeklyPlanningFactsV5 } from '../../semantic/weeklyPlanningFactLifecycleV5';
import { evaluateVNextLearningStrategy } from '../application/weeklyPlanningVNextLearningStrategy';
import { WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5 } from '../../intake/weeklyPlanningProvisionalTimeboxStateV5';
import type { WorkloadFactV5 } from '../weeklyPlanningVNextV5Boundary';
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
  createVNextLineageResolver,
  vnextQuantityBasisKey,
  vnextUnitIdentity,
  type VNextLineageResolver,
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

/** The key changes whenever the subject or the values being asked about change. */
function questionKey(params: {
  code: VNextQuestionCode;
  ownerKey: string;
  lineageIds: string[];
  values: number[];
}): string {
  return [params.code, params.ownerKey, [...params.lineageIds].sort().join(','), params.values.join('/')]
    .join(':');
}

/** Questions whose deferral may carry Stable V5's provisional timebox: the work exists, its effort is unknown. */
const PROVISIONAL_TIMEBOX_QUESTION_CODES: readonly VNextQuestionCode[] = ['missing_effort_estimate', 'missing_schedulable_work'];

export function vnextQuestionKeyAllowsProvisionalTimebox(key: string): boolean {
  return (PROVISIONAL_TIMEBOX_QUESTION_CODES as readonly string[]).includes(key.split(':', 1)[0]);
}

/**
 * Minutes per unit observed in the user's recorded memory-pace sessions, by unit identity
 * (`vnextUnitIdentity`: the code, and the label of a custom unit — 首 is not 項目): derived each turn
 * from the read-only calendar by Stable V5's deriveWeeklyPlanningMemoryPaceEstimateV5, passed in and
 * never stored. Absent means no observation.
 */
export type WeeklyPlanningVNextObservedMemoryPace = Readonly<Record<string, number>>;

interface ProjectionContext {
  state: WeeklyPlanningVNextState;
  resolver: VNextLineageResolver;
  workloadsById: Map<string, WorkloadFactV5>;
  activeWorkloads: WorkloadFactV5[];
  efforts: VNextEffortEstimateFact[];
  /** Task lineages whose stated study activity is memorization. */
  memorizationTasks: Set<string>;
  observedMemoryPace: WeeklyPlanningVNextObservedMemoryPace;
  /** Keys of questions the user deferred with a provisional timebox. */
  provisionalKeys: Set<string>;
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

function workOptions(context: ProjectionContext, open: VNextWorkUnit[], pairs: Array<readonly [VNextWorkUnit, VNextWorkUnit]>): VNextQuestionOption[] {
  const ref = (unit: VNextWorkUnit) => ({ factId: context.resolver.leafOf(unit.workLineageId) ?? unit.definingFactId });
  const relateAll = (kind: VNextWorkRelationKind): VNextTurnDelta =>
    ({ ...EMPTY_DELTA, relate: pairs.map(([a, b]) => ({ kind, a: ref(a), b: ref(b) })) });
  const options: VNextQuestionOption[] = [{ optionId: 'distinct', value: 0, delta: relateAll('distinct') }];
  const targets = open.filter((unit) => unit.role === 'target');
  if (targets.length === 1) {
    // "Same": the one target stands for the other work.
    options.push({ optionId: 'same', value: 1, delta: relateAll('same') });
  } else if (open.length === 2) {
    // Same work stated twice without a single target: the user keeps one statement.
    // (Estimates about the dropped statement end with it, by the transaction's dependency rule.)
    for (const [keep, drop] of [[open[0], open[1]], [open[1], open[0]]] as const) {
      options.push({
        optionId: `keep:${keep.workLineageId}`,
        value: keep.amount,
        delta: { ...EMPTY_DELTA, remove: [{ targetFactId: drop.definingFactId }] },
      });
    }
  }
  return options;
}

/** Setting a stated quantity to an amount; an amount of zero is expressed as no statement. */
function amountOption(optionId: string, targetFactId: string, amount: number): VNextQuestionOption {
  return {
    optionId,
    value: amount,
    delta: amount > 0
      ? {
          ...EMPTY_DELTA,
          patch: [{
            kind: 'workload', localId: optionId, targetFactId, amountDelta: null,
            changes: { ...nullWorkloadChanges(), amount },
          }],
        }
      : { ...EMPTY_DELTA, remove: [{ targetFactId }] },
  };
}

function issueQuestion(issue: VNextWorkUnitIssue, owner: { taskId: string; componentId: string | null }): VNextQuestion {
  const base = {
    code: issue.code,
    key: questionKey({
      code: issue.code,
      ownerKey: issue.ownerKey,
      lineageIds: issue.lineageIds,
      values: issue.code === 'remaining_inconsistent' ? [issue.derivedAmount, issue.statedAmount] : [],
    }),
    ownerKey: issue.ownerKey,
    taskId: owner.taskId,
    componentId: owner.componentId,
    subjectLineageIds: issue.lineageIds,
    forWork: null,
    options: [] as VNextQuestionOption[],
  };
  if (issue.code !== 'remaining_inconsistent') return base;
  // Either the stated remaining follows progress, or progress follows the stated remaining.
  const options = [amountOption('remaining_follows_progress', issue.remainingFactId, issue.derivedAmount)];
  const completedForStated = issue.totalAmount - issue.statedAmount;
  if (completedForStated >= 0) {
    options.push(amountOption('completed_follows_remaining', issue.completedFactId, completedForStated));
  }
  return { ...base, options };
}

/** Owner scope of an effort's target: a workload's owner, a component, or the whole task. */
function effortAppliesToWork(
  context: ProjectionContext,
  effort: VNextEffortEstimateFact,
  unit: VNextWorkUnit,
): boolean {
  const { lineageOf, leafOf, ownerKeyOf } = context.resolver;
  if (lineageOf(effort.taskId) !== lineageOf(unit.workload.taskId)) return false;
  const targetLineage = lineageOf(effort.targetFactId);
  if (targetLineage === lineageOf(unit.workload.taskId)) return true;
  if (unit.workload.componentId !== null && targetLineage === lineageOf(unit.workload.componentId)) return true;
  const target = context.workloadsById.get(leafOf(effort.targetFactId) ?? '');
  return target !== undefined && ownerKeyOf(target) === unit.ownerKey;
}

interface EstimateCandidate {
  minutes: number;
  basis: VNextEstimateBasis;
  effortIds: string[];
}

function estimateCandidates(
  context: ProjectionContext,
  unit: VNextWorkUnit,
  scheduled: VNextWorkUnit[],
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
      // A total about a task/component measures this work only when it is the only scheduled work there.
      if (effortAppliesToWork(context, effort, unit)
        && scheduled.filter((other) => effortAppliesToWork(context, effort, other)).length === 1) {
        candidates.push({ minutes: effort.minutes, basis: 'task_total', effortIds: [effort.id] });
      }
      continue;
    }
    // A future total applies to the same work at the same amount and basis; an observed pace
    // scales to work of the same owner and unit while its completed statement is unchanged.
    if (binding.kind === 'future_work') {
      if (binding.workLineageId === unit.workLineageId
        && binding.boundAmount === unit.amount && binding.boundBasisKey === unit.basisKey) {
        candidates.push({ minutes: effort.minutes, basis: 'work_total', effortIds: [effort.id] });
      }
      continue;
    }
    const paceWork = context.workloadsById.get(context.resolver.leafOf(binding.workLineageId) ?? '');
    if (paceWork && binding.boundAmount > 0
      && binding.boundAmount === paceWork.amount && binding.boundBasisKey === vnextQuantityBasisKey(paceWork)
      && context.resolver.ownerKeyOf(paceWork) === unit.ownerKey && vnextUnitIdentity(paceWork) === workIdentity) {
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

type OwnerWorkUnits = ReturnType<typeof computeVNextWorkUnits>[number];

function ownerQuestion(
  owner: OwnerWorkUnits,
  code: VNextQuestionCode,
  lineageIds: string[],
  extra: { values?: number[]; forWork?: VNextQuestion['forWork']; options?: VNextQuestionOption[] } = {},
): VNextOwnerProjection {
  return {
    ownerKey: owner.ownerKey,
    taskId: owner.taskId,
    componentId: owner.componentId,
    status: 'question',
    work: [],
    question: {
      code,
      key: questionKey({ code, ownerKey: owner.ownerKey, lineageIds, values: extra.values ?? [] }),
      ownerKey: owner.ownerKey,
      taskId: owner.taskId,
      componentId: owner.componentId,
      subjectLineageIds: lineageIds,
      forWork: extra.forWork ?? null,
      options: extra.options ?? [],
    },
  };
}

/**
 * Which work of an owner is scheduled. Every pair must be settled: "distinct"
 * keeps both, "same" lets the single target stand for the other. Any other pair
 * is asked, so work is never silently dropped or double-counted.
 */
function resolveOwnerWork(
  context: ProjectionContext,
  owner: OwnerWorkUnits,
): { scheduled: VNextWorkUnit[] } | { projection: VNextOwnerProjection } {
  if (owner.issue) {
    return { projection: { ...ownerQuestion(owner, owner.issue.code, []), question: issueQuestion(owner.issue, owner) } };
  }
  const units = owner.units;
  const represented = new Set<VNextWorkUnit>();
  const openPairs: Array<readonly [VNextWorkUnit, VNextWorkUnit]> = [];
  units.forEach((a, index) => units.slice(index + 1).forEach((b) => {
    if (hasRelation(context, 'distinct', a.workLineageId, b.workLineageId)) return;
    const oneTarget = (a.role === 'target') !== (b.role === 'target');
    if (oneTarget && hasRelation(context, 'same', a.workLineageId, b.workLineageId)) {
      represented.add(a.role === 'target' ? b : a);
      return;
    }
    openPairs.push([a, b]);
  }));
  if (openPairs.length > 0) {
    const open = units.filter((unit) => openPairs.some((pair) => pair.includes(unit)));
    return {
      projection: ownerQuestion(owner, 'same_or_distinct_work', open.map((unit) => unit.workLineageId), {
        options: workOptions(context, open, openPairs),
      }),
    };
  }
  return { scheduled: units.filter((unit) => !represented.has(unit)) };
}

function estimateOwnerWork(
  context: ProjectionContext,
  owner: OwnerWorkUnits,
  units: VNextWorkUnit[],
  allScheduled: VNextWorkUnit[],
): VNextOwnerProjection {
  if (units.length === 0) {
    return { ownerKey: owner.ownerKey, taskId: owner.taskId, componentId: owner.componentId, status: 'nothing_to_schedule', work: [], question: null };
  }
  const work: VNextWorkItem[] = [];
  for (const unit of units) {
    const candidates = estimateCandidates(context, unit, allScheduled);
    const forWork = { workLineageId: unit.workLineageId, definingFactId: unit.definingFactId, amount: unit.amount,
      unitCode: unit.workload.unitCode, unitLabel: unit.workload.unitLabel };
    if (candidates.length === 0) {
      // As in Stable V5, memorization work with no estimate of its own uses the user's observed pace
      // (amount × median minutes per unit); a stated estimate always wins, and nothing is stored.
      const minutesPerUnit = context.memorizationTasks.has(context.resolver.lineageOf(owner.taskId))
        ? context.observedMemoryPace[vnextUnitIdentity(unit.workload)] : undefined;
      if (minutesPerUnit !== undefined && Number.isFinite(minutesPerUnit) && minutesPerUnit > 0) {
        work.push(workItem(unit, { minutes: unit.amount * minutesPerUnit, basis: 'observed_memory_pace', effortIds: [] }));
        continue;
      }
      const missing = ownerQuestion(owner, 'missing_effort_estimate', [unit.workLineageId], { forWork, values: [unit.amount] });
      // As in Stable V5, a provisional timebox places Stable V5's fixed block for the asked work; a stated estimate wins.
      if (context.provisionalKeys.has(missing.question!.key)) {
        work.push(workItem(unit, { minutes: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5, basis: 'provisional_timebox', effortIds: [] }));
        continue;
      }
      return missing;
    }
    if (candidates.some((candidate) => !sameMinutes(candidate.minutes, candidates[0].minutes))) {
      const effortLineages = candidates.flatMap((candidate) => candidate.effortIds.map(context.resolver.lineageOf));
      return ownerQuestion(owner, 'effort_inconsistent', [unit.workLineageId, ...effortLineages], {
        forWork,
        values: candidates.map((candidate) => candidate.minutes).sort((a, b) => a - b),
      });
    }
    work.push(workItem(unit, {
      ...candidates[0],
      effortIds: candidates.flatMap((candidate) => candidate.effortIds),
    }));
  }
  return { ownerKey: owner.ownerKey, taskId: owner.taskId, componentId: owner.componentId, status: 'ready', work, question: null };
}

/** A task with no stated workload but a stated total time is minute work of that size. */
function projectTaskTotalOwner(
  context: ProjectionContext,
  taskId: string,
  totals: VNextEffortEstimateFact[],
): VNextOwnerProjection {
  const ownerKey = context.resolver.ownerKeyOf({ taskId, componentId: null });
  const lineageIds = totals.map((effort) => context.resolver.lineageOf(effort.id));
  if (totals.some((effort) => !sameMinutes(effort.minutes, totals[0].minutes))) {
    return {
      ownerKey, taskId, componentId: null, status: 'question', work: [],
      question: {
        code: 'effort_inconsistent',
        key: questionKey({
          code: 'effort_inconsistent',
          ownerKey,
          lineageIds,
          values: totals.map((effort) => effort.minutes).sort((a, b) => a - b),
        }),
        ownerKey, taskId, componentId: null, subjectLineageIds: lineageIds, forWork: null, options: [],
      },
    };
  }
  return {
    ownerKey, taskId, componentId: null, status: 'ready', question: null,
    work: [{
      workLineageId: context.resolver.lineageOf(taskId),
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

/** A task with nothing to schedule yet: asks how much; the answer is an ordinary delta. */
function missingWorkOwner(context: ProjectionContext, taskId: string): VNextOwnerProjection {
  const ownerKey = context.resolver.ownerKeyOf({ taskId, componentId: null });
  const lineageIds = [context.resolver.lineageOf(taskId)];
  const key = questionKey({ code: 'missing_schedulable_work', ownerKey, lineageIds, values: [] });
  if (context.provisionalKeys.has(key)) {
    // Stable V5 gives an open-ended task with no work the same provisional block (its wptb_ workload).
    const minutes = WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5;
    return {
      ownerKey, taskId, componentId: null, status: 'ready', question: null,
      work: [{
        workLineageId: lineageIds[0], definingFactId: taskId, ownerKey, taskId, componentId: null,
        quantityRole: 'target', derivedFromTotal: false, amount: minutes, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
        minutes, estimateBasis: 'provisional_timebox', estimateFactIds: [],
      }],
    };
  }
  return {
    ownerKey, taskId, componentId: null, status: 'question', work: [],
    question: {
      code: 'missing_schedulable_work',
      key,
      ownerKey, taskId, componentId: null, subjectLineageIds: lineageIds, forWork: null, options: [],
    },
  };
}

export function projectWeeklyPlanningVNext(
  state: WeeklyPlanningVNextState,
  observedMemoryPace: WeeklyPlanningVNextObservedMemoryPace = {},
): WeeklyPlanningVNextProjection {
  const graph = state.graph;
  const resolver = createVNextLineageResolver(graph);
  const activeWorkloads = filterActiveWeeklyPlanningFactsV5(graph, graph.workloads);
  const context: ProjectionContext = {
    state,
    resolver,
    workloadsById: new Map(graph.workloads.map((workload) => [workload.id, workload])),
    activeWorkloads,
    efforts: filterActiveWeeklyPlanningFactsV5(graph, graph.effortEstimates),
    memorizationTasks: new Set(filterActiveWeeklyPlanningFactsV5(graph, graph.studyContexts)
      .filter((study) => study.activityKind === 'memorization_retrieval')
      .map((study) => resolver.lineageOf(study.taskId))),
    observedMemoryPace,
    provisionalKeys: new Set(state.deferrals
      .filter((deferral) => deferral.allocation === 'provisional_timebox').map((deferral) => deferral.questionKey)),
  };

  // Settle which work is scheduled first, so scope-wide totals see the final work set.
  const resolved = computeVNextWorkUnits(graph).map((owner) => ({ owner, resolution: resolveOwnerWork(context, owner) }));
  const allScheduled = resolved.flatMap(({ resolution }) => ('scheduled' in resolution ? resolution.scheduled : []));
  const owners = resolved.map(({ owner, resolution }) => ('projection' in resolution
    ? resolution.projection
    : estimateOwnerWork(context, owner, resolution.scheduled, allScheduled)));

  const tasks = filterActiveWeeklyPlanningFactsV5(graph, graph.tasks);
  const activeBounds = filterActiveWeeklyPlanningFactsV5(graph, graph.temporalConstraints);
  for (const task of tasks) {
    const taskLineage = resolver.lineageOf(task.id);
    if (activeWorkloads.some((workload) => resolver.lineageOf(workload.taskId) === taskLineage)) continue;
    const totals = context.efforts.filter((effort) => effort.kind === 'total_duration'
      && resolver.lineageOf(effort.taskId) === taskLineage && resolver.lineageOf(effort.targetFactId) === taskLineage);
    if (totals.length > 0) {
      owners.push(projectTaskTotalOwner(context, task.id, totals));
      continue;
    }
    // Every stated task is accounted for: work, a total, a fixed time, or a question. Never silently nothing.
    const fixed = activeBounds.some((bound) => bound.kind === 'fixed_interval' && bound.constraintLevel === 'hard'
      && resolver.lineageOf(bound.taskId) === taskLineage);
    if (!fixed) owners.push(missingWorkOwner(context, task.id));
  }
  const taskOrder = new Map(tasks.map((task, index) => [task.id, index]));
  owners.sort((left, right) => (taskOrder.get(left.taskId) ?? 0) - (taskOrder.get(right.taskId) ?? 0));

  const learning = evaluateVNextLearningStrategy({ state, projection: { owners }, turnId: `projection:${graph.revision}` });
  // Records come from V5's pure proposal policy through the one transaction.
  // They never supply an effort estimate: only an accepted measurement trial can bypass it.
  for (const owner of owners) {
    const records = state.learningStrategyProposalRecords.filter(record => {
      const workload = graph.workloads.find(fact => fact.id === resolver.leafOf(record.workloadFactId));
      return workload && resolver.lineageOf(record.taskId) === resolver.lineageOf(owner.taskId)
        && owner.ownerKey === resolver.ownerKeyOf(workload);
    });
    const pending = records.find(record => record.id === learning.pendingProposal?.id);
    if (pending) {
      owner.status = 'question'; owner.work = [];
      owner.question = { code: 'learning_strategy_proposal', key: `learning_strategy_proposal:${pending.id}`,
        ownerKey: owner.ownerKey, taskId: owner.taskId, componentId: owner.componentId,
        subjectLineageIds: [resolver.lineageOf(pending.workloadFactId)], forWork: null, options: [], proposal: pending };
      continue;
    }
    const calibration = records.find(record => record.id === learning.acceptedCalibrationProposal?.id);
    if (calibration?.selectedSessionMinutes) {
      owner.status = 'ready'; owner.work = []; owner.question = null;
      owner.calibration = { workloadFactId: resolver.leafOf(calibration.workloadFactId)!, sessionMinutes: calibration.selectedSessionMinutes };
      continue;
    }
    const spaced = records.find(record => record.id === learning.acceptedSpacedProposal?.id);
    if (spaced) {
      const id = resolver.leafOf(spaced.workloadFactId)!;
      const sessions = context.efforts.filter(effort => effort.kind === 'session_duration'
        && resolver.lineageOf(effort.targetFactId) === resolver.lineageOf(id) && effort.minutes > 0);
      if (sessions.length === 0) {
        const workload = graph.workloads.find(fact => fact.id === id)!;
        owner.status = 'question'; owner.work = [];
        owner.question = { code: 'missing_effort_estimate', key: `memory_session_duration:${spaced.id}`,
          ownerKey: owner.ownerKey, taskId: owner.taskId, componentId: owner.componentId,
          subjectLineageIds: [resolver.lineageOf(id)], options: [], effortMeasurement: 'session_duration',
          forWork: { workLineageId: resolver.lineageOf(id), definingFactId: id, amount: workload.amount,
            unitCode: workload.unitCode, unitLabel: workload.unitLabel } };
      }
    }
  }

  const deferredKeys = new Set(state.deferrals.map((deferral) => deferral.questionKey));
  const allQuestions = owners.flatMap((owner) => (owner.question ? [owner.question] : []));
  const questions = allQuestions.filter((question) => !deferredKeys.has(question.key));
  const deferredQuestions = allQuestions.filter((question) => deferredKeys.has(question.key));
  const hasWork = owners.some((owner) => owner.work.length > 0 || owner.calibration);
  return {
    graphRevision: graph.revision,
    ...(learning.acceptedSpacedProposal || learning.acceptedCalibrationProposal ? { learningStrategy: {
      acceptedSpacedProposal: learning.acceptedSpacedProposal, acceptedCalibrationProposal: learning.acceptedCalibrationProposal } } : {}),
    owners,
    questions,
    deferredQuestions,
    readiness: questions.length > 0 ? 'needs_resolution' : hasWork ? 'ready' : 'empty',
  };
}
