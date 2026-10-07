import { describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

const source = {
  conversationId: 'session-preferences', turnId: 'turn-1', semanticLocalId: 'local',
  sourceText: '1回1時間', origin: 'user' as const,
};
const meta = { source, createdRevision: 1 };

function graph(params: { minutes?: number; total?: number; unitCode?: 'minute' | 'session' } = {}): WeeklyPlanningFactGraphV5 {
  const state = createEmptyWeeklyPlanningFactGraphV5();
  return {
    ...state, revision: 1,
    tasks: [{ id: 'research', title: '研究', category: 'study', ...meta }, { id: 'other', title: '他の作業', category: 'study', ...meta }],
    studyContexts: [{ id: 'context', taskId: 'research', purpose: 'research', contextLabel: null, ...meta }],
    workloads: ['research', 'other'].map((taskId) => ({
      id: `${taskId}-amount`, taskId, componentId: null, quantityRole: 'target', amount: params.total ?? 120,
      unitCode: params.unitCode ?? 'minute', unitLabel: params.unitCode === 'session' ? '回' : '分', rangeStart: null,
      rangeEnd: null, perOccurrence: false, periodExpression: null, ...meta,
    })),
    effortEstimates: [{
      id: 'session-size', taskId: 'research', targetFactId: 'research', kind: 'session_duration',
      minutes: params.minutes ?? 60, unitCode: 'session', precision: 'approximate', ...meta,
    }],
  };
}

function compile(state: WeeklyPlanningFactGraphV5) {
  return compileGenericSchedulerInput({
    graph: state, context: {
      ownerId: 'owner', currentDate: '2026-10-07', planningStartDate: '2026-10-12', planningEndDate: '2026-10-18',
      timeZone: 'Asia/Tokyo',
    },
  });
}

describe('accepted session-duration compilation', () => {
  it.each([15, 30, 60])('splits explicit %d-minute sessions independently of deep-work defaults or unrelated tasks', (minutes) => {
    const result = compile(graph({ minutes }));
    expect(result.status).toBe('ready');
    const items = result.input!.movableWorkItems;
    const research = items.filter((item) => item.taskId === 'research');
    expect(research.map((item) => item.estimatedMinutes)).toEqual(Array(120 / minutes).fill(minutes));
    expect(research.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(120);
    expect(research.every((item) => item.sourceFactRefs.includes('session-size'))).toBe(true);
    expect(items.filter((item) => item.taskId === 'other').map((item) => item.estimatedMinutes)).toEqual([120]);
  });

  it('preserves a small remainder rather than dropping requested work', () => {
    const items = compile(graph({ total: 125 })).input!.movableWorkItems.filter((item) => item.taskId === 'research');
    // The existing intrinsic-duration allocation rounds 125 to 135 minutes. Session
    // preference must conserve that allocation as well as the requested 125-minute quantity.
    expect(items.map((item) => item.estimatedMinutes)).toEqual([60, 60, 15]);
    expect(items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(125);
  });

  it('carries the preference provenance even when no split is needed', () => {
    const item = compile(graph({ total: 30 })).input!.movableWorkItems.find((item) => item.taskId === 'research')!;
    expect(item.estimatedMinutes).toBe(30);
    expect(item.sourceFactRefs).toContain('session-size');
  });

  it('does not silently choose between conflicting preferences', () => {
    const state = graph();
    state.effortEstimates.push({ ...state.effortEstimates[0], id: 'conflict', minutes: 30 });
    expect(compile(state)).toMatchObject({
      status: 'needs_resolution', input: null,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'ambiguous_effort_estimate', blocking: true })]),
    });
  });

  it('lets a workload preference override an inherited task preference', () => {
    const state = graph({ minutes: 90 });
    state.effortEstimates.push({ ...state.effortEstimates[0], id: 'specific', targetFactId: 'research-amount', minutes: 60 });
    const items = compile(state).input!.movableWorkItems.filter((item) => item.taskId === 'research');
    expect(items.map((item) => item.estimatedMinutes)).toEqual([60, 60]);
    expect(items.every((item) => item.sourceFactRefs.includes('specific') && !item.sourceFactRefs.includes('session-size'))).toBe(true);
  });

  it('does not allocate an unbounded session array or silently drop the task', () => {
    expect(compile(graph({ total: 100_000, minutes: 1 }))).toMatchObject({
      status: 'needs_resolution', input: null,
      issues: expect.arrayContaining([expect.objectContaining({ code: 'semantic_uncertainty', blocking: true })]),
    });
  });

  it('supports the existing counted-session workload representation', () => {
    const state = graph({ unitCode: 'session', total: 2 });
    state.workloads = state.workloads.filter((item) => item.taskId === 'research');
    state.tasks = state.tasks.filter((task) => task.id === 'research');
    const result = compile(state);
    expect(result.status).toBe('ready');
    expect(result.input!.movableWorkItems.map((item) => [item.quantity.amount, item.estimatedMinutes])).toEqual([[1, 60], [1, 60]]);
  });
});
