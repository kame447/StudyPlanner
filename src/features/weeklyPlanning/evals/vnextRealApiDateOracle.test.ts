import { describe, expect, it } from 'vitest';
import { createWeeklyPlanningTurnRequestContext } from '../application/weeklyPlanningTemporalContext';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../vnext/semantic/weeklyPlanningVNextTransaction';
import type { VNextAddFact } from '../vnext/weeklyPlanningVNextTypes';
import { vnextRealApiConversations } from './vnextRealApiConversations';
import { compareRealApiDateMeaning, type RealApiDateMeaningOracle } from './vnextRealApiDateOracle';

const task: VNextAddFact = { kind: 'task', localId: 't', title: '英語', category: 'study' };
const window = (value: string): VNextAddFact => ({ kind: 'planning_window', localId: 'window',
  windowKind: 'absolute', value, start: value.split('/')[0], end: value.split('/')[1], yearBasis: null });
const bound = (kind: 'earliest_start' | 'latest_end' | 'deadline', date: string, target = 't'): VNextAddFact => ({
  kind: 'temporal_constraint', localId: `bound-${target}`, taskRef: { localId: target }, targetRef: { localId: target },
  constraintKind: kind, constraintLevel: 'hard', dateExpression: date, namedTimePeriod: null,
  startTime: null, endTime: null, precision: 'exact',
});
const recurrence = (day = 'weekday:monday'): VNextAddFact => ({ kind: 'recurrence', localId: 'repeat',
  taskRef: { localId: 't' }, targetRef: { localId: 't' }, recurrenceKind: 'weekly', days: [day], count: null });
function accepted(add: VNextAddFact[]) {
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(),
    { add, patch: [], remove: [], relate: [], defer: [] }, { expectedRevision: 0, acceptedDate: '2026-11-02',
      weekStartsOn: 'monday', planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
      defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
      turnKey: 'turn', conversationId: 'oracle', turnId: 'turn', sourceText: 'synthetic evidence' });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state.graph;
}
function compare(oracle: RealApiDateMeaningOracle, add: VNextAddFact[]) {
  const graph = accepted(add);
  return compareRealApiDateMeaning({ oracle, graph,
    requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-11-02T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }),
    taskIdsByKey: new Map([['english', graph.tasks[0]?.id]]) });
}

describe('#978 formerly excluded date meaning', () => {
  it('puts all historical comparison turns in scope, including the eight X0 turns', () => {
    expect(vnextRealApiConversations.flatMap(c => c.turns).filter(t => !t.oracle.inVNextScope)).toEqual([]);
    for (const id of ['issue881-final-b-deadline-at-13', 'issue881-final-c-corrected-completion']) {
      expect(vnextRealApiConversations.find(c => c.id === id)!.turns[0].oracle.dateMeaning?.planningWindow)
        .toEqual({ startDate: '2026-08-27', endDate: '2026-08-27' });
    }
    const slides = vnextRealApiConversations.find(c => c.id === 'issue881-final-c-corrected-completion')!;
    expect(slides.turns.slice(1).map(t => t.oracle.dateMeaning?.workDate))
      .toEqual(Array(3).fill({ task: 'slides', date: '2026-08-27' }));
  });

  it('requires the stated planning day, rather than accepting the default week or a different day', () => {
    const oracle = { planningWindow: { startDate: '2026-11-03', endDate: '2026-11-03' } };
    expect(compare(oracle, [window('2026-11-03/2026-11-03')])).toEqual([]);
    expect(compare(oracle, [task])).not.toEqual([]);
    expect(compare(oracle, [window('2026-11-04/2026-11-04')])).not.toEqual([]);
  });

  it.each(['deadline', 'latest_end', 'window'] as const)('accepts the same stated day represented as %s', kind => {
    expect(compare({ workDate: { task: 'english', date: '2026-11-03' } },
      [task, kind === 'window' ? window('2026-11-03/2026-11-03') : bound(kind, '2026-11-03')])).toEqual([]);
  });

  it('rejects missing, wrong-day and wrong-owner bounds even when the amount oracle matches', () => {
    const oracle = { workDate: { task: 'english', date: '2026-11-03' } };
    expect(compare(oracle, [task])).not.toEqual([]);
    expect(compare(oracle, [task, bound('deadline', '2026-11-04')])).not.toEqual([]);
    expect(compare(oracle, [task, { ...task, localId: 'other', title: '数学' }, bound('deadline', '2026-11-03', 'other')])).not.toEqual([]);
  });

  it.each(['bound', 'window'] as const)('accepts the next-week start as a %s and never supplies a missing start itself', kind => {
    const oracle = { recurrence: { kind: 'weekly' as const, days: ['weekday:monday'], startDate: '2026-11-09' } };
    const start = kind === 'window' ? window('2026-11-09/2026-11-15') : bound('earliest_start', 'next_week');
    expect(compare(oracle, [task, recurrence(), start])).toEqual([]);
    expect(compare(oracle, [task, recurrence()])).toContain('recurrence start missing: 2026-11-09');
    expect(compare(oracle, [task, recurrence('weekday:tuesday'), start])).toContain('weekly recurrence differs');
    expect(compare(oracle, [task, recurrence(), bound('earliest_start', '2026-11-16')])).not.toEqual([]);
  });
});
