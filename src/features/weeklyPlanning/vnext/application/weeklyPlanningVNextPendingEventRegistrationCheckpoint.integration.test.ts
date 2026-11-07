import { describe, expect, it } from 'vitest';
import { applyWeeklyPlanningVNextTurn, createEmptyWeeklyPlanningVNextState } from '../semantic/weeklyPlanningVNextTransaction';
import { projectWeeklyPlanningVNext } from '../projection/weeklyPlanningVNextProjection';
import {
  parseWeeklyPlanningVNextSessionCheckpoint,
  serializeWeeklyPlanningVNextSessionCheckpoint,
  type WeeklyPlanningVNextSessionCheckpoint,
} from './weeklyPlanningVNextSessionCheckpoint';

const scope = { ownerId: 'event-expand-owner', weekStartDate: '2026-11-02' };
const conversationId = 'event-expand-conversation';

function checkpoint() {
  const result = applyWeeklyPlanningVNextTurn(createEmptyWeeklyPlanningVNextState(), {
    add: [
      { kind: 'task', localId: 'event', category: 'non_study', title: 'Conference' },
      { kind: 'component', localId: 'talk', taskRef: { localId: 'event' }, parentComponentRef: null, role: 'custom', label: 'Talk' },
      { kind: 'workload', localId: 'work', taskRef: { localId: 'event' }, componentRef: null,
        quantityRole: 'remaining', amount: 60, unitCode: 'minute', unitLabel: '分', rangeStart: null,
        rangeEnd: null, perOccurrence: false, periodExpression: null },
    ], patch: [], remove: [], relate: [], defer: [],
  }, { conversationId, turnId: 'turn-1', turnKey: 'turn-1', sourceText: 'Conference and talk',
    expectedRevision: 0, acceptedDate: '2026-11-02', weekStartsOn: 'monday',
    planningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' },
    defaultPlanningHorizon: { startDate: '2026-11-02', endDate: '2026-11-08' } });
  if (result.status !== 'applied') throw new Error(`Fixture rejected: ${JSON.stringify(result)}`);
  return { ...scope, conversationId, savedAt: '2026-11-02T09:00:00.000Z',
    vnext: { state: result.state, presentedQuestion: null, preview: null, messages: [] } };
}

const optionalFields = {
  failureRecovery: { reason: 'provider_error', consecutiveCount: 1 },
  unansweredQuestionStreak: { questionKey: 'missing_schedulable_work:event', graphRevision: 1, count: 1 },
  actualRecords: [{ id: 'actual-1', occurrenceDate: '2026-11-01', subject: '数学', minutes: 60, status: 'pending' }],
  pendingStudyRecordQuestion: { reason: 'missing_minutes', label: '数学' },
} satisfies Partial<WeeklyPlanningVNextSessionCheckpoint['vnext']>;

describe('pending fixed-event registration checkpoint compatibility', () => {
  it.each([
    {},
    { failureRecovery: optionalFields.failureRecovery },
    { unansweredQuestionStreak: optionalFields.unansweredQuestionStreak },
    { actualRecords: optionalFields.actualRecords },
    { pendingStudyRecordQuestion: optionalFields.pendingStudyRecordQuestion },
    optionalFields,
  ])('preserves old four-plus-optional keys and round-trips validated future targets with %j', fields => {
    const base = checkpoint();
    const raw = serializeWeeklyPlanningVNextSessionCheckpoint({ ...base, vnext: { ...base.vnext, ...fields } });
    expect(raw).not.toBeNull();
    const legacy = parseWeeklyPlanningVNextSessionCheckpoint({ raw: raw!, ...scope });
    expect(legacy).not.toBeNull();
    expect(legacy!.vnext.state).not.toHaveProperty('pendingEventRegistrationTargetIds');
    const expectedTargets = [base.vnext.state.graph.tasks[0].id, base.vnext.state.graph.components[0].id];
    const future = JSON.parse(raw!);
    future.vnext.state.pendingEventRegistrationTargetIds = expectedTargets;
    const parsed = parseWeeklyPlanningVNextSessionCheckpoint({ raw: JSON.stringify(future), ...scope });
    expect(parsed?.vnext.state.pendingEventRegistrationTargetIds).toEqual(expectedTargets);
    expect(parsed?.vnext).toMatchObject(fields);
    // After reader expansion, the consumer asks the task's clocks without granting plan permission.
    expect(projectWeeklyPlanningVNext(parsed!.vnext.state).questions[0]).toMatchObject({
      code: 'invalid_commitment_interval', taskId: expectedTargets[0] });
    expect(parsed!.vnext.state.draftGenerationIntent).toBe('not_requested');
    expect(parsed!.vnext.preview).toBeNull();
    const restoredRaw = serializeWeeklyPlanningVNextSessionCheckpoint(parsed!);
    expect(restoredRaw).not.toBeNull();
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: restoredRaw!, ...scope })).toEqual(parsed);
  });

  it('keeps ordinary producers unchanged and accepts an explicit empty future list', () => {
    expect(createEmptyWeeklyPlanningVNextState()).not.toHaveProperty('pendingEventRegistrationTargetIds');
    const base = checkpoint();
    expect(base.vnext.state).not.toHaveProperty('pendingEventRegistrationTargetIds');
    const raw = JSON.parse(serializeWeeklyPlanningVNextSessionCheckpoint(base)!);
    raw.vnext.state.pendingEventRegistrationTargetIds = [];
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: JSON.stringify(raw), ...scope })?.vnext.state.pendingEventRegistrationTargetIds).toEqual([]);
  });

  it.each([
    ['null', () => null],
    ['non-array', () => ({})],
    ['unbound/local reference', () => ['event']],
    ['unknown reference', () => ['foreign-task']],
    ['wrong fact kind', (base: ReturnType<typeof checkpoint>) => [base.vnext.state.graph.workloads[0].id]],
    ['duplicate target', (base: ReturnType<typeof checkpoint>) => Array(2).fill(base.vnext.state.graph.tasks[0].id)],
    ['non-string target', () => [1]],
  ] as const)('rejects the whole checkpoint for %s', (_name, invalid) => {
    const base = checkpoint();
    const raw = JSON.parse(serializeWeeklyPlanningVNextSessionCheckpoint(base)!);
    raw.vnext.state.pendingEventRegistrationTargetIds = invalid(base);
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: JSON.stringify(raw), ...scope })).toBeNull();
  });

  it('retains unknown-field and owner/week rejection with otherwise valid targets', () => {
    const base = checkpoint();
    const raw = JSON.parse(serializeWeeklyPlanningVNextSessionCheckpoint(base)!);
    raw.vnext.state.pendingEventRegistrationTargetIds = [base.vnext.state.graph.tasks[0].id];
    const valid = JSON.stringify(raw);
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: valid, ...scope, ownerId: 'foreign-owner' })).toBeNull();
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: valid, ...scope, weekStartDate: '2026-11-09' })).toBeNull();
    raw.vnext.state.futureField = true;
    expect(parseWeeklyPlanningVNextSessionCheckpoint({ raw: JSON.stringify(raw), ...scope })).toBeNull();
  });
});
