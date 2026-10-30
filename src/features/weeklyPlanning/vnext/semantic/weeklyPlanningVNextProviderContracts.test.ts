import { describe, expect, it } from 'vitest';
import type { VNextAddFact, VNextTurnDelta } from '../weeklyPlanningVNextTypes';
import { resolveWeeklyPlanningVNextTurnDelta } from '../application/weeklyPlanningVNextAnswerBinding';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';

const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const task: VNextAddFact = { kind: 'task', localId: 't', category: 'study', title: 'Synthetic reading' };
const workload: VNextAddFact = { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null,
  quantityRole: 'remaining', amount: 8, unitCode: 'page', unitLabel: 'ページ', rangeStart: null, rangeEnd: null,
  perOccurrence: false, periodExpression: null };
const context = { expectedRevision: 0, turnKey: 'setup', conversationId: 'synthetic-contract', turnId: 'setup',
  sourceText: 'Synthetic contract test', acceptedDate: '2026-08-26', weekStartsOn: 'monday' as const,
  planningHorizon: { startDate: '2026-08-24', endDate: '2026-08-30' } };

describe('controlled native-provider contract experiments without a model', () => {
  it('distinguishes 8 minutes for the whole work from 8 minutes per unit at the same question', () => {
    const seed = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [task, workload] }, context);
    if (seed.status !== 'applied') throw new Error(JSON.stringify(seed));
    const projection = projectWeeklyPlanningVNext(seed.state);
    const question = projection.questions[0];
    expect(question.code).toBe('missing_effort_estimate');
    for (const per of ['whole_work', 'unit'] as const) {
      const bound = resolveWeeklyPlanningVNextTurnDelta({ presentationFresh: true,
        presented: { questionKey: question.key, graphRevision: projection.graphRevision }, projection,
        graph: seed.state.graph,
        interpreted: { delta: empty(), answer: { kind: 'estimate_minutes', minutes: 8, per } } });
      if (bound.status !== 'delta') throw new Error('answer did not bind');
      const result = applyWeeklyPlanningVNextTurn(seed.state, bound.delta, { ...context, expectedRevision: seed.state.graph.revision, turnKey: per });
      if (result.status !== 'applied') throw new Error(JSON.stringify(result));
      expect(projectWeeklyPlanningVNext(result.state).owners[0].work[0].minutes).toBe(per === 'unit' ? 64 : 8);
      expect(result.state.graph.effortEstimates[0].minutes).toBe(8);
    }
  });

  it('accepts a task/component temporal target but rejects a workload target with all other fields held equal', () => {
    const seed = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [task, workload,
      { kind: 'component', localId: 'c', taskRef: { localId: 't' }, parentComponentRef: null, role: 'material', label: 'Book' }] }, context);
    if (seed.status !== 'applied') throw new Error(JSON.stringify(seed));
    const taskId = seed.state.graph.tasks[0].id;
    for (const [target, accepted] of [[taskId, true], [seed.state.graph.components[0].id, true], [seed.state.graph.workloads[0].id, false]] as const) {
      const result = applyWeeklyPlanningVNextTurn(seed.state, { ...empty(), add: [{ kind: 'temporal_constraint', localId: 'deadline',
        taskRef: { factId: taskId }, targetRef: { factId: target }, constraintKind: 'deadline', constraintLevel: 'hard',
        dateExpression: 'tomorrow', namedTimePeriod: null, startTime: null, endTime: '13:00', precision: 'exact' }] },
      { ...context, expectedRevision: seed.state.graph.revision, turnKey: 'deadline' });
      expect(result.status).toBe(accepted ? 'applied' : 'rejected');
      if (result.status === 'rejected') expect(result.errors).toContainEqual(expect.objectContaining({ path: 'add[0].targetRef' }));
    }
  });
});
