import { describe, expect, it } from 'vitest';
import type { Plan } from '../../../../types/domain';
import type { VNextAddConstraintSource, VNextTurnDelta, WeeklyPlanningVNextState } from '../weeklyPlanningVNextTypes';
import { createStableV5ExternalConstraintSources, type ExternalConstraintSourceSnapshot } from '../weeklyPlanningVNextV5Boundary';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { compileGenericSchedulerInput } from '../../semantic/weeklyPlanningGenericSchedulerInput';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import { compileWeeklyPlanningVNextSchedulerInput } from '../projection/weeklyPlanningVNextSchedulerGraph';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from './weeklyPlanningVNextTransaction';
import { decodeVNextProviderOutput, describeVNextProviderField, VNEXT_CONSTRAINT_SOURCE_REQUIREMENT } from './weeklyPlanningVNextProviderSchema';
import { buildWeeklyPlanningVNextProviderMessages } from './weeklyPlanningVNextProviderPrompt';
import { parseVNextCorrections } from './weeklyPlanningVNextCorrectionSchema';
import { readWeeklyPlanningVNextExperimentalSession, submitWeeklyPlanningVNextExperimentalTurn,
  type WeeklyPlanningVNextExperimentalPorts } from '../application/weeklyPlanningVNextExperimentalSession';

const context = { ownerId: 'owner', currentDate: '2026-11-02', planningStartDate: '2026-11-02', planningEndDate: '2026-11-02', timeZone: 'Asia/Tokyo' };
const horizon = { startDate: context.planningStartDate, endDate: context.planningEndDate };
const clock = { ...context, weekStartsOn: 'monday' as const, defaultPlanningHorizon: horizon };
const empty = (): VNextTurnDelta => ({ add: [], patch: [], remove: [], relate: [], defer: [] });
const request = (sourceKind: VNextAddConstraintSource['sourceKind'], requestedAction: VNextAddConstraintSource['requestedAction'] = 'use'): VNextAddConstraintSource =>
  ({ kind: 'constraint_source_request', localId: 'source', sourceKind, selector: 'active', requestedAction });
const work: VNextTurnDelta['add'] = [{ kind: 'task', localId: 't', category: 'study', title: 'Reading' },
  { kind: 'workload', localId: 'w', taskRef: { localId: 't' }, componentRef: null, quantityRole: 'remaining', amount: 30,
    unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null }];
function apply(state: WeeklyPlanningVNextState, delta: VNextTurnDelta) {
  return applyWeeklyPlanningVNextTurn(state, delta, { expectedRevision: state.graph.revision, acceptedDate: context.currentDate,
    planningHorizon: horizon, defaultPlanningHorizon: horizon, weekStartsOn: 'monday', conversationId: 'c', turnId: `t${state.graph.revision}`,
    turnKey: `t${state.graph.revision}`, sourceText: 'synthetic typed evidence' });
}
function seed(source: VNextAddConstraintSource) {
  const result = apply(createEmptyWeeklyPlanningVNextState(), { ...empty(), add: [...work, source] });
  if (result.status !== 'applied') throw new Error(JSON.stringify(result));
  return result.state;
}
const compile = (state: WeeklyPlanningVNextState, externalSources: ExternalConstraintSourceSnapshot[]) => {
  const result = compileWeeklyPlanningVNextSchedulerInput({ state, projection: projectWeeklyPlanningVNext(state), context, externalSources });
  if (result.status !== 'compiled') throw new Error('not compiled');
  return result.compilation;
};
const success: ExternalConstraintSourceSnapshot = { kind: 'timetable', status: 'success', ownerId: 'owner', activeSourceId: 'active-term', attemptCount: 1,
  events: [{ eventId: 'class', ownerId: 'owner', start: { date: context.currentDate, time: '09:00' }, end: { date: context.currentDate, time: '10:30' },
    timeZone: context.timeZone, constraintLevel: 'hard' }] };

describe('VNext constraint sources reuse V5 selection and safety', () => {
  it.each(['timetable', 'existing_plans', 'calendar'] as const)('adds, patches, removes and exposes %s through the same provider contract', (kind) => {
    const fact = request(kind);
    expect(decodeVNextProviderOutput({ delta: { ...empty(), add: [fact] }, answer: null }).status).toBe('decoded');
    expect(describeVNextProviderField('add[0].requestedAction', { delta: { ...empty(), add: [fact] }, answer: null })).toContain(VNEXT_CONSTRAINT_SOURCE_REQUIREMENT);
    const state = seed(fact);
    const patch = { kind: 'constraint_source_request' as const, localId: 'stop', targetFactId: state.graph.constraintSourceRequests[0].id,
      changes: { sourceKind: null, selector: null, requestedAction: 'stop_using' as const } };
    expect(parseVNextCorrections({ patch: [patch], remove: [] }).status).toBe('accepted');
    const patched = apply(state, { ...empty(), patch: [patch] });
    if (patched.status !== 'applied') throw new Error(JSON.stringify(patched));
    expect(patched.state.graph.constraintSourceRequests[1]).toMatchObject({ kind, requestedAction: 'stop_using', resolutionStatus: 'unresolved' });
    const removed = apply(patched.state, { ...empty(), remove: [{ targetFactId: patched.state.graph.constraintSourceRequests[1].id }] });
    expect(removed.status).toBe('applied');
    expect(buildWeeklyPlanningVNextProviderMessages({ state, projection: projectWeeklyPlanningVNext(state), clock,
      presentedQuestion: null, presentedText: null, userText: 'synthetic', client: {} as never })[0].content).toContain(VNEXT_CONSTRAINT_SOURCE_REQUIREMENT);
  });

  it('uses the shared V5 field validator and leaves the state unchanged on a bad source', () => {
    const state = seed(request('timetable'));
    const before = structuredClone(state);
    const result = apply(state, { ...empty(), add: [{ ...request('calendar'), sourceKind: 'unknown' } as unknown as VNextAddConstraintSource] });
    expect(result).toMatchObject({ status: 'rejected', errors: [expect.objectContaining({ code: 'invalid_value', path: 'add[0].sourceKind' })] });
    expect(state).toEqual(before);
  });

  // V5 AvailabilityResolver: successful owner-bound timetable, valid empty schedule,
  // failed fetch, owner mismatch, and stop_using. The same compiler must preserve each result.
  it.each(['use', 'stop_using'] as const)('matches V5 source selection for %s', (action) => {
    const state = seed(request('timetable', action));
    for (const source of [success, { ...success, events: [] }, { ...success, ownerId: 'other' },
      { kind: 'timetable', status: 'failure', ownerId: 'owner', activeSourceId: null, failureKind: 'timeout', attemptCount: 3 }] as ExternalConstraintSourceSnapshot[]) {
      const v5 = compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(state.graph), context, externalSources: [source] });
      const next = compile(state, [source]);
      expect(next.status).toBe(v5.status);
      expect(next.input?.sourceSelections).toEqual(v5.input?.sourceSelections);
      expect(next.input?.availabilityWindows).toEqual(v5.input?.availabilityWindows);
      expect(next.issues).toEqual(v5.issues);
    }
    const selected = compile(state, [success]);
    expect(selected.input!.sourceSelections[0].status).toBe(action === 'use' ? 'selected' : 'deselected');
    expect(selected.input!.availabilityWindows).toHaveLength(action === 'use' ? 1 : 0);
  });

  it('connects session calendar sources, persists requests, blocks unavailable calendars, and retains raw busy-time safety after stop_using', async () => {
    const plan: Plan = { id: 'p', seriesId: 'p', userId: 'owner', title: 'Existing', subject: '', date: context.currentDate,
      startTime: '09:00', endTime: '10:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other', memo: '',
      createdAt: '2026-11-02T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z' };
    const calendar = { plans: [plan], actuals: [], monthEvents: [], scheduleTemplates: [] };
    const sources = createStableV5ExternalConstraintSources({ ownerId: 'owner', plans: calendar.plans, templates: [], horizon, timeZone: context.timeZone });
    expect(compile(seed(request('existing_plans')), sources).input!.availabilityWindows).toHaveLength(1);
    expect(compile(seed(request('calendar')), sources).issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'constraint_source_unavailable' })]));
    let checkpoint: string | null = null;
    let next: VNextTurnDelta = { ...empty(), add: [...work, request('calendar')] };
    const ports: WeeklyPlanningVNextExperimentalPorts = { client: {} as never,
      interpret: async () => ({ status: 'interpreted', delta: next, answer: null, metrics: { calls: 0, repairs: 0, latencyMs: 0 } }),
      checkpoint: { read: () => checkpoint, write: raw => { checkpoint = raw; } }, legacyV5Checkpoint: { read: () => null },
      approvalLedger: { read: () => null, write: () => {} },
      plans: { findExistingPlanId: async () => undefined, saveBlock: async () => { throw new Error('No save allowed in this test'); } },
      calendar: () => calendar, createRenderer: () => ({ render: async () => ({ status: 'rendered', text: 'shown synthetic reply', rawResponse: '' }) }),
      now: () => '2026-11-02T09:00:00Z' };
    const scope = { ownerId: 'owner', conversationId: 'c', weekStartDate: context.currentDate, clock, notBeforeTime: '09:00' };
    const first = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'one', userText: 'synthetic', shownRevision: null });
    expect(first.preview).toBeNull();
    expect(first.previewBlockedBy).toContain('constraint_source_unavailable');
    const read = readWeeklyPlanningVNextExperimentalSession(scope, ports);
    if (read.status !== 'ready') throw new Error('checkpoint missing');
    const factId = read.checkpoint.state.graph.constraintSourceRequests[0].id;
    next = { ...empty(), patch: [{ kind: 'constraint_source_request', localId: 'stop', targetFactId: factId,
      changes: { sourceKind: null, selector: null, requestedAction: 'stop_using' } }] };
    const second = await submitWeeklyPlanningVNextExperimentalTurn({ scope, ports, turnId: 'two', userText: 'synthetic stop', shownRevision: first.graphRevision });
    expect(second.previewBlockedBy).toEqual([]);
    // V5 PreviewScheduler: "places application work after an existing plan without sending placement to AI".
    expect(second.preview!.blocks[0].startTime).toBe('10:20');
    expect(readWeeklyPlanningVNextExperimentalSession(scope, ports).status).toBe('ready');
    const foreign = JSON.parse(checkpoint!);
    foreign.vnext.state.graph.constraintSourceRequests[0].source.conversationId = 'another-conversation';
    checkpoint = JSON.stringify(foreign);
    expect(readWeeklyPlanningVNextExperimentalSession(scope, ports).status).toBe('unreadable');
  });
});
