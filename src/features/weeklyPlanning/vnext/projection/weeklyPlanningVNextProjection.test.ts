import { describe, expect, it } from 'vitest';
import {
  applyWeeklyPlanningVNextTurn,
  createEmptyWeeklyPlanningVNextState,
} from '../semantic/weeklyPlanningVNextTransaction';
import type {
  VNextAddEffort,
  VNextAddFact,
  VNextAddWorkload,
  VNextTurnDelta,
  WeeklyPlanningVNextState,
} from '../weeklyPlanningVNextTypes';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';

let turnCounter = 0;
function turn(state: WeeklyPlanningVNextState, partial: Partial<VNextTurnDelta>): WeeklyPlanningVNextState {
  turnCounter += 1;
  const result = applyWeeklyPlanningVNextTurn(
    state,
    { add: [], patch: [], remove: [], relate: [], defer: [], ...partial },
    {
      turnKey: `turn-${turnCounter}`,
      expectedRevision: state.graph.revision,
      conversationId: 'conversation',
      turnId: `turn-${turnCounter}`,
      sourceText: 'test utterance',
    },
  );
  if (result.status !== 'applied') throw new Error(`${result.status}: ${JSON.stringify('errors' in result ? result.errors : [])}`);
  return result.state;
}

const task: VNextAddFact = { kind: 'task', localId: 'task', category: 'study', title: 'スライド' };
function withTask(adds: VNextAddFact[]): WeeklyPlanningVNextState {
  return turn(createEmptyWeeklyPlanningVNextState(), { add: [task, ...adds] });
}
function taskId(state: WeeklyPlanningVNextState): string {
  return state.graph.tasks[0].id;
}
function W(localId: string, role: VNextAddWorkload['quantityRole'], amount: number, unitCode: VNextAddWorkload['unitCode'] = 'custom', unitLabel = '枚'): VNextAddWorkload {
  return {
    kind: 'workload', localId, taskRef: { localId: 'task' }, componentRef: null, quantityRole: role,
    amount, unitCode, unitLabel, rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
  };
}
function rate(localId: string, minutes: number, unitCode: VNextAddEffort['unitCode'] = 'custom', unitLabel: string | null = '枚'): VNextAddEffort {
  return {
    kind: 'effort_estimate', localId, taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
    effortKind: 'duration_per_unit', minutes, unitCode, unitLabel, precision: 'exact',
  };
}
function total(state: WeeklyPlanningVNextState, localId: string, workloadFactId: string, minutes: number): VNextAddEffort {
  return {
    kind: 'effort_estimate', localId, taskRef: { factId: taskId(state) }, targetRef: { factId: workloadFactId },
    effortKind: 'total_duration', minutes, unitCode: null, unitLabel: null, precision: 'exact',
  };
}
function active(state: WeeklyPlanningVNextState, role: string, unitCode?: string): string {
  const ids = new Set(state.graph.factLifecycles.filter((entry) => entry.status === 'active').map((entry) => entry.factId));
  const found = state.graph.workloads.find((workload) => ids.has(workload.id) && workload.quantityRole === role
    && (!unitCode || workload.unitCode === unitCode));
  if (!found) throw new Error(`no active ${role}`);
  return found.id;
}
const amountPatch = (localId: string, targetFactId: string, amount: number) => ({
  kind: 'workload' as const, localId, targetFactId, amountDelta: null,
  changes: { amount, unitCode: null, unitLabel: null, quantityRole: null, rangeStart: null, rangeEnd: null, perOccurrence: null, periodExpression: null },
});

describe('projectWeeklyPlanningVNext', () => {
  it('derives remaining from total and completed and asks an estimate bound to that amount', () => {
    const state = withTask([W('t', 'scope_total', 20), W('c', 'completed', 10)]);
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.readiness).toBe('needs_resolution');
    expect(projection.questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 10 } });
  });

  it('keeps the unit on a value-only completed correction and does not reuse a total bound to the old amount', () => {
    let state = withTask([W('t', 'scope_total', 20), W('c', 'completed', 10)]);
    state = turn(state, { add: [total(state, 'e80', active(state, 'scope_total'), 80)] });
    expect(projectWeeklyPlanningVNext(state).owners[0]).toMatchObject({ status: 'ready', work: [{ minutes: 80 }] });
    state = turn(state, { patch: [amountPatch('c12', active(state, 'completed'), 12)] });
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 8 } });
    expect(state.graph.workloads.find((workload) => workload.id === active(state, 'completed'))?.unitLabel).toBe('枚');
  });

  it('binds a same-turn quantity and total correction in either order (R8 + E60)', () => {
    for (const reversed of [false, true]) {
      let state = withTask([W('r', 'remaining', 10)]);
      state = turn(state, { add: [total(state, 'e80', active(state, 'remaining'), 80)] });
      const effortId = state.graph.effortEstimates[0].id;
      const patches = [
        amountPatch('r8', active(state, 'remaining'), 8),
        {
          kind: 'effort_estimate' as const, localId: 'e60', targetFactId: effortId,
          changes: { minutes: 60, effortKind: null, unitCode: null, unitLabel: null, precision: null },
        },
      ];
      state = turn(state, { patch: reversed ? patches.reverse() : patches });
      expect(projectWeeklyPlanningVNext(state).owners[0]).toMatchObject({ status: 'ready', work: [{ amount: 8, minutes: 60 }] });
    }
  });

  it('asks with machine options when a stated remaining disagrees with progress, and closes after the option', () => {
    let state = withTask([W('t', 'scope_total', 20), W('c', 'completed', 10), W('r', 'remaining', 10), rate('rate', 8)]);
    state = turn(state, { patch: [amountPatch('c12', active(state, 'completed'), 12)] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    expect(question.code).toBe('remaining_inconsistent');
    expect(question.options.map((option) => option.value)).toEqual([8, 10]);
    state = turn(state, question.options[0].delta);
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.questions).toEqual([]);
    expect(projection.owners[0].work[0].minutes).toBe(64);
  });

  it('never silently drops or double-counts other-basis work beside page progress', () => {
    const state = withTask([W('t', 'scope_total', 20), W('c', 'completed', 10), W('m', 'remaining', 45, 'minute', '分'), rate('rate', 8)]);
    const [question] = projectWeeklyPlanningVNext(state).questions;
    expect(question.code).toBe('same_or_distinct_work');
    const distinct = turn(state, question.options.find((option) => option.optionId === 'distinct')!.delta);
    const owner = projectWeeklyPlanningVNext(distinct).owners[0];
    expect(owner.work.reduce((sum, item) => sum + (item.minutes ?? 0), 0)).toBe(80 + 45);
  });

  it('treats a total stated for completed work as an observed pace', () => {
    let state = withTask([W('c', 'completed', 10, 'page', 'ページ'), W('r', 'remaining', 5, 'page', 'ページ')]);
    state = turn(state, { add: [total(state, 'pace', active(state, 'completed'), 80)] });
    expect(projectWeeklyPlanningVNext(state).owners[0].work[0]).toMatchObject({ minutes: 40, estimateBasis: 'observed_pace' });
  });

  it('stops an old custom rate after a real custom unit change', () => {
    let state = withTask([W('r', 'remaining', 10), rate('rate', 8)]);
    state = turn(state, { patch: [{ ...amountPatch('set', active(state, 'remaining'), 2), changes: { ...amountPatch('x', '', 2).changes, unitLabel: 'セット' } }] });
    expect(projectWeeklyPlanningVNext(state).questions[0].code).toBe('missing_effort_estimate');
  });

  it('surfaces a rate and a total that disagree instead of choosing one', () => {
    let state = withTask([W('r', 'remaining', 10), rate('rate', 8)]);
    state = turn(state, { add: [total(state, 'e60', active(state, 'remaining'), 60)] });
    expect(projectWeeklyPlanningVNext(state).questions[0].code).toBe('effort_inconsistent');
  });

  it('hides only the deferred question key', () => {
    let state = withTask([W('t', 'scope_total', 20), W('c', 'completed', 10)]);
    const key = projectWeeklyPlanningVNext(state).questions[0].key;
    state = turn(state, { defer: [{ questionKey: key }] });
    expect(projectWeeklyPlanningVNext(state)).toMatchObject({ questions: [], deferredQuestions: [{ key }] });
  });

  it('keeps owner, work and task-level rate after the task title is corrected', () => {
    let state = withTask([W('r', 'remaining', 10), rate('rate', 8)]);
    state = turn(state, { patch: [{
      kind: 'task', localId: 'title', targetFactId: taskId(state), changes: { category: null, title: 'スライド資料' },
    }] });
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection.owners).toHaveLength(1);
    expect(projection.owners[0]).toMatchObject({ status: 'ready', work: [{ minutes: 80 }] });
    expect(projection.owners[0].taskId).not.toBe(state.graph.tasks[0].id);
  });

  it('schedules a task with only a stated total time as minute work', () => {
    let state = withTask([]);
    state = turn(state, { add: [{ ...total(state, 'budget', taskId(state), 90), targetRef: { factId: taskId(state) } }] });
    expect(projectWeeklyPlanningVNext(state).owners[0]).toMatchObject({
      status: 'ready', work: [{ minutes: 90, estimateBasis: 'task_total' }],
    });
  });
});
