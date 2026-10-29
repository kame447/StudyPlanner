import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningVNextTurn,
  createEmptyWeeklyPlanningVNextState,
} from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import type {
  VNextFactRef,
  VNextTurnDelta,
  WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5, type WorkloadFactV5, type EffortEstimateFactV5 } from '../../semantic/weeklyPlanningFactGraphV5';
import { compareWeeklyPlanningV5AndVNext } from '../projection/weeklyPlanningVNextShadowComparison';
import { prototypeFixtures, regressionFixtures, type ComparisonFixture, type FixtureTurn, type FactInput } from '../../evals/vnextComparisonFixtures';

const emptyDelta = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';
const v5Source = (semanticLocalId: string) => ({ conversationId: 'issue-926-v5', turnId: 'saved-graph', semanticLocalId, sourceText: 'offline saved V5 graph', origin: 'user' as const });

function savedV5Graph(workloads: WorkloadFactV5[], efforts: EffortEstimateFactV5[] = []): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  const facts = [{ id: 'task-slides' }, ...workloads, ...efforts];
  return {
    ...empty,
    revision: 1,
    tasks: [{ id: 'task-slides', category: 'study', title: 'スライド', source: v5Source('task-slides'), createdRevision: 1 }],
    workloads,
    effortEstimates: efforts,
    factLifecycles: facts.map((fact) => ({ factId: fact.id, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null })),
  };
}

function v5Workload(id: string, role: WorkloadFactV5['quantityRole'], amount: number, options: Partial<WorkloadFactV5> = {}): WorkloadFactV5 {
  return { id, taskId: 'task-slides', componentId: null, quantityRole: role, amount, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, source: v5Source(id), createdRevision: 1, ...options };
}

function v5Effort(id: string, kind: EffortEstimateFactV5['kind'], minutes: number, targetFactId: string): EffortEstimateFactV5 {
  return { id, taskId: 'task-slides', targetFactId, kind, minutes, unitCode: kind === 'duration_per_unit' ? 'page' : null, precision: 'exact', source: v5Source(id), createdRevision: 1 };
}

function unit(value: string, explicitLabel?: string): { code: string; label: string } {
  const mapping: Record<string, { code: string; label: string }> = {
    custom_page: { code: 'custom', label: '枚' },
    custom_page_set: { code: 'custom', label: 'セット' },
    page: { code: 'page', label: 'ページ' },
    minute: { code: 'minute', label: '分' },
    hour: { code: 'hour', label: '時間' },
    chapter: { code: 'chapter', label: '章' },
    session: { code: 'session', label: '回' },
  };
  return { ...(mapping[value] ?? mapping.custom_page), ...(explicitLabel ? { label: explicitLabel } : {}) };
}

type FixtureFactCollection = 'workloads' | 'effortEstimates' | 'temporalConstraints' | 'tasks';
function activeFacts<K extends FixtureFactCollection>(
  state: WeeklyPlanningVNextState,
  collection: K,
): WeeklyPlanningVNextState['graph'][K] {
  const active = new Set(state.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  return state.graph[collection].filter((fact) => active.has(fact.id)) as WeeklyPlanningVNextState['graph'][K];
}

function resolveFactId(state: WeeklyPlanningVNextState, taskName: string, alias: string): string {
  if (alias === 'task-category' || alias.startsWith('task:')) {
    const task = activeFacts(state, 'tasks').find((fact) => fact.title === taskName || fact.source.semanticLocalId === `task-${slug(taskName)}`);
    return task?.id ?? `missing:${alias}`;
  }
  if (alias === 'deadline' || alias === 'invalid-deadline') {
    const temporal = activeFacts(state, 'temporalConstraints').find((fact) => fact.taskId === taskIdFor(state, taskName));
    return alias === 'invalid-deadline' ? 'missing:deadline' : temporal?.id ?? 'missing:deadline';
  }
  if (alias === 'effort') {
    return activeFacts(state, 'effortEstimates').find((fact) => fact.taskId === taskIdFor(state, taskName))?.id ?? 'missing:effort';
  }
  const workloads = activeFacts(state, 'workloads').filter((fact) => fact.taskId === taskIdFor(state, taskName));
  const byAlias = (fact: (typeof workloads)[number]) => {
    if (alias === 'page_work' || alias === 'target_page_work') return fact.quantityRole === 'scope_total' && fact.unitCode === 'custom';
    if (alias === 'minute_work' || alias === 'minute_remaining') return fact.quantityRole === 'remaining' && fact.unitCode === 'minute';
    if (alias === 'page_remaining') return fact.quantityRole === 'remaining' && fact.unitCode !== 'minute';
    if (alias === 'scope_total' || alias === 'total') return fact.quantityRole === 'scope_total';
    return fact.quantityRole === alias;
  };
  return workloads.find(byAlias)?.id ?? `missing:${alias}`;
}

function taskIdFor(state: WeeklyPlanningVNextState, taskName: string): string | null {
  return activeFacts(state, 'tasks').find((fact) => fact.title === taskName || fact.source.semanticLocalId === `task-${slug(taskName)}`)?.id ?? null;
}

function localIdFor(input: FactInput, taskName: string, index: number): string {
  if (input.kind === 'workload') return `w-${slug(taskName)}-${input.role}-${index}`;
  if (input.kind === 'effort') return `e-${slug(taskName)}-${input.measure}-${index}`;
  if (input.kind === 'temporal') return `date-${slug(taskName)}-${index}`;
  return `task-${slug(taskName)}`;
}

function addedWorkloadLocalId(turn: FixtureTurn, taskName: string, alias: string): string | null {
  return turn.facts?.flatMap((fact, index) => fact.kind === 'workload' && fact.task === taskName
    && (alias === fact.role || (alias === 'minute_work' && fact.unit === 'minute')
      || (alias === 'page_work' && fact.role === 'scope_total')
      || (alias === 'page_remaining' && fact.role === 'remaining' && fact.unit !== 'minute'))
    ? [localIdFor(fact, taskName, index)] : [])[0] ?? null;
}

function resolveRef(state: WeeklyPlanningVNextState, turn: FixtureTurn, taskName: string, alias: string): VNextFactRef {
  const newLocal = addedWorkloadLocalId(turn, taskName, alias);
  if (newLocal) return { localId: newLocal };
  return { factId: resolveFactId(state, taskName, alias) };
}

function toDelta(state: WeeklyPlanningVNextState, turn: FixtureTurn, turnIndex: number, fixture: ComparisonFixture): VNextTurnDelta {
  const delta = emptyDelta();
  const inputs = turn.facts ?? [];
  const taskNameForTurn = inputs[0]?.task ?? fixture.turns.flatMap((candidate) => candidate.facts ?? [])[0]?.task ?? 'slides';
  const tasksInTurn = [...new Set(inputs.map((fact) => fact.task))];
  const taskCategory = new Map(inputs.filter((fact) => fact.kind === 'task').map((fact) => [fact.task, fact]));
  const localTaskIds = new Map<string, string>();
  for (const taskName of tasksInTurn) {
    const existing = taskIdFor(state, taskName);
    if (existing) continue;
    const localId = `task-${slug(taskName)}`;
    localTaskIds.set(taskName, localId);
    const declared = taskCategory.get(taskName);
    delta.add.push({
      kind: 'task', localId, category: declared?.kind === 'task' ? declared.category : 'study',
      title: declared?.kind === 'task' ? declared.title : taskName,
    });
  }
  const localByAlias = new Map<string, string>();
  inputs.forEach((input, index) => {
    const taskName = input.task;
    const localId = localIdFor(input, taskName, index);
    if (input.kind === 'task') return;
    const taskRef = localTaskIds.has(taskName) ? { localId: localTaskIds.get(taskName)! } : { factId: taskIdFor(state, taskName)! };
    if (input.kind === 'workload') {
      const u = unit(input.unit, input.unitLabel);
      delta.add.push({ kind: 'workload', localId, taskRef, componentRef: null,
        quantityRole: input.role, amount: input.amount, unitCode: u.code as never, unitLabel: u.label,
        rangeStart: input.range?.[0].toString() ?? null, rangeEnd: input.range?.[1].toString() ?? null,
        perOccurrence: input.perOccurrence ?? false, periodExpression: input.period ?? null });
      localByAlias.set(`${taskName}:${input.role}`, localId);
      if (input.unit === 'minute') localByAlias.set(`${taskName}:minute_work`, localId);
      if (input.role === 'scope_total') localByAlias.set(`${taskName}:page_work`, localId);
      if (input.role === 'remaining' && input.unit !== 'minute') localByAlias.set(`${taskName}:page_remaining`, localId);
    } else if (input.kind === 'effort') {
      const existingWork = input.for ? resolveRef(state, turn, taskName, input.for) : null;
      const sameTurnWork = input.for ? localByAlias.get(`${taskName}:${input.for}`) : null;
      const targetRef = sameTurnWork ? { localId: sameTurnWork } : (existingWork ?? taskRef);
      const u = input.unit ? unit(input.unit) : null;
      delta.add.push({ kind: 'effort_estimate', localId, taskRef, targetRef,
        effortKind: input.measure, minutes: input.minutes,
        unitCode: input.measure === 'duration_per_unit' ? u?.code as never : null,
        unitLabel: input.measure === 'duration_per_unit' && u?.code === 'custom' ? u.label : null,
        precision: 'exact' });
      localByAlias.set(`${taskName}:effort`, localId);
    } else {
      delta.add.push({ kind: 'temporal_constraint', localId, taskRef, targetRef: taskRef,
        constraintKind: input.constraint, constraintLevel: 'hard', dateExpression: input.dateExpression,
        namedTimePeriod: null, startTime: null, endTime: null, precision: 'exact' });
      localByAlias.set(`${taskName}:deadline`, localId);
    }
  });

  for (const patch of turn.patch ?? []) {
    const taskName = taskNameForTurn;
    const targetFactId = resolveFactId(state, taskName, patch.target);
    const changes = patch.changes;
    if (patch.target === 'task-category' || 'category' in changes) {
      delta.patch.push({ kind: 'task', localId: `p-${turnIndex}-${delta.patch.length}`, targetFactId,
        changes: { category: typeof changes.category === 'string' ? changes.category as never : null, title: typeof changes.title === 'string' ? changes.title : null } });
    } else if (patch.target === 'deadline' || 'dateExpression' in changes) {
      delta.patch.push({ kind: 'temporal_constraint', localId: `p-${turnIndex}-${delta.patch.length}`, targetFactId,
        changes: { constraintKind: null, constraintLevel: null,
          dateExpression: typeof changes.dateExpression === 'string' ? changes.dateExpression : null,
          namedTimePeriod: null, startTime: null, endTime: null, precision: null } });
    } else if (patch.target === 'effort' || 'minutes' in changes) {
      delta.patch.push({ kind: 'effort_estimate', localId: `p-${turnIndex}-${delta.patch.length}`, targetFactId,
        changes: { minutes: typeof changes.minutes === 'number' ? changes.minutes : null,
          effortKind: null, unitCode: null, unitLabel: null, precision: null } });
    } else {
      const u = typeof changes.unit === 'string' ? unit(changes.unit, typeof changes.unitLabel === 'string' ? changes.unitLabel : undefined) : null;
      const amountDelta = typeof changes.amountDelta === 'number' ? changes.amountDelta : null;
      const patchChanges = {
        amount: typeof changes.amount === 'number' && amountDelta === null ? changes.amount : null,
        unitCode: u?.code as never ?? null,
        unitLabel: u?.label ?? null,
        quantityRole: typeof changes.quantityRole === 'string' ? changes.quantityRole as never : null,
        rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null,
        ...('task' in changes ? { task: changes.task } : {}),
      };
      delta.patch.push({ kind: 'workload', localId: `p-${turnIndex}-${delta.patch.length}`, targetFactId,
        changes: patchChanges as never, amountDelta });
    }
  }
  for (const id of turn.retract ?? []) delta.remove.push({ targetFactId: resolveFactId(state, taskNameForTurn, id) });
  if (turn.relation) {
    delta.relate.push({ kind: turn.relation.value, a: resolveRef(state, turn, taskNameForTurn, turn.relation.left), b: resolveRef(state, turn, taskNameForTurn, turn.relation.right) });
  }
  if (turn.answer?.value === 'defer') {
    const question = projectWeeklyPlanningVNext(state).questions.find((candidate) => candidate.code === turn.answer?.question);
    if (question) delta.defer.push({ questionKey: question.key });
  } else if (turn.answer?.value === 'estimate_60_minutes') {
    const question = projectWeeklyPlanningVNext(state).questions.find((candidate) => candidate.code === turn.answer?.question);
    if (question?.forWork) delta.add.push({ kind: 'effort_estimate', localId: `answer-${turnIndex}-estimate`,
      taskRef: { factId: question.taskId }, targetRef: { workLineageId: question.forWork.workLineageId },
      effortKind: 'total_duration', minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' });
  }
  return delta;
}

function applyFixture(state: WeeklyPlanningVNextState, fixture: ComparisonFixture): WeeklyPlanningVNextState {
  let current = state;
  fixture.turns.forEach((turn, index) => {
    let delta = toDelta(current, turn, index, fixture);
    if (turn.answer?.value === 'derived_remaining') {
      const question = projectWeeklyPlanningVNext(current).questions.find((candidate) => candidate.code === turn.answer?.question);
      if (question?.options[0]) delta = question.options[0].delta;
    }
    if (![delta.add, delta.patch, delta.remove, delta.relate, delta.defer].some((operations) => operations.length)) return;
    const result = applyWeeklyPlanningVNextTurn(current, delta, {
      turnKey: `${fixture.id}:${index + 1}`,
      expectedRevision: current.graph.revision,
      conversationId: fixture.id,
      turnId: `${fixture.id}:turn:${index + 1}`,
      sourceText: turn.utterance,
    });
    if (turn.expectedTransaction) expect(result.status, `${fixture.id} turn ${index + 1}: ${JSON.stringify('errors' in result ? result.errors : [])}`).toBe(turn.expectedTransaction);
    else expect(result.status, `${fixture.id} turn ${index + 1}: ${JSON.stringify('errors' in result ? result.errors : [])}`).toBe('applied');
    if (result.status === 'rejected') expect(result.state, `${fixture.id} turn ${index + 1} must roll back`).toBe(current);
    if (result.status === 'applied') current = result.state;
  });
  return current;
}

describe('VNext 21 revised-prototype cases', () => {
  it.each(prototypeFixtures)('$id: $name', (fixture) => {
    const state = applyFixture(createEmptyWeeklyPlanningVNextState(), fixture);
    const projection = projectWeeklyPlanningVNext(state);
    const expected = fixture.oracle;
    if (expected.outcome === 'question') {
      const matchesOracle = projection.owners.some((owner) => owner.status === 'question' && owner.question?.code === expected.question);
      expect(matchesOracle, `${fixture.id}: ${JSON.stringify(projection.owners)}`).toBe(true);
    } else if (expected.outcome === 'ready') {
      const ready = projection.owners.filter((owner) => owner.status === 'ready');
      expect(ready.length, fixture.id).toBeGreaterThan(0);
      if (expected.minutes !== undefined) expect(ready.flatMap((owner) => owner.work).reduce((sum, work) => sum + (work.minutes ?? 0), 0), fixture.id).toBe(expected.minutes);
    } else {
      expect(projection.owners.every((owner) => owner.status === 'nothing_to_schedule'), fixture.id).toBe(true);
    }
    expect(fixture.knownVNextGaps, `${fixture.id}: stale known VNext gap`).toBeUndefined();
  });
});

describe('VNext recorded and contract regressions', () => {
  it.each(regressionFixtures)('$id: $name', (fixture) => {
    const state = applyFixture(createEmptyWeeklyPlanningVNextState(), fixture);
    const projection = projectWeeklyPlanningVNext(state);
    const expected = fixture.oracle;
    if (expected.outcome === 'question') {
      const matchesOracle = projection.owners.some((owner) => owner.status === 'question' && owner.question?.code === expected.question);
      expect(matchesOracle, `${fixture.id}: ${JSON.stringify(projection.owners)}`).toBe(true);
    } else if (expected.outcome === 'ready') {
      const ready = projection.owners.filter((owner) => owner.status === 'ready');
      expect(ready.length, fixture.id).toBeGreaterThan(0);
      if (expected.minutes !== undefined) expect(ready.flatMap((owner) => owner.work).reduce((sum, work) => sum + (work.minutes ?? 0), 0), fixture.id).toBe(expected.minutes);
    } else {
      expect(projection.owners.every((owner) => owner.status === 'nothing_to_schedule'), fixture.id).toBe(true);
    }
    expect(fixture.knownVNextGaps, `${fixture.id}: stale known VNext gap`).toBeUndefined();
  });
});

describe('V5 saved-graph baseline comparisons', () => {
  it('#919 compares the saved V5 post-correction graph with the independent R7 oracle', () => {
    const graph = savedV5Graph([
      v5Workload('total', 'scope_total', 20),
      v5Workload('completed', 'completed', 12),
      v5Workload('remaining-7', 'remaining', 8, { source: v5Source('remaining-7:progress-rebase:rebased') }),
    ], [v5Effort('rate', 'duration_per_unit', 8, 'remaining-7')]);
    const comparison = compareWeeklyPlanningV5AndVNext(graph);
    expect(graph.workloads.find((fact) => fact.id === 'remaining-7')?.amount).toBe(8);
    expect(comparison.owners).toEqual([expect.objectContaining({
      difference: 'same',
      v5: expect.objectContaining({ amounts: [8], baseMinutes: 64 }),
      vnext: expect.objectContaining({ amounts: [8], minutes: 64 }),
    })]);
    // The independent oracle is still R7=7; V5's stored graph shows its known rewrite to 8.
    expect({ oracleExplicitRemaining: 7, observedV5Remaining: comparison.owners[0]?.v5.amounts[0] }).toEqual({ oracleExplicitRemaining: 7, observedV5Remaining: 8 });
  });

  it('records percent-derived V5 work and its adapter recomputation', () => {
    const derived = v5Workload('derived-remaining', 'remaining', 50, { source: v5Source('completed:derived-remaining-percent:derived-remaining') });
    const comparison = compareWeeklyPlanningV5AndVNext(savedV5Graph([
      v5Workload('total', 'scope_total', 100), v5Workload('completed', 'completed', 50), derived,
    ], [v5Effort('rate', 'duration_per_unit', 6, 'task-slides')]));
    expect(comparison.owners).toEqual([expect.objectContaining({ difference: 'same', v5: expect.objectContaining({ amounts: [50], baseMinutes: 300 }), vnext: expect.objectContaining({ amounts: [50], minutes: 300 }) })]);
    expect(comparison.adapterNotes).toContainEqual({ code: 'derived_workload_dropped', factId: 'derived-remaining' });
  });
});
