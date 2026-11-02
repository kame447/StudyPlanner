// Stable V5's provisional timebox (#305) in VNext: a deferral of a missing-estimate or missing-work
// question may carry scheduler permission to place V5's fixed block. It is never an amount or an estimate.
// V5 oracles: weeklyPlanningStableV5ProvisionalTimebox.test.ts, weeklyPlanningSemanticProvisionalTimeboxV5.test.ts.
import { describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5 } from '../../intake/weeklyPlanningProvisionalTimeboxStateV5';
import { WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION } from '../../application/weeklyPlanningStableV5SessionCodec';
import {
  parseWeeklyPlanningVNextSessionCheckpoint,
  WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY,
} from '../application/weeklyPlanningVNextSessionCheckpoint';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';

const context = { ownerId: 'owner', currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-08', timeZone: 'Asia/Tokyo' };
let counter = 0;
function apply(state: WeeklyPlanningVNextState, partial: Partial<VNextTurnDelta>) {
  counter += 1;
  return applyWeeklyPlanningVNextTurn(state, { add: [], patch: [], remove: [], relate: [], defer: [], ...partial }, {
    acceptedDate: '2026-11-02', weekStartsOn: 'monday', planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: `t${counter}`,
    expectedRevision: state.graph.revision, conversationId: 'c', turnId: `t${counter}`, sourceText: 'fixture',
  });
}
function turn(state: WeeklyPlanningVNextState, partial: Partial<VNextTurnDelta>): WeeklyPlanningVNextState {
  const result = apply(state, partial);
  if (result.status !== 'applied') throw new Error(JSON.stringify('errors' in result ? result.errors : result.status));
  return result.state;
}
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const pages = (localId: string, taskLocalId: string, quantityRole: 'target' | 'scope_total' | 'completed' | 'remaining', amount: number): VNextAddFact => ({
  kind: 'workload', localId, taskRef: { localId: taskLocalId }, componentRef: null, quantityRole, amount,
  unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null,
});
function compiled(state: WeeklyPlanningVNextState) {
  const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection: projectWeeklyPlanningVNext(state), context });
  if (result.status !== 'compiled' || !result.compilation.input) throw new Error('not compiled');
  return result.compilation.input;
}
const factCount = (state: WeeklyPlanningVNextState) => state.graph.workloads.length + state.graph.effortEstimates.length;

describe('VNext provisional timebox (Stable V5 parity)', () => {
  it('places V5\'s block for work with no estimate, after a plain deferral, without stating an amount or estimate', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'), pages('w', 't', 'target', 8)] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    expect(question.code).toBe('missing_effort_estimate');
    const facts = factCount(state);

    state = turn(state, { defer: [{ questionKey: question.key, allocation: 'none' }] });
    expect(compileWeeklyPlanningVNextSchedulerInput({ state, projection: projectWeeklyPlanningVNext(state), context }))
      .toMatchObject({ status: 'not_ready' });

    state = turn(state, { defer: [{ questionKey: question.key, allocation: 'provisional_timebox' }] });
    const projection = projectWeeklyPlanningVNext(state);
    expect(projection).toMatchObject({ readiness: 'ready', questions: [], deferredQuestions: [] });
    expect(projection.owners[0].work[0]).toMatchObject({ amount: 8, unitLabel: '枚',
      minutes: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5, estimateBasis: 'provisional_timebox', estimateFactIds: [] });
    expect(factCount(state)).toBe(facts);
    const [item] = compiled(state).movableWorkItems;
    // The placed block is V5's exact timebox: no estimate buffer on top (Astra P02).
    expect(item.baseEstimatedMinutes).toBe(WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5);
    expect(item.estimatedMinutes).toBe(WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5);
    expect(item.estimateSourceFactIds).toEqual([]);
    expect(item.sourceFactRefs).toContain(state.graph.workloads[0].id);
  });

  it('keeps the ordinary buffer for an estimate the user actually states', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'), pages('w', 't', 'target', 8)] });
    state = turn(state, { add: [{ kind: 'effort_estimate', localId: 'total', taskRef: { factId: state.graph.tasks[0].id },
      targetRef: { factId: state.graph.workloads[0].id }, effortKind: 'total_duration', minutes: 60,
      unitCode: null, unitLabel: null, precision: 'exact' }] });
    const [item] = compiled(state).movableWorkItems;
    expect(item.baseEstimatedMinutes).toBe(60);
    expect(item.estimatedMinutes).toBeGreaterThan(60);
  });

  it('lets a later stated estimate replace the provisional block', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'), pages('w', 't', 'target', 8)] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    state = turn(state, { defer: [{ questionKey: question.key, allocation: 'provisional_timebox' }] });
    state = turn(state, { add: [{ kind: 'effort_estimate', localId: 'rate', taskRef: { factId: state.graph.tasks[0].id },
      targetRef: { factId: state.graph.workloads[0].id }, effortKind: 'duration_per_unit', minutes: 5,
      unitCode: 'page', unitLabel: '枚', precision: 'exact' }] });
    expect(projectWeeklyPlanningVNext(state).owners[0].work[0]).toMatchObject({ minutes: 40, estimateBasis: 'rate' });
  });

  it('gives a task with no stated work V5\'s block, citing only the stated task', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '英語の音読')] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    expect(question.code).toBe('missing_schedulable_work');
    state = turn(state, { defer: [{ questionKey: question.key, allocation: 'provisional_timebox' }] });
    const [item] = compiled(state).movableWorkItems;
    expect(item.baseEstimatedMinutes).toBe(WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5);
    expect(item.sourceFactRefs).toEqual([state.graph.tasks[0].id]);
    expect(state.graph.workloads).toEqual([]);
  });

  it('rejects a provisional block for a question that is not about unknown effort', () => {
    const state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'),
      pages('total', 't', 'scope_total', 20), pages('done', 't', 'completed', 12), pages('left', 't', 'remaining', 7)] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    expect(question.code).toBe('remaining_inconsistent');
    const result = apply(state, { defer: [{ questionKey: question.key, allocation: 'provisional_timebox' }] });
    expect(result).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'invalid_value', path: 'defer[0].allocation' })] });
  });

  it('reads a deferral saved before allocations existed as a plain deferral', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'), pages('w', 't', 'target', 8)] });
    const [question] = projectWeeklyPlanningVNext(state).questions;
    state = turn(state, { defer: [{ questionKey: question.key, allocation: 'none' }] });
    const legacy = { ...state, deferrals: state.deferrals.map(({ questionKey, createdRevision }) => ({ questionKey, createdRevision })) };
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ ownerId: 'owner', weekStartDate: '2026-11-02', raw: JSON.stringify({
      version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION, requiredCapabilities: [WEEKLY_PLANNING_VNEXT_SESSION_CAPABILITY],
      ownerId: 'owner', weekStartDate: '2026-11-02', conversationId: 'c',
      vnext: { state: legacy, presentedQuestion: null, preview: null, messages: [] }, savedAt: '2026-11-02T00:00:00.000Z' }) });
    expect(parsed?.vnext.state.deferrals).toEqual([{ questionKey: question.key, allocation: 'none', createdRevision: state.deferrals[0].createdRevision }]);
  });
});
