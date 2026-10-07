import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { projectWeeklyPlanningPreviewConstraintSatisfaction as project } from './weeklyPlanningPreviewConstraintSatisfaction';

const meta = { createdRevision: 1, source: {
  conversationId: 'truth', turnId: 'turn', semanticLocalId: 'fact', sourceText: 'user evidence', origin: 'user' as const,
} };

function fixture() {
  const graph: WeeklyPlanningFactGraphV5 = {
    ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    tasks: ['research', 'book'].map(id => ({ id, title: id, category: 'study', ...meta })),
    workloads: ['research', 'book'].map(taskId => ({
      id: `${taskId}-work`, taskId, componentId: null, quantityRole: 'target', amount: 120,
      unitCode: 'minute', unitLabel: 'min', rangeStart: null, rangeEnd: null, perOccurrence: false,
      periodExpression: null, ...meta,
    })),
    effortEstimates: [{
      id: 'session', taskId: 'research', targetFactId: 'research', kind: 'session_duration', minutes: 60,
      unitCode: 'session', precision: 'approximate', ...meta,
    }],
    temporalConstraints: [{
      id: 'night', taskId: 'research', targetFactId: 'research', kind: 'preferred_window', constraintLevel: 'soft',
      dateExpression: null, namedTimePeriod: null, startTime: '18:00', endTime: '22:00', precision: 'exact', ...meta,
    }],
  };
  const schedulerInput = compileGenericSchedulerInput({ graph, context: {
    ownerId: 'owner', currentDate: '2026-10-07', planningStartDate: '2026-10-12', planningEndDate: '2026-10-18', timeZone: 'Asia/Tokyo',
  } }).input!;
  const { candidates } = scheduleWeeklyPlanningStableV5Preview({ input: schedulerInput, graph: createWeeklyPlanningPlacementGraphViewV5(graph) });
  return { graph, schedulerInput, candidates };
}

describe('read-only actual preview constraint evidence', () => {
  it('reports scoped preference and session satisfaction from the actual candidates', () => {
    const state = fixture();
    const before = structuredClone(state);
    expect(project(state)).toEqual([
      { sourceFactId: 'night', taskId: 'research', taskLabel: 'research', kind: 'preferred_window', status: 'satisfied' },
      { sourceFactId: 'session', taskId: 'research', taskLabel: 'research', kind: 'session_duration', status: 'satisfied' },
    ]);
    expect(state).toEqual(before);
  });

  it('reports a single misplaced session even if the other session honors the preference', () => {
    const state = fixture();
    const item = state.schedulerInput.movableWorkItems.find(item => item.taskId === 'research')!;
    const candidate = state.candidates.find(candidate => candidate.workItemKey === item.id)!;
    candidate.startTime = '09:00';
    candidate.endTime = '10:00';
    expect(project(state)).toMatchObject([{ status: 'not_satisfied' }, { status: 'satisfied' }]);
  });

  it.each(['absent', 'clock-dropped'] as const)('does not infer satisfaction when compilation is %s', failure => {
    const state = fixture();
    state.schedulerInput.preferredPlacements = failure === 'absent' ? []
      : state.schedulerInput.preferredPlacements.map(placement => ({ ...placement, window: null }));
    expect(project(state)[0].status).toBe('not_evaluated');
  });

  it('requires the candidate date as well as its clock time to match', () => {
    const state = fixture();
    state.schedulerInput.preferredPlacements.forEach(placement => { placement.dates = ['2026-10-18']; });
    expect(project(state)[0].status).toBe('not_satisfied');
  });

  it('evaluates alternative dates as a union and still rejects a session outside that union', () => {
    const state = fixture();
    const first = state.graph.temporalConstraints[0];
    state.graph.temporalConstraints.push({ ...first, id: 'other-night' });
    const placement = state.schedulerInput.preferredPlacements[0];
    placement.dates = ['2026-10-12'];
    state.schedulerInput.preferredPlacements.push({ ...placement, sourceFactId: 'other-night', dates: ['2026-10-13'] });
    expect(project(state).filter(fact => fact.kind === 'preferred_window').map(fact => fact.status))
      .toEqual(['satisfied', 'satisfied']);
    state.candidates.find(candidate => candidate.title.includes('research'))!.date = '2026-10-14';
    expect(project(state).filter(fact => fact.kind === 'preferred_window').map(fact => fact.status))
      .toEqual(['not_satisfied', 'not_satisfied']);
  });

  it('does not silently discard an alternative whose compiled placement is missing', () => {
    const state = fixture();
    state.graph.temporalConstraints.push({ ...state.graph.temporalConstraints[0], id: 'uncompiled-night' });
    expect(project(state).filter(fact => fact.kind === 'preferred_window').map(fact => fact.status))
      .toEqual(['not_evaluated', 'not_evaluated']);
  });

  it('does not satisfy a task with another task’s windows', () => {
    const state = fixture();
    state.graph.temporalConstraints.push({ ...state.graph.temporalConstraints[0], id: 'book-night', taskId: 'book', targetFactId: 'book' });
    state.schedulerInput.preferredPlacements.push({ ...state.schedulerInput.preferredPlacements[0],
      sourceFactId: 'book-night', taskId: 'book', targetFactId: 'book' });
    expect(project(state).filter(fact => fact.kind === 'preferred_window')).toMatchObject([
      { taskId: 'research', status: 'satisfied' }, { taskId: 'book', status: 'not_satisfied' },
    ]);
  });

  it('does not count unrelated task placement as failure or success for this task', () => {
    const state = fixture();
    const bookId = state.schedulerInput.movableWorkItems.find(item => item.taskId === 'book')!.id;
    const book = state.candidates.find(candidate => candidate.workItemKey === bookId)!;
    book.startTime = '03:00'; book.endTime = '05:00';
    expect(project(state)[0].status).toBe('satisfied');
    state.candidates = [book];
    expect(project(state).every(fact => fact.status === 'not_evaluated')).toBe(true);
  });

  it('does not describe a missing session as a fully satisfied preference', () => {
    const state = fixture();
    state.candidates = state.candidates.slice(1);
    expect(project(state).every(fact => fact.status !== 'satisfied')).toBe(true);
  });

  it('flags a session that was split further by placement', () => {
    const state = fixture();
    const item = state.schedulerInput.movableWorkItems.find(item => item.taskId === 'research')!;
    const candidate = state.candidates.find(candidate => candidate.workItemKey === item.id)!;
    const start = candidate.startTime;
    candidate.endTime = `${start.slice(0, 2)}:30`;
    candidate.durationMinutes = 30;
    state.candidates.push({ ...candidate, stableKey: 'extra', startTime: candidate.endTime, endTime: `${Number(start.slice(0, 2)) + 1}:00` });
    expect(project(state).find(fact => fact.kind === 'session_duration')?.status).toBe('not_satisfied');
  });
});
