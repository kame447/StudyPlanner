import { describe, expect, it } from 'vitest';
import { resolveWeeklyPlanningAcceptedPlanningWindow } from '../application/weeklyPlanningTemporalContext';
import { reconcileWeeklyPlanningGroundingRecordsV5 } from './weeklyPlanningGroundingV5';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { isWeeklyPlanningFactActiveV5 } from './weeklyPlanningFactLifecycleV5';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { saveWeeklyPlanningStableV5PersistedSession, loadWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { prepareWeeklyPlanningStableV5Checkpoint } from '../application/weeklyPlanningStableV5SessionCodec';
import { executeWeeklyPlanningStableV5SemanticTurnCore } from '../application/weeklyPlanningStableV5SemanticTurnCore';
import { createWeeklyPlanningTurnRequestContext } from '../application/weeklyPlanningTemporalContext';
import { createWeeklyPlanningSemanticPipelineV5 } from './weeklyPlanningSemanticPipelineV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import type { WeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';

function document(expression = 'tomorrow'): WeeklyPlanningSemanticDocumentV5 {
  const constraint = { localId: 'deadline', targetLocalId: 'task', kind: 'deadline' as const,
    constraintLevel: 'hard' as const, dateExpression: expression, namedTimePeriod: null,
    startTime: null, endTime: null, precision: 'exact' as const, sourceText: '日付の条件' };
  return { schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'relative_day', value: 'tomorrow', start: null, end: null, sourceText: '明日の予定' },
    tasks: [{ localId: 'task', category: 'study', title: '英語', study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 30, unitCode: 'minute', unitLabel: '分', rangeStart: null,
        rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '英語30分' }],
      effortEstimates: [], temporalConstraints: [constraint,
        { ...constraint, localId: 'fixed', kind: 'fixed_interval', startTime: '18:00', endTime: '19:00' },
        { ...constraint, localId: 'allowed', kind: 'allowed_date' }], recurrence: [], sourceText: '英語30分' }],
    relations: [], availabilityDeclarations: [{ localId: 'unavailable', kind: 'unavailable', dateExpression: expression,
      namedTimePeriod: null, startTime: '10:00', endTime: '11:00', recurrenceKind: null, days: [],
      constraintLevel: 'hard', sourceText: '日付の条件' }], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] };
}

function accepted(document: WeeklyPlanningSemanticDocumentV5): WeeklyPlanningSemanticNormalizerV5 {
  return { normalize: async () => ({ status: 'accepted', document: structuredClone(document), diagnostics: {
    schemaVersion: 'weekly-planning-semantic-v5', jsonSchemaName: 'weekly_planning_semantic_document_v5',
    normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false,
    requestBytes: [], responseLengths: [], latencyMs: 0, validationErrors: [], providerError: null,
  } }) };
}

function request(startedAtIso = '2026-10-29T09:00:00.000Z', timeZone = 'Asia/Tokyo', weekStartsOn: 'monday' | 'sunday' = 'monday') {
  return createWeeklyPlanningTurnRequestContext({ startedAtIso, timeZone, weekStartsOn });
}

async function accept(input: WeeklyPlanningSemanticDocumentV5, clock = request(), graph?: WeeklyPlanningFactGraphV5, turnId = 'turn-1') {
  const result = await createWeeklyPlanningSemanticPipelineV5(accepted(input), () => {}).run({
    graph, conversationId: 'relative-date-acceptance', turnId, expectedRevision: graph?.revision ?? 0,
    userText: '明日の予定。英語30分。日付の条件', schedulerContext: { ownerId: 'test-owner',
      currentDate: clock.currentDate, weekStartsOn: clock.weekStartsOn, planningStartDate: '2026-10-29',
      planningEndDate: '2026-11-15', timeZone: clock.timeZone, namedTimePeriods: {} },
  });
  expect(result.canonicalization?.status).toBe('applied');
  return result.graph;
}

function dateExpressions(graph: WeeklyPlanningFactGraphV5) {
  return [...graph.temporalConstraints, ...graph.taskDateRules, ...graph.availabilityDeclarations]
    .map(fact => fact.dateExpression);
}

describe('U5 acceptance clock for newly accepted dates', () => {
  it.each([
    ['today', '2026-10-29'], ['next_day', '2026-10-30'], ['day_after_tomorrow', '2026-10-31'],
  ])('anchors canonical %s without interpreting source language', async (expression, expected) => {
    const input = document(expression);
    input.planningWindow!.value = expression;
    const graph = await accept(input);
    expect(dateExpressions(graph)).toEqual(Array(4).fill(expected));
    expect(graph.planningWindows[0]).toMatchObject({ kind: 'absolute', start: expected, end: expected });
  });

  it('stores all newly accepted tomorrow facts and relative-day window as the acceptance date', async () => {
    const input = document();
    const original = structuredClone(input);
    const graph = await accept(input);
    expect(dateExpressions(graph)).toEqual(['2026-10-30', '2026-10-30', '2026-10-30', '2026-10-30']);
    expect(graph.planningWindows[0]).toMatchObject({ kind: 'absolute', value: '2026-10-30', start: '2026-10-30', end: '2026-10-30' });
    expect(input).toEqual(original);
    const later = resolveWeeklyPlanningDateExpressionsV5({ graph, currentDate: '2026-10-30' });
    expect(later.facts.map(fact => fact.range)).toEqual(Array(4).fill({ start: '2026-10-30', end: '2026-10-30' }));
  });
});


function noOp(): WeeklyPlanningSemanticDocumentV5 {
  return { ...document(), planningIntent: 'discuss', planningWindow: null, tasks: [], availabilityDeclarations: [] };
}

describe('U5 stable date acceptance across later turns', () => {
  it.each([
    ['2026-10-29T09:00:00.000Z', '2026-10-30T09:00:00.000Z', '2026-10-30'],
    ['2026-10-31T09:00:00.000Z', '2026-11-01T09:00:00.000Z', '2026-11-01'],
    ['2026-12-31T09:00:00.000Z', '2027-01-01T09:00:00.000Z', '2027-01-01'],
    ['2026-11-01T09:00:00.000Z', '2026-11-08T09:00:00.000Z', '2026-11-02'],
  ])('keeps acceptance %s unchanged at %s', async (capture, later, expected) => {
    const initial = await accept(document(), request(capture));
    const graph = await accept(noOp(), request(later), initial, 'turn-2');
    expect(dateExpressions(graph)).toEqual(Array(4).fill(expected));
    expect(graph.temporalConstraints).toEqual(initial.temporalConstraints);
    expect(graph.taskDateRules).toEqual(initial.taskDateRules);
    expect(graph.availabilityDeclarations).toEqual(initial.availabilityDeclarations);
    expect(resolveWeeklyPlanningAcceptedPlanningWindow({ graph, requestContext: request(later) }))
      .toEqual({ startDate: expected, endDate: expected });
  });

  it.each([
    ['Asia/Tokyo', '2026-10-30'], ['UTC', '2026-10-29'], ['America/Los_Angeles', '2026-10-29'],
  ])('uses the captured timezone %s at the same UTC instant', async (timeZone, expected) => {
    const clock = request('2026-10-28T15:30:00.000Z', timeZone);
    const graph = await accept(document(), clock);
    expect(dateExpressions(graph)).toEqual(Array(4).fill(expected));
    expect(graph.planningWindows[0].start).toBe(expected);
  });

  it('compiles the same fixed interval, date eligibility and unavailable dates before preview on either day', async () => {
    const graph = await accept(document());
    for (const currentDate of ['2026-10-29', '2026-10-30']) {
      const compiled = compileGenericSchedulerInput({ graph, context: { ownerId: 'test-owner', currentDate,
        planningStartDate: '2026-10-30', planningEndDate: '2026-10-30', timeZone: 'Asia/Tokyo' } });
      expect(compiled.status).toBe('ready');
      expect(compiled.input?.fixedTaskReservations.map(item => item.start.date)).toEqual(['2026-10-30']);
      expect(compiled.input?.availabilityWindows.map(item => item.start.date)).toEqual(['2026-10-30']);
      expect(compiled.input?.taskDateEligibilities[0].allowedDates).toEqual(['2026-10-30']);
    }
  });

  it('uses the runtime captured clock rather than the display date or wall clock after await', async () => {
    const clock = request('2026-10-31T14:59:59.000Z');
    const graph = createEmptyWeeklyPlanningFactGraphV5();
    const result = await executeWeeklyPlanningStableV5SemanticTurnCore({
      messages: [], userText: '明日の予定。英語30分。日付の条件', selectedDate: '2026-05-01', userId: 'test-owner',
      plans: [], scheduleTemplates: [], conversationId: 'relative-date-acceptance', traceRequestId: 'runtime-turn', requestContext: clock,
    }, { normalizer: accepted(document()), session: { ownerId: 'test-owner', weekStartDate: '2026-10-26',
      conversationId: 'relative-date-acceptance', graph, updatedAt: 0 }, selectContext: () => [], recordFailure: () => {} });
    expect(result.status).toBe('success');
    if (result.status !== 'success') throw new Error('Expected semantic acceptance');
    expect(dateExpressions(result.semantic.graph)).toEqual(Array(4).fill('2026-11-01'));
    expect(result.semantic.graph.planningWindows[0].start).toBe('2026-11-01');
  });

  it.each([
    ['this_week', 'monday', '2026-10-26', '2026-11-01'],
    ['next_week', 'monday', '2026-11-02', '2026-11-08'],
    ['this_week', 'sunday', '2026-10-25', '2026-10-31'],
    ['next_week', 'sunday', '2026-11-01', '2026-11-07'],
  ] as const)('matches %s relative-week grounding for %s weeks', async (expression, weekStartsOn, start, end) => {
    const clock = request('2026-10-29T09:00:00.000Z', 'Asia/Tokyo', weekStartsOn);
    const input = document(expression);
    input.planningWindow = { ...input.planningWindow!, kind: 'relative_week', value: expression };
    const graph = await accept(input, clock);
    expect(dateExpressions(graph)).toEqual(Array(4).fill(`${start}/${end}`));
    expect(graph.planningWindows[0]).toMatchObject({ kind: 'relative_week', value: expression, start: null, end: null });
    const horizon = resolveWeeklyPlanningAcceptedPlanningWindow({ graph, requestContext: clock });
    expect(horizon).toEqual({ startDate: start, endDate: end });
    const records = reconcileWeeklyPlanningGroundingRecordsV5({ previousRecords: [], previousGraph: createEmptyWeeklyPlanningFactGraphV5(),
      nextGraph: graph, resolvedHorizon: horizon, currentTurnId: 'turn-1', continuationAccepted: false });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ sourceExpression: expression, startDate: start, endDate: end });
    const future = request('2026-11-08T09:00:00.000Z', 'Asia/Tokyo', weekStartsOn);
    expect(resolveWeeklyPlanningAcceptedPlanningWindow({ graph, requestContext: future, groundingRecords: records })).toEqual(horizon);
    expect(resolveWeeklyPlanningDateExpressionsV5({ graph, currentDate: future.currentDate, weekStartsOn }).facts
      .map(fact => fact.range)).toEqual(Array(4).fill({ start, end }));
  });

  it('round-trips a checkpoint and resumes the next day with identical dates and clock intervals', async () => {
    const storage = createMemoryStorageHarness();
    const restore = installWeeklyPlanningTestStorage(storage.storage);
    try {
      const graph = await accept(document());
      const params = { ownerId: 'test-owner', weekStartDate: '2026-10-26', conversationId: 'relative-date-acceptance',
        graph, planningState: createInitialPlanningState('2026-10-26') };
      expect(prepareWeeklyPlanningStableV5Checkpoint(params).status).toBe('ready');
      expect(saveWeeklyPlanningStableV5PersistedSession(params)).toBe(true);
      const loaded = loadWeeklyPlanningStableV5PersistedSession({ ownerId: params.ownerId, weekStartDate: params.weekStartDate });
      expect(loaded?.graph).toEqual(graph);
      const resumed = await accept(noOp(), request('2026-10-30T09:00:00.000Z'), loaded!.graph, 'reload-turn');
      expect(dateExpressions(resumed)).toEqual(Array(4).fill('2026-10-30'));
      expect(resumed.temporalConstraints.find(fact => fact.kind === 'fixed_interval')).toMatchObject({ startTime: '18:00', endTime: '19:00' });
      expect(resumed.availabilityDeclarations[0]).toMatchObject({ startTime: '10:00', endTime: '11:00' });
    } finally { restore(); }
  });

  it('changes only the explicitly corrected deadline using the correction turn clock', async () => {
    const initial = await accept(document());
    const input = document();
    input.planningIntent = 'update_plan'; input.planningWindow = null; input.availabilityDeclarations = [];
    input.tasks[0].existingPublicId = initial.tasks[0].id;
    input.tasks[0].workloads = [];
    input.tasks[0].temporalConstraints = [{ ...input.tasks[0].temporalConstraints[0], localId: 'new-deadline' }];
    const before = initial.temporalConstraints.find(fact => fact.kind === 'deadline')!;
    input.corrections = [{ localId: 'correction', target: { kind: 'temporal_constraint', publicId: before.id, localId: null, mention: null },
      operation: 'replace', replacementLocalId: 'new-deadline', sourceText: '日付の条件' }];
    const graph = await accept(input, request('2026-10-30T09:00:00.000Z'), initial, 'correction-turn');
    const activeDeadlines = graph.temporalConstraints.filter(fact => fact.kind === 'deadline' && isWeeklyPlanningFactActiveV5(graph, fact.id));
    expect(activeDeadlines).toHaveLength(1);
    expect(activeDeadlines[0].dateExpression).toBe('2026-10-31');
    expect(isWeeklyPlanningFactActiveV5(graph, before.id)).toBe(false);
    expect(graph.temporalConstraints.find(fact => fact.kind === 'fixed_interval')).toEqual(initial.temporalConstraints.find(fact => fact.kind === 'fixed_interval'));
    expect(graph.taskDateRules).toEqual(initial.taskDateRules);
    expect(graph.availabilityDeclarations).toEqual(initial.availabilityDeclarations);
    expect(graph.planningWindows).toEqual(initial.planningWindows);
    expect(graph.workloads).toEqual(initial.workloads);
  });

  it('passes the same captured clock into the semantic-uncertainty answer canonicalization', async () => {
    const initial = createEmptyWeeklyPlanningFactGraphV5();
    initial.revision = 1;
    initial.uncertainties = [{ id: 'need-window', targetFactId: null, field: 'planning_window', reason: 'when', createdRevision: 1,
      source: { conversationId: 'relative-date-acceptance', turnId: 'prior', semanticLocalId: 'need-window', sourceText: '予定', origin: 'user' } }];
    initial.factLifecycles = [{ factId: 'need-window', status: 'active', createdRevision: 1, terminalRevision: null, supersededByFactId: null }];
    const input = document(); input.tasks = []; input.availabilityDeclarations = [];
    const result = await createWeeklyPlanningSemanticPipelineV5(accepted(input), () => {}).run({ graph: initial,
      conversationId: 'relative-date-acceptance', turnId: 'contextual', expectedRevision: 1, userText: '明日の予定',
      publicStateSummary: { pendingQuestion: { actionId: 'ask-window', questionCode: 'semantic_uncertainty', targetFactId: 'need-window', graphRevision: 1 } },
      schedulerContext: { ownerId: 'test-owner', currentDate: '2026-10-29', weekStartsOn: 'monday', planningStartDate: '2026-10-29',
        planningEndDate: '2026-11-05', timeZone: 'Asia/Tokyo', namedTimePeriods: {} },
    });
    expect(result.canonicalization?.status).toBe('applied');
    expect(isWeeklyPlanningFactActiveV5(result.graph, 'need-window')).toBe(false);
    expect(result.graph.planningWindows[0]).toMatchObject({ kind: 'absolute', start: '2026-10-30', end: '2026-10-30' });
  });

  it('does not re-anchor prior relative facts when accepting an unrelated turn', async () => {
    const prior = await accept(document());
    // Saved data with no acceptance calendar: deliberately keep its historical tokens (#910).
    prior.planningWindows[0] = { ...prior.planningWindows[0], kind: 'relative_day', value: 'tomorrow', start: null, end: null };
    for (const fact of [...prior.temporalConstraints, ...prior.taskDateRules, ...prior.availabilityDeclarations]) fact.dateExpression = 'tomorrow';
    const graph = await accept(noOp(), request('2026-10-30T09:00:00.000Z'), prior, 'legacy-resume');
    expect(dateExpressions(graph)).toEqual(Array(4).fill('tomorrow'));
    expect(graph.planningWindows[0]).toEqual(prior.planningWindows[0]);
  });

  it.each(['weekday:friday', 'custom:before summer camp', '2026-11-10', '2026-11-01/2026-11-07'])(
    'preserves %s instead of interpreting a weekday/custom rule or rewriting an absolute date', async expression => {
      const input = document(expression);
      input.availabilityDeclarations[0].recurrenceKind = 'weekly';
      input.availabilityDeclarations[0].days = ['weekday:friday'];
      const graph = await accept(input);
      expect(dateExpressions(graph)).toEqual(Array(4).fill(expression));
      expect(graph.availabilityDeclarations[0]).toMatchObject({ recurrenceKind: 'weekly', days: ['weekday:friday'] });
    });
});
