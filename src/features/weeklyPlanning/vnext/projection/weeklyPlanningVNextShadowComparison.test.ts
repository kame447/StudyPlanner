import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type EffortEstimateFactV5,
  type WeeklyPlanningFactGraphV5,
  type WorkloadFactV5,
} from '../../semantic/weeklyPlanningFactGraphV5';
import { projectWeeklyPlanningVNext } from './weeklyPlanningVNextProjection';
import { compareWeeklyPlanningV5AndVNext } from './weeklyPlanningVNextShadowComparison';
import { adaptWeeklyPlanningV5GraphToVNext } from './weeklyPlanningVNextV5Adapter';

const source = (semanticLocalId: string) => ({
  conversationId: 'conversation-shadow',
  turnId: 'turn-1',
  semanticLocalId,
  sourceText: 'fixture',
  origin: 'user' as const,
});

function workload(id: string, role: WorkloadFactV5['quantityRole'], amount: number, unit: Partial<WorkloadFactV5> = {}): WorkloadFactV5 {
  return {
    id, taskId: 'task-1', componentId: null, quantityRole: role, amount,
    unitCode: 'custom', unitLabel: '%', rangeStart: null, rangeEnd: null, perOccurrence: false,
    periodExpression: null, source: source(id), createdRevision: 1, ...unit,
  };
}

function effort(id: string, kind: EffortEstimateFactV5['kind'], minutes: number, targetFactId: string, unitCode: EffortEstimateFactV5['unitCode'] = null): EffortEstimateFactV5 {
  return { id, taskId: 'task-1', targetFactId, kind, minutes, unitCode, precision: 'exact', source: source(id), createdRevision: 1 };
}

function graph(workloads: WorkloadFactV5[], efforts: EffortEstimateFactV5[] = []): WeeklyPlanningFactGraphV5 {
  const empty = createEmptyWeeklyPlanningFactGraphV5();
  const facts = [{ id: 'task-1' }, ...workloads, ...efforts];
  return {
    ...empty,
    revision: 1,
    tasks: [{ id: 'task-1', category: 'study', title: '課題', source: source('task-1'), createdRevision: 1 }],
    workloads,
    effortEstimates: efforts,
    factLifecycles: facts.map((fact) => ({
      factId: fact.id, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null,
    })),
  };
}

describe('VNext V5 adapter and shadow comparison', () => {
  it('drops a stored percent remaining and recomputes the same work without writing the V5 graph', () => {
    const completed = workload('completed-50', 'completed', 50);
    const derived = workload('derived-50', 'remaining', 50, {
      source: source('completed-50:derived-remaining-percent:derived-50'),
    });
    const v5 = graph([completed, derived], [effort('rate', 'duration_per_unit', 6, 'task-1', 'custom')]);
    const before = structuredClone(v5);
    const comparison = compareWeeklyPlanningV5AndVNext(v5);
    expect(v5).toEqual(before);
    expect(comparison.owners).toEqual([expect.objectContaining({
      difference: 'same', v5: expect.objectContaining({ baseMinutes: 300 }), vnext: expect.objectContaining({ minutes: 300 }),
    })]);
    expect(comparison.adapterNotes).toContainEqual({ code: 'derived_workload_dropped', factId: 'derived-50' });
  });

  it('moves a total measured on a derived remaining onto the stated work at the amount it was stated for', () => {
    const completed = workload('completed-50', 'completed', 50);
    const derived = workload('derived-50', 'remaining', 50, {
      source: source('completed-50:derived-remaining-percent:derived-50'),
    });
    const { state, notes } = adaptWeeklyPlanningV5GraphToVNext(graph([completed, derived], [effort('total', 'total_duration', 60, 'derived-50')]));
    expect(notes).toContainEqual({ code: 'effort_bound', factId: 'total', workLineageId: 'completed-50', boundAmount: 50 });
    expect(state.graph.effortEstimates[0].targetFactId).toBe('completed-50');
    expect(projectWeeklyPlanningVNext(state).owners[0]).toMatchObject({ status: 'ready', work: [{ minutes: 60 }] });
  });

  it('keeps a V5-rebased remaining as stated but reports it (#919)', () => {
    const rebased = workload('rebased', 'remaining', 5, {
      unitCode: 'page', unitLabel: 'ページ', source: source('remaining-7:progress-rebase:rebased'),
    });
    const { notes } = adaptWeeklyPlanningV5GraphToVNext(graph([rebased]));
    expect(notes).toContainEqual({ code: 'rebased_remaining_kept', factId: 'rebased' });
  });

  it('classifies a V5 silent skip of other-basis work as a VNext question (#912)', () => {
    const target = workload('target', 'target', 5, { unitLabel: '枚' });
    const remaining = workload('remaining', 'remaining', 3, { unitLabel: 'セット' });
    const v5 = graph([target, remaining], [effort('rate', 'duration_per_unit', 8, 'target', 'custom')]);
    const [owner] = compareWeeklyPlanningV5AndVNext(v5).owners;
    expect(owner.difference).toBe('vnext_asks_v5_ready');
    expect(owner.v5.amounts).toEqual([5]);
    expect(owner.vnext.questionCode).toBe('same_or_distinct_work');
  });
});
