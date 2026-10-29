import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningVNextTurn,
  createEmptyWeeklyPlanningVNextState,
} from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import type {
  VNextAddFact,
  VNextFactRef,
  VNextPatch,
  VNextTurnDelta,
  WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import { prototypeFixtures, type ComparisonFixture, type FixtureTurn, type FactInput } from '../../evals/vnextComparisonFixtures';

const emptyDelta = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task';

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
    const temporal = activeFacts(state, 'temporalConstraints').find((fact) => fact.taskId === activeFacts(state, 'tasks').find((task) => task.title === taskName)?.id);
    return alias === 'invalid-deadline' ? 'missing:deadline' : temporal?.id ?? 'missing:deadline';
  }
  if (alias === 'effort') {
    return activeFacts(state, 'effortEstimates').find((fact) => fact.taskId === activeFacts(state, 'tasks').find((task) => task.title === taskName)?.id)?.id ?? 'missing:effort';
  }
  const workloads = activeFacts(state, 'workloads').filter((fact) => fact.taskId === activeFacts(state, 'tasks').find((task) => task.title === taskName)?.id);
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
  return activeFacts(state, 'tasks').find((fact) => fact.title === taskName)?.id ?? null;
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
    const taskName = inputs[0]?.task ?? 'slides';
    const targetFactId = resolveFactId(state, taskName, patch.target);
    const changes = patch.changes;
    if (patch.target === 'task-category' || 'category' in changes) {
      delta.patch.push({ kind: 'task', localId: `p-${turnIndex}-${delta.patch.length}`, targetFactId,
        changes: { category: typeof changes.category === 'string' ? changes.category as never : null, title: null } });
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
  for (const id of turn.retract ?? []) delta.remove.push({ targetFactId: resolveFactId(state, inputs[0]?.task ?? 'slides', id) });
  if (turn.relation) {
    const taskName = inputs[0]?.task ?? fixture.turns[0]?.facts?.[0]?.task ?? 'slides';
    delta.relate.push({ kind: turn.relation.value, a: resolveRef(state, turn, taskName, turn.relation.left), b: resolveRef(state, turn, taskName, turn.relation.right) });
  }
  if (turn.answer?.value === 'defer') {
    const question = projectWeeklyPlanningVNext(state).questions.find((candidate) => candidate.code === turn.answer?.question);
    if (question) delta.defer.push({ questionKey: question.key });
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
      expect(projection.owners.some((owner) => owner.status === 'question' && owner.question?.code === expected.question), fixture.id).toBe(true);
    } else if (expected.outcome === 'ready') {
      const ready = projection.owners.filter((owner) => owner.status === 'ready');
      expect(ready.length, fixture.id).toBeGreaterThan(0);
      if (expected.minutes !== undefined) expect(ready.flatMap((owner) => owner.work).reduce((sum, work) => sum + (work.minutes ?? 0), 0), fixture.id).toBe(expected.minutes);
    } else {
      expect(projection.owners.every((owner) => owner.status === 'nothing_to_schedule'), fixture.id).toBe(true);
    }
  });
});
