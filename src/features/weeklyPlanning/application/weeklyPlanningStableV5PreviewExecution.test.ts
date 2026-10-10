import { createLocalScheduleEventAuthority } from '../../../repositories/localScheduleEventAuthority';
import { createLocalPlannerStorageGateway } from '../../../repositories/localStorageGateway';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS, measureWeeklyPlanningTraceJsonBytes } from '../../../../shared/weeklyPlanningTraceContract';
import { prepareWeeklyPlanningTraceServerWrite } from '../../../../workers/ai-proxy/src/weeklyPlanningTracePrivacy';
import { recordWeeklyPlanningStableV5TurnTrace, resetWeeklyPlanningStableV5TraceRuntimeForTest, resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest } from '../trace/weeklyPlanningStableV5TraceRuntime';
import { listWeeklyPlanningTraceOutboxItems } from '../trace/weeklyPlanningTraceOutbox';
import { setWeeklyPlanningTraceRepositoryForTests } from '../trace/weeklyPlanningTraceRepository';
import type { WeeklyPlanningTraceRepository } from '../trace/weeklyPlanningTraceTypes';
import { describe, expect, it, vi } from 'vitest';
import type { MonthEvent, Plan } from '../../../types/domain';
import { buildPlacementBusyIntervals } from '../semantic/weeklyPlanningStableV5PlacementAvailability';
import {
  createWeeklyPlanningActiveSchedulerGraphViewV5,
} from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import {
  createEmptyWeeklyPlanningFactGraphV5,
  type WeeklyPlanningFactGraphV5,
} from '../semantic/weeklyPlanningFactGraphV5';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  createWeeklyPlanningPlacementGraphViewV5,
} from '../semantic/weeklyPlanningPlacementGraphViewV5';
import {
  takeWeeklyPlanningStableV5DebugTrace,
} from '../trace/weeklyPlanningStableV5DebugTrace';
import { executeWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewExecution';

function graph(): WeeklyPlanningFactGraphV5 {
  const source = {
    conversationId: 'trace-conversation',
    turnId: 'turn-1',
    semanticLocalId: 'task-1',
    sourceText: '数学を1時間',
    origin: 'user' as const,
  };
  return {
    ...createEmptyWeeklyPlanningFactGraphV5(),
    revision: 1,
    tasks: [{
      id: 'task-1',
      category: 'study',
      title: '数学',
      source,
      createdRevision: 1,
    }],
    workloads: [{
      id: 'workload-1',
      taskId: 'task-1',
      componentId: null,
      quantityRole: 'target',
      amount: 60,
      unitCode: 'minute',
      unitLabel: '分',
      rangeStart: null,
      rangeEnd: null,
      perOccurrence: false,
      periodExpression: null,
      source,
      createdRevision: 1,
    }],
    factLifecycles: [
      {
        factId: 'task-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
      {
        factId: 'workload-1',
        status: 'active',
        createdRevision: 1,
        terminalRevision: null,
        supersededByFactId: null,
      },
    ],
  };
}

function schedulerInput(): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 1,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-09-04',
      endDate: '2026-09-05',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [{
      version: 'weekly-planning-generic-work-item-v1',
      id: 'work-item-past',
      taskId: 'task-1',
      componentId: null,
      workloadFactId: 'workload-1',
      label: '数学 60分',
      quantityRole: 'target',
      actionability: 'actionable',
      quantity: {
        amount: 60,
        unitCode: 'minute',
        unitLabel: '分',
        ordinalRange: null,
        actualRange: null,
      },
      estimatedMinutes: 60,
      estimateBasis: 'intrinsic_duration',
      estimateSourceFactIds: [],
      estimateSourceWorkloadFactIds: [],
      splitPolicy: 'splittable',
      periodExpression: null,
      sourceFactRefs: ['task-1', 'workload-1'],
      requiredDate: '2026-09-04',
    }],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: ['task-1', 'workload-1'],
  };
}

describe('Stable V5 preview trace diagnostics', () => {
  it('preserves unscheduled work item ids in the projected debug trace', () => {
    const traceRequestId = 'preview-trace-unscheduled';
    const value = graph();
    const preview = executeWeeklyPlanningStableV5Preview({
      input: {
        plans: [],
        scheduleTemplates: [],
        timetableTermId: undefined,
        traceRequestId,
      },
      graph: createWeeklyPlanningPlacementGraphViewV5(
        createWeeklyPlanningActiveSchedulerGraphViewV5(value),
      ),
      schedulerInput: schedulerInput(),
      requestContext: {
        startedAtIso: '2026-09-05T00:00:00.000Z',
        timeZone: 'Asia/Tokyo',
        currentDate: '2026-09-05',
        currentTime: '09:00',
        notBeforeDate: '2026-09-05',
        notBeforeTime: '09:00',
        weekStartsOn: 'monday',
      },
    });

    expect(preview.unscheduledWorkItemIds).toEqual(['work-item-past']);
    const event = takeWeeklyPlanningStableV5DebugTrace(traceRequestId)
      .find((candidate) => candidate.stage === 'runtime_preview_scheduler_evaluated');
    expect(event?.data).toMatchObject({
      status: 'insufficient_capacity',
      unscheduledCount: 1,
      unscheduledWorkItems: ['work-item-past'],
    });
  });
});

function timedEvent(overrides: Partial<MonthEvent> = {}): MonthEvent {
  return {
    id: 'timed-event', userId: 'owner-1', date: '2026-09-04',
    title: 'PRIVATE_EVENT_TITLE', startTime: '09:00', endTime: '10:00',
    repeat: 'none', repeatUntil: null, excludedDates: [],
    url: 'https://example.invalid/private', memo: 'PRIVATE_EVENT_MEMO',
    checklist: [], locationTags: [], createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z', ...overrides,
  };
}

function previewWithTimedEvents(events: MonthEvent[], ownerId = 'owner-1', plans: Plan[] = []) {
  const original = structuredClone(events);
  const scheduler = schedulerInput();
  scheduler.ownerId = ownerId;
  scheduler.horizon.endDate = scheduler.horizon.startDate;
  // Use the real application facade, not a direct call to the interval helper.
  // This extra existing runtime input must reach the placement engine.
  const input = {
    plans, scheduleTemplates: [], timetableTermId: undefined,
    monthEvents: events, traceRequestId: `timed-event-preview-${ownerId}`,
  };
  const preview = executeWeeklyPlanningStableV5Preview({
    input, schedulerInput: scheduler,
    graph: createWeeklyPlanningPlacementGraphViewV5(
      createWeeklyPlanningActiveSchedulerGraphViewV5(graph()),
    ),
    requestContext: {
      startedAtIso: '2026-09-04T00:00:00.000Z', timeZone: 'Asia/Tokyo',
      currentDate: '2026-09-04', currentTime: '09:00',
      notBeforeDate: '2026-09-04', notBeforeTime: '09:00', weekStartsOn: 'monday',
    },
  });
  const trace = takeWeeklyPlanningStableV5DebugTrace(input.traceRequestId);
  expect(events).toEqual(original);
  expect(preview.status).toBe('ready');
  expect(preview.candidates).toHaveLength(1);
  expect(preview.unscheduledWorkItemIds).toEqual([]);
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  expect(preview.candidates.reduce((total, item) =>
    total + minutes(item.endTime) - minutes(item.startTime), 0)).toBe(60);
  const previewTrace = trace.filter(event => event.stage === 'runtime_preview_scheduler_evaluated');
  expect(previewTrace).toHaveLength(1);
  expect(previewTrace[0].data).toMatchObject({
    status: 'ready', candidateCount: 1, unscheduledCount: 0,
    candidates: [expect.objectContaining({
      date: preview.candidates[0].date, startTime: preview.candidates[0].startTime,
      endTime: preview.candidates[0].endTime,
    })],
  });
  const serialized = JSON.stringify(trace);
  expect(serialized).not.toContain('PRIVATE_EVENT_TITLE');
  expect(serialized).not.toContain('PRIVATE_EVENT_MEMO');
  expect(serialized).not.toContain('https://example.invalid/private');
  return preview;
}

describe('Stable V5 owned timed events reach ordinary previews', () => {
  it('matches the existing Plan buffer and placement-break contract through the same facade', () => {
    const event = timedEvent();
    const plan: Plan = {
      id: event.id, seriesId: event.id, userId: event.userId,
      title: event.title, subject: '', date: event.date,
      startTime: event.startTime, endTime: event.endTime,
      repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
      type: 'other', memo: event.memo, createdAt: event.createdAt, updatedAt: event.updatedAt,
    };
    const busyInput = { input: schedulerInput(), dates: ['2026-09-04'], scheduleTemplates: [] };
    const planBusy = buildPlacementBusyIntervals({ ...busyInput, plans: [plan] });
    expect(planBusy).toEqual([{ date: '2026-09-04', start: 530, end: 610 }]);
    expect(buildPlacementBusyIntervals({ ...busyInput, plans: [], monthEvents: [event] }))
      .toEqual(planBusy);
    const planPreview = previewWithTimedEvents([], event.userId, [plan]);
    // Existing busy buffer ends10:10; the existing slot search adds break10.
    expect(planPreview.candidates[0]).toMatchObject({ startTime: '10:20', endTime: '11:20' });
    expect(planPreview.candidates[0].startTime >= event.endTime).toBe(true);
    expect(previewWithTimedEvents([event])).toEqual(planPreview);
  });

  it.each(['owner-1', 'owner-2'])('blocks only %s events while preserving a nonempty 60 minute preview', ownerId => {
    const baseline = previewWithTimedEvents([], ownerId);
    expect(baseline.candidates[0]).toMatchObject({ date: '2026-09-04', startTime: '09:00', endTime: '10:00' });
    const foreign = timedEvent({ userId: ownerId === 'owner-1' ? 'owner-2' : 'owner-1' });
    expect(previewWithTimedEvents([foreign], ownerId)).toEqual(baseline);
    const owned = timedEvent({ userId: ownerId });
    const blocked = previewWithTimedEvents([owned], ownerId);
    expect(blocked.candidates[0]).toMatchObject({ date: '2026-09-04', startTime: '10:20', endTime: '11:20' });
    expect(previewWithTimedEvents([owned, foreign], ownerId)).toEqual(blocked);
  });

  it('preserves the baseline when a timed event explicitly does not block time', () => {
    expect(previewWithTimedEvents([timedEvent({ busy: false })])).toEqual(previewWithTimedEvents([]));
  });

  it('blocks a later weekly occurrence and releases an explicitly excluded date', () => {
    const weekly = timedEvent({ date: '2026-08-28', repeat: 'weekly', repeatUntil: '2026-09-11' });
    expect(previewWithTimedEvents([weekly]).candidates[0].startTime).toBe('10:20');
    expect(previewWithTimedEvents([{ ...weekly, excludedDates: ['2026-09-04'] }]))
      .toEqual(previewWithTimedEvents([]));
  });

  it('retains a timed span that starts before the current planning horizon', () => {
    const spanning = timedEvent({ date: '2026-09-03', endDate: '2026-09-04', startTime: '20:00' });
    expect(previewWithTimedEvents([spanning]).candidates[0].startTime).toBe('10:20');
  });

  it.each(['24:00', '23:59', '00:00'])('does not decide the deferred all-day %s policy in the timed slice', endTime => {
    expect(previewWithTimedEvents([timedEvent({ startTime: '00:00', endTime })]))
      .toEqual(previewWithTimedEvents([]));
  });
});


describe('Stable V5 timed-event clock validation before placement', () => {
  it.each(['09:99', '25:00', ''])('fails closed for an owned occupied end clock %s', endTime => {
    // Empty end clocks are otherwise discarded by the canonical lexical
    // overlap filter before a post-projection validity check can observe them.
    expect(() => previewWithTimedEvents([timedEvent({ endTime })]))
      .toThrow(new RangeError('Invalid timed schedule occurrence clock'));
  });

  it('rejects clocks only for relevant owned busy occurrences', () => {
    const baseline = previewWithTimedEvents([]);
    for (const endTime of ['09:99', '25:00', '']) {
      const unrelated = [
        timedEvent({ endTime, userId: 'foreign-owner' }),
        timedEvent({ endTime, busy: false }),
        timedEvent({ endTime, date: '2026-09-06' }),
        timedEvent({ endTime, excludedDates: ['2026-09-04'] }),
        timedEvent({ endTime, date: '2026-08-28', repeat: 'weekly', repeatUntil: '2026-09-03' }),
      ];
      for (const event of unrelated) expect(previewWithTimedEvents([event])).toEqual(baseline);
    }
  });

  it('retains actual occupied intervals for a legitimate canonical 24:00 endpoint', () => {
    const event = timedEvent({ startTime: '23:00', endTime: '24:00' });
    expect(buildPlacementBusyIntervals({
      input: schedulerInput(), dates: ['2026-09-04', '2026-09-05'],
      plans: [], monthEvents: [event], scheduleTemplates: [],
    })).toEqual([
      { date: '2026-09-04', start: 1370, end: 1440 },
      { date: '2026-09-05', start: 0, end: 10 },
    ]);
    expect(previewWithTimedEvents([event])).toEqual(previewWithTimedEvents([]));
  });
});

it('persists a canonical timed-event preview through the real outbox retry and Worker boundary', async () => {
  const storage = createMemoryStorageHarness();
  const restore = installWeeklyPlanningTestStorage(storage.storage);
  resetWeeklyPlanningStableV5TraceRuntimeForTest();
  const writes: Array<Parameters<WeeklyPlanningTraceRepository['appendEntries']>[0]> = [];
  let failFirst = true;
  const repository: WeeklyPlanningTraceRepository = {
    async upsertSession() {},
    async appendEntries(params) {
      if (failFirst) { failFirst = false; throw new Error('injected D append failure'); }
      writes.push(structuredClone(params));
    },
    async listSessions() { return []; }, async listSessionsForAdmin() { return []; },
    async archiveSessionForAdmin() {}, async getSession() { return null; }, async listEntries() { return []; },
  };
  setWeeklyPlanningTraceRepositoryForTests(repository);
  try {
    const gateway = createLocalPlannerStorageGateway(storage.storage);
    const authority = createLocalScheduleEventAuthority(gateway, storage.storage);
    await authority.upsertMonthEvent(timedEvent({ busy: true }));
    const loaded = await authority.getScheduleSnapshot('owner-1');
    expect(loaded.monthEvents).toHaveLength(1);
    expect(loaded.monthEvents[0].busy).toBeUndefined(); // canonical true survives as legacy default
    const canonicalRows = JSON.parse(storage.values.get('studyplanner.scheduleEvents.v1')!);
    expect(canonicalRows).toEqual([expect.objectContaining({ id: 'month-event:timed-event', busy: true })]);
    const snapshotReads = vi.spyOn(authority, 'getScheduleSnapshot');
    const monthReads = vi.spyOn(authority, 'getMonthEvents');
    const planReads = vi.spyOn(authority, 'getPlans');
    const scheduler = schedulerInput();
    scheduler.horizon.endDate = scheduler.horizon.startDate;
    const requestId = 'weekly-conversation-278e4567-e89b-52d3-a456-426614174000:request:1';
    const preview = executeWeeklyPlanningStableV5Preview({
      input: { plans: loaded.plans, monthEvents: loaded.monthEvents, scheduleTemplates: [], traceRequestId: requestId },
      schedulerInput: scheduler,
      graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(graph())),
      requestContext: {
        startedAtIso: '2026-09-04T00:00:00.000Z', timeZone: 'Asia/Tokyo',
        currentDate: '2026-09-04', currentTime: '09:00',
        notBeforeDate: '2026-09-04', notBeforeTime: '09:00', weekStartsOn: 'monday',
      },
    });
    expect(preview.status).toBe('ready');
    expect(preview.candidates).toHaveLength(1);
    expect(preview.candidates[0]).toMatchObject({ date: '2026-09-04', startTime: '10:20', endTime: '11:20', durationMinutes: 60 });
    expect(preview.unscheduledWorkItemIds).toEqual([]);
    expect(snapshotReads).not.toHaveBeenCalled(); expect(monthReads).not.toHaveBeenCalled(); expect(planReads).not.toHaveBeenCalled();
    const actualEvents = takeWeeklyPlanningStableV5DebugTrace(requestId);
    expect(actualEvents).toHaveLength(1);
    expect(actualEvents[0].stage).toBe('runtime_preview_scheduler_evaluated');
    expect(actualEvents[0].data).toMatchObject({ status: 'ready', candidateCount: 1, candidates: preview.candidates });
    const rawData = actualEvents[0].data as Record<string, unknown>;
    const augmentedCandidate = { ...preview.candidates[0], futureTimedPreviewField: 'future-D-timed-preview' };
    expect(measureWeeklyPlanningTraceJsonBytes(augmentedCandidate)).toBeLessThan(1_000);
    const events = [{ ...actualEvents[0], data: { ...rawData, candidates: [augmentedCandidate] } }];
    const first = {
      userId: 'owner-1', conversationId: 'weekly-conversation-278e4567-e89b-52d3-a456-426614174000', requestId,
      userText: '数学を60分進めたい', assistantMessage: '候補を確認してください。',
      responseSource: 'ai' as const, outcome: 'scheduler_ready', previewCount: 1, debugTraceEvents: events,
    };
    await recordWeeklyPlanningStableV5TurnTrace(first);
    expect(writes).toHaveLength(0);
    const outboxKey = 'studyplanner.weeklyPlanning.trace.outbox.v1';
    const durableBytes = storage.values.get(outboxKey);
    expect(durableBytes).toBeDefined();
    const queued = listWeeklyPlanningTraceOutboxItems(first);
    expect(queued).toHaveLength(1);
    expect(JSON.parse(durableBytes!).items).toEqual(queued);
    expect(queued[0].input.debugTraceEvents).toEqual(JSON.parse(JSON.stringify(events)));
    for (const privateValue of ['timed-event', 'PRIVATE_EVENT_TITLE', 'PRIVATE_EVENT_MEMO', 'https://example.invalid/private']) {
      expect(durableBytes).not.toContain(privateValue);
    }
    resetWeeklyPlanningStableV5TraceRuntimeMemoryForTest();
    const storageRead = vi.spyOn(storage.storage, 'getItem');
    await recordWeeklyPlanningStableV5TurnTrace({ ...first, requestId: `${first.conversationId}:request:2`, previewCount: 0, debugTraceEvents: [] });
    expect(storageRead).toHaveBeenCalledWith(outboxKey);
    expect(storageRead.mock.results.some((result) => result.type === 'return' && result.value === durableBytes)).toBe(true);
    expect(writes).toHaveLength(2);
    expect(listWeeklyPlanningTraceOutboxItems(first)).toEqual([]);
    const replayed = writes[0].entries[0];
    expect(replayed.kind).toBe('turn_diagnostic');
    if (replayed.kind !== 'turn_diagnostic') throw new Error('expected the actual replay diagnostic');
    expect(replayed.requestId).toBe(requestId);
    expect(replayed.constraintContext.scheduler?.preview?.representativeCandidates).toEqual([augmentedCandidate]);

    const hugeCandidate = { ...augmentedCandidate, oversizedFutureField: 'large-D-future-field-'.repeat(4_000) };
    await recordWeeklyPlanningStableV5TurnTrace({
      ...first, requestId: `${first.conversationId}:request:3`,
      debugTraceEvents: [{ ...actualEvents[0], data: { ...rawData, candidates: [hugeCandidate] } }],
    });
    expect(writes).toHaveLength(3);
    const huge = writes[2].entries[0];
    expect(huge.kind).toBe('turn_diagnostic');
    if (huge.kind !== 'turn_diagnostic') throw new Error('oversized candidate must not drop the turn');
    expect(huge.constraintContext.scheduler?.preview?.representativeCandidates[0]).toMatchObject({
      traceTruncated: true, originalBytes: measureWeeklyPlanningTraceJsonBytes(hugeCandidate),
    });
    expect(huge.diagnostics.truncation?.fields).toContain('constraintContext.scheduler.preview.representativeCandidates[0]');
    for (const [index, write] of writes.entries()) {
      expect(write.entries).toHaveLength(1);
      const entry = write.entries[0];
      expect(entry.kind).toBe('turn_diagnostic');
      expect(entry.requestId).toBe(`${first.conversationId}:request:${index + 1}`);
      expect(measureWeeklyPlanningTraceJsonBytes(entry)).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.clientDocumentTargetBytes);
      const prepared = prepareWeeklyPlanningTraceServerWrite({
        session: write.session as unknown as Record<string, unknown>,
        entries: write.entries as unknown as Record<string, unknown>[],
      }, { token: `wpt_${'b'.repeat(43)}`, epoch: '100' }, {
        sessionId: 'weekly-trace-278e4567-e89b-52d3-a456-426614174000', logicalConversationId: first.conversationId,
      }, '2026-09-04T00:00:00.000Z');
      expect(prepared.entries).toHaveLength(1);
      expect(prepared.entries[0]).toMatchObject({ kind: 'turn_diagnostic', requestId: entry.requestId });
      expect(measureWeeklyPlanningTraceJsonBytes(prepared.entries[0])).toBeLessThanOrEqual(WEEKLY_PLANNING_TRACE_TRANSPORT_LIMITS.maxDocumentBytes);
      const serialized = JSON.stringify(prepared.entries[0]);
      for (const privateValue of ['timed-event', 'PRIVATE_EVENT_TITLE', 'PRIVATE_EVENT_MEMO', 'https://example.invalid/private']) expect(serialized).not.toContain(privateValue);
      if (index === 0) expect(prepared.entries[0]).toMatchObject({ constraintContext: { scheduler: { preview: { representativeCandidates: [augmentedCandidate] } } } });
      if (index === 2) expect(prepared.entries[0]).toMatchObject({ constraintContext: { scheduler: { preview: { representativeCandidates: [expect.objectContaining({ traceTruncated: true })] } } } });
    }
    // A second canonical read demonstrates explicit false rather than relying on
    // a manually edited compatibility array. It is setup for the control preview.
    await authority.upsertMonthEvent(timedEvent({ busy: false }));
    const free = await authority.getScheduleSnapshot('owner-1');
    expect(free.monthEvents[0].busy).toBe(false);
    expect(previewWithTimedEvents(free.monthEvents)).toEqual(previewWithTimedEvents([]));
  } finally {
    vi.restoreAllMocks();
    resetWeeklyPlanningStableV5TraceRuntimeForTest();
    setWeeklyPlanningTraceRepositoryForTests(undefined);
    restore();
  }
});
