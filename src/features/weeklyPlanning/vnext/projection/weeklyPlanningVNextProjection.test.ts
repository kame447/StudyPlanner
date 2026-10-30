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

  it('asks how much for a task with no work, total or fixed time; closes with stated work (run 41001146547 native-45-minute)', () => {
    const session: VNextAddFact = { kind: 'effort_estimate', localId: 's', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
      effortKind: 'session_duration', minutes: 45, unitCode: 'minute', unitLabel: null, precision: 'exact' };
    const asked = withTask([session]);
    expect(projectWeeklyPlanningVNext(asked)).toMatchObject({ readiness: 'needs_resolution',
      questions: [{ code: 'missing_schedulable_work', taskId: taskId(asked), forWork: null, options: [] }] });
    // Closing path: an ordinary delta that states the work.
    const answered = turn(asked, { add: [{ ...W('w', 'target', 90, 'minute', '分'), taskRef: { factId: taskId(asked) } }] });
    expect(projectWeeklyPlanningVNext(answered)).toMatchObject({ readiness: 'ready', questions: [] });
  });

  it('does not ask for missing work when a task is a fixed event or reports progress only', () => {
    const fixed = withTask([{ kind: 'temporal_constraint', localId: 'f', taskRef: { localId: 'task' }, targetRef: { localId: 'task' },
      constraintKind: 'fixed_interval', constraintLevel: 'hard', dateExpression: '2026-11-03', namedTimePeriod: null,
      startTime: '10:00', endTime: '11:00', precision: 'exact' }]);
    expect(projectWeeklyPlanningVNext(fixed).questions).toEqual([]);
    expect(projectWeeklyPlanningVNext(withTask([W('done', 'completed', 30, 'minute', '分')])))
      .toMatchObject({ questions: [], owners: [{ status: 'nothing_to_schedule' }] });
  });

  it('schedules a task with only a stated total time as minute work', () => {
    let state = withTask([]);
    state = turn(state, { add: [{ ...total(state, 'budget', taskId(state), 90), targetRef: { factId: taskId(state) } }] });
    expect(projectWeeklyPlanningVNext(state).owners[0]).toMatchObject({
      status: 'ready', work: [{ minutes: 90, estimateBasis: 'task_total' }],
    });
  });

  describe('Astra audit #926 counterexamples (GustyCurie, c22f0627)', () => {
    const page = (localId: string, role: VNextAddWorkload['quantityRole'], amount: number, extra: Partial<VNextAddWorkload> = {}) =>
      ({ ...W(localId, role, amount, 'page', 'ページ'), ...extra });
    const component = (localId: string): VNextAddFact => ({
      kind: 'component', localId, taskRef: { localId: 'task' }, parentComponentRef: null, role: 'chapter', label: localId,
    });
    const minutesOf = (state: WeeklyPlanningVNextState) =>
      projectWeeklyPlanningVNext(state).owners.flatMap((owner) => owner.work).map((item) => item.minutes);

    it('A01 two stated works without a target can always be closed by keeping one', () => {
      let state = withTask([page('a', 'remaining', 10), W('b', 'remaining', 45, 'minute', '分'), rate('rate', 4, 'page', null)]);
      const [question] = projectWeeklyPlanningVNext(state).questions;
      expect(question.code).toBe('same_or_distinct_work');
      expect(question.options.map((option) => option.optionId)).not.toContain('same');
      const keep = question.options.find((option) => option.optionId.startsWith('keep:') && option.value === 10)!;
      state = turn(state, keep.delta);
      expect(projectWeeklyPlanningVNext(state)).toMatchObject({ questions: [], readiness: 'ready' });
      expect(minutesOf(state)).toEqual([40]);
    });

    it('A02 two targets on different bases are asked, not both scheduled', () => {
      const state = withTask([page('a', 'target', 10), W('b', 'target', 40, 'minute', '分'), rate('rate', 4, 'page', null)]);
      expect(projectWeeklyPlanningVNext(state).questions[0]?.code).toBe('same_or_distinct_work');
    });

    it('A03 an estimate answer for percent progress binds to the remaining amount', () => {
      let state = withTask([W('c', 'completed', 20, 'custom', '％')]);
      const [question] = projectWeeklyPlanningVNext(state).questions;
      expect(question.forWork?.amount).toBe(80);
      state = turn(state, { add: [{ ...total(state, 'answer', '', 60), targetRef: { workLineageId: question.forWork!.workLineageId } }] });
      expect(minutesOf(state)).toEqual([60]);
    });

    it('A04 an implied percent total still detects an inconsistent stated remaining', () => {
      const state = withTask([W('c', 'completed', 20, 'custom', '%'), W('r', 'remaining', 90, 'custom', '%'), rate('rate', 1, 'custom', '%')]);
      const [question] = projectWeeklyPlanningVNext(state).questions;
      expect(question.code).toBe('remaining_inconsistent');
      expect(question.options.map((option) => option.value)).toEqual([80, 10]);
    });

    it('A05 component totals are scoped to their component, not the whole task', () => {
      const componentTotal = (localId: string, target: string, minutes: number): VNextAddEffort => ({
        kind: 'effort_estimate', localId, taskRef: { localId: 'task' }, targetRef: { localId: target },
        effortKind: 'total_duration', minutes, unitCode: null, unitLabel: null, precision: 'exact',
      });
      const state = withTask([
        component('a'), component('b'),
        page('a-work', 'remaining', 10, { componentRef: { localId: 'a' } }),
        page('b-work', 'remaining', 5, { componentRef: { localId: 'b' } }),
        componentTotal('a-total', 'a', 30), componentTotal('b-total', 'b', 20),
      ]);
      expect(minutesOf(state)).toEqual([30, 20]);
    });

    it('A08 a total stops applying after a real unit change with an equal count', () => {
      let state = withTask([W('r', 'remaining', 10)]);
      state = turn(state, { add: [total(state, 'e60', active(state, 'remaining'), 60)] });
      state = turn(state, { patch: [{ ...amountPatch('set', active(state, 'remaining'), 10),
        changes: { ...amountPatch('x', '', 0).changes, amount: null, unitLabel: 'セット' } }] });
      expect(projectWeeklyPlanningVNext(state).questions[0]?.code).toBe('missing_effort_estimate');
    });

    it('A09 an observed pace stops applying when the completed amount it measured is corrected', () => {
      let state = withTask([page('c', 'completed', 10), page('r', 'remaining', 5)]);
      state = turn(state, { add: [total(state, 'pace', active(state, 'completed'), 80)] });
      expect(minutesOf(state)).toEqual([40]);
      state = turn(state, { patch: [amountPatch('c20', active(state, 'completed'), 20)] });
      expect(projectWeeklyPlanningVNext(state).questions[0]?.code).toBe('missing_effort_estimate');
    });

    it('A10 a task total applies after "same" leaves a single scheduled work', () => {
      let state = withTask([page('a', 'target', 10), W('b', 'remaining', 45, 'minute', '分')]);
      state = turn(state, { add: [{ ...total(state, 'budget', taskId(state), 60) }] });
      const [question] = projectWeeklyPlanningVNext(state).questions;
      state = turn(state, question.options.find((option) => option.optionId === 'same')!.delta);
      expect(minutesOf(state)).toEqual([60]);
    });

    it('A11 the "completed follows remaining" option for zero progress is executable', () => {
      const state = withTask([page('t', 'scope_total', 20), page('c', 'completed', 10), page('r', 'remaining', 20), rate('rate', 1, 'page', null)]);
      const option = projectWeeklyPlanningVNext(state).questions[0].options.find((candidate) => candidate.optionId === 'completed_follows_remaining')!;
      expect(option.value).toBe(0);
      const next = turn(state, option.delta);
      expect(projectWeeklyPlanningVNext(next)).toMatchObject({ questions: [], owners: [{ work: [{ amount: 20, minutes: 20 }] }] });
    });

    it('A12 a deferred inconsistency returns when the values it asked about change', () => {
      let state = withTask([page('t', 'scope_total', 20), page('c', 'completed', 10), page('r', 'remaining', 7)]);
      state = turn(state, { defer: [{ questionKey: projectWeeklyPlanningVNext(state).questions[0].key }] });
      expect(projectWeeklyPlanningVNext(state).questions).toEqual([]);
      state = turn(state, { patch: [amountPatch('c12', active(state, 'completed'), 12)] });
      expect(projectWeeklyPlanningVNext(state).questions[0]?.code).toBe('remaining_inconsistent');
    });

    it('R01 a total stated for completed percent progress is an observed pace', () => {
      let state = withTask([W('c', 'completed', 20, 'custom', '%')]);
      state = turn(state, { add: [total(state, 'observed', active(state, 'completed'), 60)] });
      expect(projectWeeklyPlanningVNext(state).owners[0].work[0]).toMatchObject({ minutes: 240, estimateBasis: 'observed_pace' });
    });

    it('R02 the zero-remaining option is executable when all work is done', () => {
      const state = withTask([page('t', 'scope_total', 20), page('c', 'completed', 20), page('r', 'remaining', 5)]);
      const option = projectWeeklyPlanningVNext(state).questions[0].options.find((candidate) => candidate.optionId === 'remaining_follows_progress')!;
      expect(option.value).toBe(0);
      expect(projectWeeklyPlanningVNext(turn(state, option.delta))).toMatchObject({ questions: [], readiness: 'empty' });
    });

    it('R03 keeping one statement also removes a rate aimed only at the dropped one', () => {
      let state = withTask([page('a', 'remaining', 10), W('b', 'remaining', 45, 'minute', '分')]);
      state = turn(state, { add: [{ ...rate('rate', 4, 'page', null), taskRef: { factId: taskId(state) }, targetRef: { factId: active(state, 'remaining', 'page') } }] });
      const keep = projectWeeklyPlanningVNext(state).questions[0].options.find((option) => option.value === 45)!;
      expect(minutesOf(turn(state, keep.delta))).toEqual([45]);
    });

    it('R04 a valid answer about the current owner is accepted after a task rename', () => {
      let state = withTask([page('r', 'remaining', 10)]);
      state = turn(state, { patch: [{ kind: 'task', localId: 'renamed', targetFactId: taskId(state), changes: { category: null, title: '新しい名前' } }] });
      const [question] = projectWeeklyPlanningVNext(state).questions;
      state = turn(state, { add: [{ ...total(state, 'answer', question.forWork!.definingFactId, 60), taskRef: { factId: question.taskId } }] });
      expect(minutesOf(state)).toEqual([60]);
    });

    it('R05 a range with only one end is rejected, as V5 blocks it', () => {
      const state = withTask([page('r', 'remaining', 10)]);
      const result = applyWeeklyPlanningVNextTurn(state, {
        add: [], remove: [], relate: [], defer: [],
        patch: [{ ...amountPatch('half', active(state, 'remaining'), 0), changes: { ...amountPatch('x', '', 0).changes, amount: null, rangeStart: '1' } }],
      }, { turnKey: 'half-range', expectedRevision: state.graph.revision, conversationId: 'conversation', turnId: 'half-range', sourceText: '1ページから' });
      expect(result).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'invalid_value', path: 'patch[0].changes.rangeEnd' })] });
    });

    it('S01 a remaining-percent answer measures that amount and is asked again after progress changes', () => {
      let state = withTask([W('c', 'completed', 20, 'custom', '%')]);
      const [question] = projectWeeklyPlanningVNext(state).questions;
      state = turn(state, { add: [{ ...total(state, 'answer', '', 60), targetRef: { workLineageId: question.forWork!.workLineageId } }] });
      expect(state.graph.effortEstimates[0].workBinding).toMatchObject({ kind: 'future_work', boundAmount: 80 });
      expect(minutesOf(state)).toEqual([60]);
      state = turn(state, { patch: [amountPatch('c40', active(state, 'completed'), 40)] });
      expect(projectWeeklyPlanningVNext(state).questions[0]).toMatchObject({ code: 'missing_effort_estimate', forWork: { amount: 60 } });
    });

    it('S05 an answer after renaming the task binds to the asked work', () => {
      let state = withTask([W('c', 'completed', 20, 'custom', '%')]);
      state = turn(state, { patch: [{ kind: 'task', localId: 'renamed', targetFactId: taskId(state), changes: { category: null, title: '別名' } }] });
      const [question] = projectWeeklyPlanningVNext(state).questions;
      state = turn(state, { add: [{ ...total(state, 'answer', '', 60), taskRef: { factId: question.taskId }, targetRef: { workLineageId: question.forWork!.workLineageId } }] });
      expect(minutesOf(state)).toEqual([60]);
    });

    it('fails closed on a one-ended range saved before VNext instead of scheduling it', () => {
      const state = withTask([page('r', 'remaining', 10), rate('rate', 2, 'page', null)]);
      const legacy = structuredClone(state);
      legacy.graph.workloads[0] = { ...legacy.graph.workloads[0], rangeStart: '1' };
      expect(projectWeeklyPlanningVNext(legacy)).toMatchObject({ readiness: 'needs_resolution', questions: [{ code: 'quantity_basis_invalid' }] });
    });
  });
});
