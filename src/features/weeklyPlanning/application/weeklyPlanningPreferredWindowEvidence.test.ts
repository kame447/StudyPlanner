import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import type { WeeklyPlanningStableV5PreviewProvenance } from '../weeklyPlanningPreviewProvenance';
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

describe('preferred-window actual preview evidence from original Issue488', () => {
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

  it.each(['task', 'revision', 'work-key', 'metadata'] as const)('does not trust candidates with invalid %s identity', change => {
    const state = fixture();
    for (const candidate of state.candidates.filter(candidate => candidate.title.includes('research'))) {
      const value = candidate as typeof candidate & { stableV5Metadata?: WeeklyPlanningStableV5PreviewProvenance };
      if (change === 'metadata') delete value.stableV5Metadata;
      else if (change === 'task') value.stableV5Metadata!.taskId = 'book';
      else if (change === 'revision') value.stableV5Metadata!.graphRevision += 1;
      else candidate.workItemKey = 'foreign';
    }
    expect(project(state).find(entry => entry.kind === 'preferred_window')?.status).toBe('not_evaluated');
  });

  it.each(['candidate-source', 'item-source', 'graph-revision'] as const)('withholds success when %s cannot establish current accepted work', change => {
    const state = fixture();
    if (change === 'graph-revision') state.graph.revision += 1;
    else if (change === 'item-source') state.schedulerInput.movableWorkItems.forEach(item => { item.sourceFactRefs = []; });
    else state.candidates.forEach(candidate => {
      (candidate as typeof candidate & { stableV5Metadata: WeeklyPlanningStableV5PreviewProvenance }).stableV5Metadata.sourceFactRefs = [];
    });
    expect(project(state).find(entry => entry.kind === 'preferred_window')?.status).toBe('not_evaluated');
  });

  it.each(['duplicate', 'duration', 'clock'] as const)('does not label incomplete or inconsistent %s coverage satisfied', change => {
    const state = fixture();
    const candidate = state.candidates.find(entry => entry.title.includes('research'))!;
    if (change === 'duplicate') state.candidates.push(structuredClone(candidate));
    else if (change === 'duration') candidate.durationMinutes -= 1;
    else candidate.endTime = candidate.startTime;
    expect(project(state).find(entry => entry.kind === 'preferred_window')?.status).toBe('not_satisfied');
  });

  it.each([false, true])('checks actual nonoverlapping coverage when an item is split further (overlap=%s)', overlap => {
    const state = fixture();
    const candidate = state.candidates.find(entry => entry.title.includes('research'))!;
    const before = structuredClone(candidate);
    candidate.startTime = '18:00'; candidate.endTime = '18:30'; candidate.durationMinutes = 30;
    state.candidates.push({ ...structuredClone(before), stableKey: `${before.stableKey}:split`,
      startTime: overlap ? '18:00' : '18:30', endTime: overlap ? '18:30' : '19:00', durationMinutes: 30 });
    expect(project(state).find(entry => entry.kind === 'preferred_window')?.status).toBe(overlap ? 'not_satisfied' : 'satisfied');
  });

  it('keeps a component preference independent of its sibling candidates', () => {
    const state = fixture();
    state.graph.components = ['first', 'second'].map(id => ({ id, taskId: 'research', parentComponentId: null,
      role: 'material', label: id, ...meta }));
    state.graph.temporalConstraints[0].targetFactId = 'first';
    const items = state.schedulerInput.movableWorkItems.filter(item => item.taskId === 'research');
    items[0].componentId = 'first'; items[1].componentId = 'second';
    for (const item of items) {
      item.sourceFactRefs.push(item.componentId!);
      const candidate = state.candidates.find(candidate => candidate.workItemKey === item.id)!;
      (candidate as typeof candidate & { stableV5Metadata: WeeklyPlanningStableV5PreviewProvenance }).stableV5Metadata.sourceFactRefs.push(item.componentId!);
    }
    state.schedulerInput.preferredPlacements[0].targetFactId = 'first';
    const sibling = state.candidates.find(candidate => candidate.workItemKey === items[1].id)!;
    sibling.startTime = '09:00'; sibling.endTime = '10:00';
    expect(project(state).find(entry => entry.kind === 'preferred_window')?.status).toBe('satisfied');
    const target = state.candidates.find(candidate => candidate.workItemKey === items[0].id)!;
    target.startTime = '09:00'; target.endTime = '10:00';
    sibling.startTime = '18:00'; sibling.endTime = '19:00';
    expect(project(state).find(entry => entry.kind === 'preferred_window')?.status).toBe('not_satisfied');
  });

  it.each(['preferred', 'available'] as const)('evaluates supplied compiled plan-wide %s windows without inventing compilation', kind => {
    const state = fixture();
    state.graph.temporalConstraints = [];
    state.graph.availabilityDeclarations = [{ id: 'plan-window', kind, constraintLevel: 'soft', dateExpression: null,
      namedTimePeriod: null, startTime: '18:00', endTime: '22:00', recurrenceKind: null, days: [], resolutionStatus: 'unresolved', ...meta }];
    state.schedulerInput.preferredPlacements = [];
    expect(project(state).filter(entry => entry.kind === 'preferred_window').map(entry => entry.status)).toEqual(['not_evaluated', 'not_evaluated']);
    state.schedulerInput.preferredPlacements = state.graph.tasks.map(task => ({ taskId: task.id, targetFactId: task.id,
      sourceFactId: 'plan-window', dates: ['2026-10-12', '2026-10-13'], window: { startMinute: 1080, endMinute: 1320 } }));
    expect(project(state).filter(entry => entry.kind === 'preferred_window')).toMatchObject([
      { sourceFactId: 'plan-window', taskId: 'research', status: 'satisfied' },
      { sourceFactId: 'plan-window', taskId: 'book', status: 'not_satisfied' },
    ]);
  });

  it('uses the active graph and does not report removed preferred facts', () => {
    const state = fixture();
    state.graph.factLifecycles = state.graph.temporalConstraints.map(fact => ({ factId: fact.id, status: 'removed',
      createdRevision: 1, terminalRevision: 1, supersededByFactId: null }));
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph);
    expect(project({ ...state, graph: active }).filter(entry => entry.kind === 'preferred_window')).toEqual([]);
  });
});
