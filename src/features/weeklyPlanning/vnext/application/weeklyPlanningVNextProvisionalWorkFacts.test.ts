import { describe, expect, it } from 'vitest';
import { WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5 } from '../../intake/weeklyPlanningProvisionalTimeboxStateV5';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import type { VNextAddFact, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createWeeklyPlanningVNextRenderInput } from './weeklyPlanningVNextDialogue';
import { vnextProvisionalWorkFacts } from './weeklyPlanningVNextProvisionalWorkFacts';

// Stage B SB9 option 1: a provisionally placed work reaches the renderer as a typed fact, and only while its preview is current.
let counter = 0;
function turn(state: WeeklyPlanningVNextState, partial: Partial<VNextTurnDelta>): WeeklyPlanningVNextState {
  counter += 1;
  const result = applyWeeklyPlanningVNextTurn(state, { add: [], patch: [], remove: [], relate: [], defer: [], ...partial }, {
    acceptedDate: '2026-11-02', weekStartsOn: 'monday', planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' }, turnKey: `t${counter}`,
    expectedRevision: state.graph.revision, conversationId: 'c', turnId: `t${counter}`, sourceText: 'fixture' });
  if (result.status !== 'applied') throw new Error(JSON.stringify('errors' in result ? result.errors : result.status));
  return result.state;
}
const task = (localId: string, title: string): VNextAddFact => ({ kind: 'task', localId, category: 'study', title });
const pages = (localId: string, taskLocalId: string, amount: number): VNextAddFact => ({ kind: 'workload', localId, taskRef: { localId: taskLocalId },
  componentRef: null, quantityRole: 'target', amount, unitCode: 'page', unitLabel: '枚', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null });
const preview = (state: WeeklyPlanningVNextState, graphRevision = state.graph.revision) => ({ previewId: 'p', graphRevision, blocks: [] });
const facts = (state: WeeklyPlanningVNextState, shown: { graphRevision: number } | null = preview(state)) =>
  vnextProvisionalWorkFacts({ state, projection: projectWeeklyPlanningVNext(state), preview: shown });
const deferProvisionally = (state: WeeklyPlanningVNextState) => turn(state, { defer: projectWeeklyPlanningVNext(state).questions
  .map(question => ({ questionKey: question.key, allocation: 'provisional_timebox' as const })) });

describe('provisional work facts for the renderer (Stage B SB9 option 1)', () => {
  it('names a work placed only with the provisional timebox, with the timebox minutes', () => {
    const state = deferProvisionally(turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'), pages('w', 't', 8)] }));
    expect(facts(state)).toEqual([{ taskId: state.graph.tasks[0].id, label: '数学プリント', minutes: WEEKLY_PLANNING_PROVISIONAL_TIMEBOX_MINUTES_V5 }]);
  });

  it('includes only the provisional works when another work has a stated estimate', () => {
    let state = turn(createEmptyWeeklyPlanningVNextState(), { add: [task('m', '数学'), pages('mw', 'm', 8), task('e', '英語'), pages('ew', 'e', 5)] });
    const english = state.graph.workloads[1];
    state = turn(state, { add: [{ kind: 'effort_estimate', localId: 'est', taskRef: { factId: english.taskId }, targetRef: { factId: english.id },
      effortKind: 'total_duration', minutes: 30, unitCode: null, unitLabel: null, precision: 'exact' }] });
    state = deferProvisionally(state);
    expect(facts(state).map(fact => fact.label)).toEqual(['数学']);
  });

  it('gives nothing once the work has a stated estimate (the provisional block is replaced), without a preview, or for a stale preview', () => {
    const provisional = deferProvisionally(turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'), pages('w', 't', 8)] }));
    expect(facts(provisional, null)).toEqual([]);
    expect(facts(provisional, preview(provisional, provisional.graph.revision - 1))).toEqual([]);
    const estimated = turn(provisional, { add: [{ kind: 'effort_estimate', localId: 'est', taskRef: { factId: provisional.graph.tasks[0].id },
      targetRef: { factId: provisional.graph.workloads[0].id }, effortKind: 'total_duration', minutes: 60, unitCode: null, unitLabel: null, precision: 'exact' }] });
    expect(facts(estimated)).toEqual([]);
  });

  it('puts the fact on the render input only when there is one, and leaves every other render input unchanged', () => {
    const state = deferProvisionally(turn(createEmptyWeeklyPlanningVNextState(), { add: [task('t', '数学プリント'), pages('w', 't', 8)] }));
    const base = { state, question: null, preview: preview(state) as never, actionId: 'a', turnId: 't', previousQuestionCode: null, userText: '仮でいいです', recentConversation: [] };
    const withFact = createWeeklyPlanningVNextRenderInput({ ...base, provisionalWork: facts(state) });
    expect(withFact.communication.provisionalWork).toEqual([{ taskId: state.graph.tasks[0].id, label: '数学プリント', minutes: 60 }]);
    const without = createWeeklyPlanningVNextRenderInput({ ...base, provisionalWork: [] });
    expect(without.communication).not.toHaveProperty('provisionalWork');
    expect(without).toEqual(createWeeklyPlanningVNextRenderInput({ ...base }));
  });
});
