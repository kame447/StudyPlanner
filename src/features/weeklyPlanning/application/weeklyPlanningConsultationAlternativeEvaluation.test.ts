import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../types/domain';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { evaluateWeeklyPlanningConsultationAlternative } from './weeklyPlanningConsultationAlternativeEvaluation';
import { createWeeklyPlanningTurnRequestContext } from './weeklyPlanningTemporalContext';

const source = { conversationId: 'conversation', turnId: 'first', semanticLocalId: 'task', sourceText: '研究メモ', origin: 'user' as const };
const dates = ['2026-10-17', '2026-10-18'];
function setup() {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.tasks = ['task-a', 'task-b'].map(id => ({ id, category: 'study', title: id, source, createdRevision: 1 }));
  graph.factLifecycles = graph.tasks.map(task => ({ factId: task.id, status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
  const input: GenericSchedulerInput = {
    version: 'weekly-planning-generic-scheduler-input-v2', graphRevision: 1, ownerId: 'owner',
    horizon: { startDate: '2026-10-12', endDate: '2026-10-18', timeZone: 'Asia/Tokyo', planningWindowFactIds: [] },
    movableWorkItems: graph.tasks.map(task => ({
      version: 'weekly-planning-generic-work-item-v1', id: `work-${task.id}`, taskId: task.id, componentId: null, workloadFactId: `amount-${task.id}`,
      label: task.title, quantityRole: 'target', actionability: 'actionable',
      quantity: { amount: 180, unitCode: 'minute', unitLabel: '分', ordinalRange: null, actualRange: null },
      estimatedMinutes: 180, estimateBasis: 'intrinsic_duration', estimateSourceFactIds: [], estimateSourceWorkloadFactIds: [],
      splitPolicy: 'splittable', periodExpression: null, sourceFactRefs: [task.id],
    })),
    fixedTaskReservations: [], taskDateEligibilities: [], availabilityWindows: [], dailyCapacityLimits: [],
    sourceSelections: [], relations: [], hardDateBounds: [], preferredPlacements: [], sourceFactRefs: [],
  };
  const params: Parameters<typeof evaluateWeeklyPlanningConsultationAlternative>[0] = {
    acts: [{ kind: 'consultation_request', targetPublicId: 'task-a', placementAlternative: {
      scope: 'task', dateExpressions: ['weekday:saturday', 'weekday:sunday'], sourceText: '土日にまとめても大丈夫？',
    } }],
    compilation: { status: 'ready', input, issues: [] },
    graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(graph)),
    input: { userText: '土日にまとめても大丈夫？', plans: [], scheduleTemplates: [] },
    requestContext: createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-10-07T09:00:00.000Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' }),
  };
  const proposal = params.acts![0].placementAlternative!;
  if ('unavailable' in proposal) throw new Error('Expected a valid test hypothesis');
  return { params, input, proposal };
}
const feasibility = (params: Parameters<typeof evaluateWeeklyPlanningConsultationAlternative>[0]) => evaluateWeeklyPlanningConsultationAlternative(params)?.feasibility;

describe('read-only hypothetical placement through the canonical scheduler', () => {
  it('unions alternative weekdays, keeps unrelated tasks eligible, and mutates no source data', () => {
    const { params, input } = setup();
    input.taskDateEligibilities = [{ taskId: 'task-b', allowedDates: ['2026-10-12'], excludedDates: [], sourceFactIds: ['b-monday'] }];
    const before = structuredClone(params);
    expect(evaluateWeeklyPlanningConsultationAlternative(params)).toMatchObject({
      feasibility: { status: 'fits', basis: 'alternative_scheduler' }, alternative: { taskIds: ['task-a'], dates },
    });
    expect(params).toEqual(before);
  });
  it('applies explicit plan scope to every task without widening accepted allowed days', () => {
    const { params, input, proposal } = setup();
    proposal.scope = 'plan';
    input.taskDateEligibilities = [{ taskId: 'task-b', allowedDates: ['2026-10-12'], excludedDates: [], sourceFactIds: ['b-monday'] }];
    expect(feasibility(params)?.status).toBe('does_not_fit');
  });
  it.each(['capacity', 'excluded_dates', 'deadline', 'required_occurrence', 'plans'] as const)('keeps accepted %s restrictions', restriction => {
    const { params, input } = setup();
    if (restriction === 'capacity') input.dailyCapacityLimits = dates.map(date => ({ date, maxMinutes: 30, sourceFactIds: ['cap'] }));
    if (restriction === 'excluded_dates') input.taskDateEligibilities = [{ taskId: 'task-a', allowedDates: null, excludedDates: dates, sourceFactIds: ['exclude'] }];
    if (restriction === 'deadline') input.hardDateBounds = [{ taskId: 'task-a', targetFactId: 'task-a', startDate: null, endDate: '2026-10-16', sourceFactIds: ['deadline'] }];
    if (restriction === 'required_occurrence') input.movableWorkItems[0].requiredDate = '2026-10-12';
    if (restriction === 'plans') params.input.plans = dates.map(date => ({
      id: `busy-${date}`, seriesId: `busy-${date}`, userId: 'owner', title: 'Busy', subject: '', date,
      startTime: '00:00', endTime: '24:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
      type: 'other', memo: '', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
    } satisfies Plan));
    const before = structuredClone(params);
    expect(feasibility(params)).toEqual({ status: 'does_not_fit', basis: 'alternative_scheduler' });
    expect(params).toEqual(before);
  });
  it('does not use other tasks as proof when all of the queried recurring work is already past', () => {
    const { params, input } = setup();
    input.movableWorkItems[0].requiredDate = '2026-10-12';
    params.requestContext.notBeforeDate = '2026-10-15';
    params.graph = { ...params.graph, workloads: [{
      id: 'amount-task-a', taskId: 'task-a', componentId: null, quantityRole: 'target', amount: 180,
      unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: true,
      periodExpression: 'daily', source, createdRevision: 1,
    }] };
    expect(feasibility(params)).toEqual({ status: 'not_evaluated', reason: 'no_schedulable_work' });
  });
  it('does not imply that fixed work was moved or tested as movable work', () => {
    const { params, input } = setup();
    input.movableWorkItems = [];
    input.fixedTaskReservations = [{ id: 'fixed', taskId: 'task-a', temporalConstraintFactId: 'fixed-time',
      start: { date: '2026-10-12', time: '09:00' }, end: { date: '2026-10-12', time: '10:00' }, timeZone: 'Asia/Tokyo',
      constraintLevel: 'hard', sourceKind: 'user_commitment', sourceRef: 'fixed-time', graphRevision: 1 }];
    expect(feasibility(params)).toEqual({ status: 'not_evaluated', reason: 'fixed_work_not_movable' });
  });
  it('does not infer dates from Japanese or invent an alternative absent typed evidence', () => {
    const { params } = setup();
    params.acts = [{ kind: 'consultation_request', targetPublicId: 'task-a' }];
    expect(evaluateWeeklyPlanningConsultationAlternative(params)).toBeNull();
  });
  it.each(['unknown_task', 'component', 'missing_details', 'unquoted', 'outside', 'partial_range', 'ambiguous'] as const)('withholds a feasibility claim for %s', reason => {
    const { params, proposal } = setup();
    if (reason === 'unknown_task' || reason === 'component') params.acts![0].targetPublicId = reason;
    if (reason === 'missing_details') params.compilation = { status: 'needs_resolution', input: null, issues: [] };
    if (reason === 'unquoted') proposal.sourceText = '以前の発言';
    if (reason === 'outside') proposal.dateExpressions = ['2026-10-24'];
    if (reason === 'partial_range') proposal.dateExpressions = ['2026-10-17/2026-10-24'];
    if (reason === 'ambiguous') params.acts = [...params.acts!, ...params.acts!];
    expect(feasibility(params)?.status).toBe('not_evaluated');
  });
});
