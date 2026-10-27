import { describe, expect, it } from 'vitest';
import type { OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClientTypes';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { createEmptyWeeklyPlanningFactGraphV5, type TemporalConstraintFactV5 } from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import type { WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from './weeklyPlanningSemanticNormalizerV5';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

const TODAY = '2026-10-27';
const TOMORROW = '2026-10-28';
const AFTER_TOMORROW = '2026-10-29';
type Task = WeeklyPlanningSemanticDocumentV5['tasks'][number];
type Constraint = Task['temporalConstraints'][number];

// Same semantic-document builder shape as weeklyPlanningStableV5GenericSchedulerInput.test.ts.
// Clock gaps are accepted availability, so the tests exercise the compiler as well as placement.
function document(minutes: number, gaps: Array<[string, string, string]>): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: null,
    tasks: [{
      localId: 'study', category: 'study', title: '学習',
      study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [{
        localId: 'work', quantityRole: 'target', amount: minutes, unitCode: 'minute', unitLabel: '分',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '学習時間',
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: '学習',
    }],
    relations: [],
    availabilityDeclarations: gaps.map(([date, startTime, endTime], index) => ({
      localId: `free-${index}`, kind: 'available', dateExpression: date, namedTimePeriod: null,
      startTime, endTime, recurrenceKind: null, days: [], constraintLevel: 'hard', sourceText: '学習できる時間',
    })),
    constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  };
}

function temporal(
  kind: Constraint['kind'], startTime: string | null, endTime: string | null,
  constraintLevel: Constraint['constraintLevel'] = 'hard',
): Constraint {
  return {
    localId: `${kind}-${constraintLevel}`, targetLocalId: 'study', kind, constraintLevel,
    dateExpression: 'tomorrow', namedTimePeriod: null, startTime, endTime,
    precision: 'exact', sourceText: '明日の時間指定',
  };
}

function run(value: WeeklyPlanningSemanticDocumentV5, endDate = TOMORROW, hardWindow?: [string, string]) {
  const canonical = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({
    graph: createEmptyWeeklyPlanningFactGraphV5(), document: value,
    context: { conversationId: 'temporal-work', turnId: 'turn-1', expectedRevision: 0 },
  });
  expect(canonical.status, JSON.stringify(canonical.errors)).toBe('applied');
  if (hardWindow) {
    // Accepted graphs use the canonical one-sided hard bounds. The provider-wire
    // case below independently checks conversion of a hard preferred_window.
    const startBound: TemporalConstraintFactV5 = {
      id: 'accepted-hard-window', taskId: canonical.localToFactId.study, targetFactId: canonical.localToFactId.study,
      kind: 'earliest_start', constraintLevel: 'hard', dateExpression: 'tomorrow', namedTimePeriod: null,
      startTime: hardWindow[0], endTime: null, precision: 'exact', createdRevision: 1,
      source: { conversationId: 'temporal-work', turnId: 'turn-1', semanticLocalId: 'hard-window', sourceText: '明日の時間指定', origin: 'user' },
    };
    const bounds = [startBound, {
      ...startBound, id: 'accepted-hard-window-end', kind: 'latest_end' as const, startTime: null, endTime: hardWindow[1],
    }];
    canonical.graph.temporalConstraints.push(...bounds);
    canonical.graph.factLifecycles.push(...bounds.map(({ id }) => ({
      factId: id, status: 'active' as const, createdRevision: 1,
      terminalRevision: null, supersededByFactId: null,
    })));
  }
  const graph = createWeeklyPlanningActiveSchedulerGraphViewV5(canonical.graph);
  const compiled = compileGenericSchedulerInput({
    graph,
    context: {
      ownerId: 'owner-temporal-work', currentDate: TODAY,
      planningStartDate: TOMORROW, planningEndDate: endDate, timeZone: 'Asia/Tokyo',
    },
  });
  expect(compiled.status, JSON.stringify(compiled.issues)).toBe('ready');
  if (!compiled.input) throw new Error('Ready compiler omitted input');
  const input = compiled.input;
  const result = scheduleWeeklyPlanningStableV5Preview({
    input, graph: createWeeklyPlanningPlacementGraphViewV5(graph),
    notBefore: { date: TODAY, time: '12:00' },
  });
  const placed = result.candidates.map(({ date, startTime, endTime, durationMinutes }) => ({
    date, startTime, endTime, durationMinutes,
  }));
  const observed = {
    status: result.status, placed,
    totalMinutes: placed.reduce((sum, candidate) => sum + candidate.durationMinutes, 0),
    unscheduledWorkItemIds: result.unscheduledWorkItemIds,
    items: input.movableWorkItems.map(({ id, estimatedMinutes, splitPolicy }) => ({ id, estimatedMinutes, splitPolicy })),
  };
  return { input, graph, result, placed, observed, evidence: JSON.stringify(observed) };
}

function runHardWindow(value: WeeklyPlanningSemanticDocumentV5, startTime: string, endTime: string) {
  return run(value, TOMORROW, [startTime, endTime]);
}

function slot(startTime: string, endTime: string, durationMinutes: number, date = TOMORROW) {
  return { date, startTime, endTime, durationMinutes };
}

function expectInsufficient(actual: ReturnType<typeof run>) {
  expect(actual.result.status, actual.evidence).toBe('insufficient_capacity');
  expect(actual.placed, actual.evidence).toEqual([]);
  expect(actual.observed.totalMinutes).toBe(0);
  expect(actual.result.unscheduledWorkItemIds.length, actual.evidence).toBeGreaterThan(0);
}

describe('Stable V5 temporal and work semantics through accepted typed input', () => {
  it.each(['minute', 'hour'] as const)('1 (%s): splits 60 minutes into the only two useful 30-minute gaps', (unitCode) => {
    const value = document(60, [[TOMORROW, '09:00', '09:30'], [TOMORROW, '11:00', '11:30']]);
    value.tasks[0].workloads[0] = {
      ...value.tasks[0].workloads[0], unitCode, amount: unitCode === 'hour' ? 1 : 60,
      unitLabel: unitCode === 'hour' ? '時間' : '分',
    };
    const actual = run(value);
    expect(actual.placed, actual.evidence).toEqual([slot('09:00', '09:30', 30), slot('11:00', '11:30', 30)]);
    expect(actual.result.status).toBe('ready');
    expect(actual.observed.totalMinutes).toBe(60);
    expect(actual.result.unscheduledWorkItemIds).toEqual([]);
  });

  it('2: prefers one contiguous 120-minute sitting when that intended block fits', () => {
    const actual = run(document(120, [[TOMORROW, '09:00', '11:00']]));
    expect(actual.placed, actual.evidence).toEqual([slot('09:00', '11:00', 120)]);
    expect(actual.result.status).toBe('ready');
    expect(actual.observed.totalMinutes).toBe(120);
  });

  it('2b: preserves the generic 180-minute workload policy as two intended 90-minute sittings', () => {
    const actual = run(document(180, [[TOMORROW, '09:00', '13:00']]));
    expect(actual.placed, actual.evidence).toEqual([slot('09:00', '10:30', 90), slot('10:40', '12:10', 90)]);
    expect(actual.result.status).toBe('ready');
    expect(actual.observed.totalMinutes).toBe(180);
  });

  it('3: never splits an explicitly atomic mock exam across fragmented free time', () => {
    const value = document(180, [[TOMORROW, '09:00', '11:00'], [TOMORROW, '13:00', '15:00']]);
    value.tasks[0].workloads[0] = { ...value.tasks[0].workloads[0], amount: 1, unitCode: 'mock_exam', unitLabel: '回' };
    value.tasks[0].effortEstimates = [{
      localId: 'effort', targetLocalId: 'work', kind: 'total_duration', minutes: 180,
      unitCode: null, precision: 'exact', sourceText: '模試を連続で受ける',
    }];
    const actual = run(value);
    expect(actual.input.movableWorkItems).toHaveLength(1);
    expect(actual.input.movableWorkItems[0].splitPolicy).toBe('atomic');
    expectInsufficient(actual);
  });

  it('4a: never falls outside a hard 13:00–17:00 task window when that window is busy', () => {
    const value = document(60, [[TOMORROW, '09:00', '20:00']]);
    value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: 'busy', kind: 'unavailable', startTime: '13:00', endTime: '17:00',
    });
    expectInsufficient(runHardWindow(value, '13:00', '17:00'));
  });

  it('4b: may fall back outside a soft 13:00–17:00 task window when that window is busy', () => {
    const value = document(60, [[TOMORROW, '09:00', '20:00']]);
    value.tasks[0].temporalConstraints = [temporal('preferred_window', '13:00', '17:00', 'soft')];
    value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: 'busy', kind: 'unavailable', startTime: '13:00', endTime: '17:00',
    });
    const actual = run(value);
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('09:00', '10:00', 60)]);
    expect(actual.observed.totalMinutes).toBe(60);
  });

  it.each([true, false])('4d (busy=%s): preserves hard bounds through the real provider-response normalize and validate path', async (busy) => {
    const value = document(60, [[TOMORROW, '09:00', '20:00']]);
    value.tasks[0].temporalConstraints = [temporal('preferred_window', '13:00', '17:00')];
    if (busy) value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: 'busy', kind: 'unavailable', startTime: '13:00', endTime: '17:00',
    });
    const client: OpenAiCompatibleClient = { async createChatCompletion() { return JSON.stringify(value); } };
    const normalized = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: '明日の13〜17時の間に1時間勉強 学習 学習時間 明日の時間指定 学習できる時間',
    });
    expect(normalized.status, JSON.stringify(normalized.diagnostics)).toBe('accepted');
    if (!normalized.document) throw new Error('Accepted normalizer omitted document');
    const actual = run(normalized.document);
    if (busy) expectInsufficient(actual);
    else {
      expect(actual.placed, actual.evidence).toEqual([slot('13:00', '14:00', 60)]);
      expect(actual.result.status).toBe('ready');
      expect(actual.observed.totalMinutes).toBe(60);
    }
    expect(actual.input.hardClockBounds).toHaveLength(2);
  });

  it('4c: honours equivalent hard earliest-start and latest-end bounds when the interval is busy', () => {
    const value = document(60, [[TOMORROW, '09:00', '20:00']]);
    value.tasks[0].temporalConstraints = [
      temporal('earliest_start', '13:00', null), temporal('latest_end', null, '17:00'),
    ];
    value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: 'busy', kind: 'unavailable', startTime: '13:00', endTime: '17:00',
    });
    const actual = run(value);
    expect(actual.input.hardClockBounds).toHaveLength(2);
    expectInsufficient(actual);
  });

  it('5a: places one hour tomorrow at or after hard earliest-start 14:00', () => {
    const value = document(60, [[TOMORROW, '09:00', '16:00']]);
    value.tasks[0].temporalConstraints = [temporal('earliest_start', '14:00', null)];
    const actual = run(value);
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('14:00', '15:00', 60)]);
    expect(actual.observed.totalMinutes).toBe(60);
  });

  it('5b: keeps 30 minutes within tomorrow’s requested 18:00–20:00 interval', () => {
    const value = document(30, [[TOMORROW, '09:00', '21:00']]);
    const actual = runHardWindow(value, '18:00', '20:00');
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('18:00', '18:30', 30)]);
    expect(actual.observed.totalMinutes).toBe(30);
  });

  it('5c: splits two hours into 60+60 before tomorrow’s deadline instead of using later capacity', () => {
    const value = document(120, [
      [TOMORROW, '09:00', '10:00'], [TOMORROW, '11:00', '12:00'], [AFTER_TOMORROW, '09:00', '12:00'],
    ]);
    value.tasks[0].temporalConstraints = [temporal('deadline', null, null)];
    const actual = run(value, AFTER_TOMORROW);
    expect(actual.placed, actual.evidence).toEqual([slot('09:00', '10:00', 60), slot('11:00', '12:00', 60)]);
    expect(actual.result.status).toBe('ready');
    expect(actual.observed.totalMinutes).toBe(120);
    expect(actual.result.unscheduledWorkItemIds).toEqual([]);
  });

  it('6: preserves a fixed 15:00–16:00 event exactly rather than moving or splitting it', () => {
    const value = document(60, [[TOMORROW, '09:00', '20:00']]);
    value.tasks[0].category = 'non_study';
    value.tasks[0].study = null;
    value.tasks[0].temporalConstraints = [temporal('fixed_interval', '15:00', '16:00')];
    const actual = run(value);
    // Fixed commitments are reservations in this scheduler, not movable preview candidates.
    expect(actual.input.fixedTaskReservations).toHaveLength(1);
    expect(actual.input.fixedTaskReservations[0]).toMatchObject({
      start: { date: TOMORROW, time: '15:00' }, end: { date: TOMORROW, time: '16:00' }, constraintLevel: 'hard',
    });
    expect(actual.input.movableWorkItems).toEqual([]);
    expect(actual.result.status).toBe('empty');
    expect(actual.placed).toEqual([]);
    expect(actual.observed.totalMinutes).toBe(0);
    expect(actual.result.unscheduledWorkItemIds).toEqual([]);
  });

  it('7: reports insufficient capacity for two hours with only one free hour without fabricating time', () => {
    const actual = run(document(120, [[TOMORROW, '09:00', '10:00']]));
    expectInsufficient(actual);
  });

  it('8: keeps a hard 23:00–24:00 window on tomorrow’s date', () => {
    const value = document(30, [[TOMORROW, '09:00', '23:59']]);
    const actual = runHardWindow(value, '23:00', '24:00');
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('23:00', '23:30', 30)]);
    expect(actual.observed.totalMinutes).toBe(30);
  });

  it('9: records that a mis-emitted fixed interval suppresses the shorter movable workload', () => {
    const value = document(60, [[TOMORROW, '09:00', '20:00']]);
    value.tasks[0].temporalConstraints = [temporal('fixed_interval', '13:00', '17:00')];
    value.tasks[0].effortEstimates = [{
      localId: 'effort', targetLocalId: 'work', kind: 'total_duration', minutes: 60,
      unitCode: null, precision: 'exact', sourceText: '学習時間',
    }];
    const actual = run(value);
    expect(actual.input.fixedTaskReservations).toHaveLength(1);
    expect(actual.input.fixedTaskReservations[0]).toMatchObject({
      start: { date: TOMORROW, time: '13:00' }, end: { date: TOMORROW, time: '17:00' },
    });
    expect(actual.input.movableWorkItems).toEqual([]);
    expect(actual.result.status).toBe('empty');
    expect(actual.placed).toEqual([]);
    expect(actual.observed.totalMinutes).toBe(0);
  });

  it.each([60, 90])('keeps an explicit %s-minute sitting atomic when it equals or exceeds the total', (minutes) => {
    const value = document(60, [[TOMORROW, '09:00', '09:30'], [TOMORROW, '11:00', '11:30']]);
    value.tasks[0].effortEstimates = [{
      localId: 'sitting', targetLocalId: 'work', kind: 'session_duration', minutes,
      unitCode: null, precision: 'exact', sourceText: '連続して1時間',
    }];
    const actual = run(value);
    expect(actual.input.movableWorkItems[0].splitPolicy).toBe('atomic');
    expectInsufficient(actual);
  });

  it('rejects a 45+15 split rather than producing a fragment below 30 minutes', () => {
    expectInsufficient(run(document(60, [[TOMORROW, '09:00', '09:45'], [TOMORROW, '11:00', '11:15']])));
  });

  it('reduces a large fragment to preserve a useful final fragment and the exact total', () => {
    const actual = run(document(90, [[TOMORROW, '09:00', '10:15'], [TOMORROW, '11:00', '11:45']]));
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('09:00', '10:00', 60), slot('11:00', '11:30', 30)]);
    expect(actual.observed.totalMinutes).toBe(90);
  });

  it('retains hard task clock bounds and the existing busy-event break while fragmenting', () => {
    const value = document(60, [[TOMORROW, '09:00', '12:00'], [TOMORROW, '14:00', '16:00']]);
    value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: 'busy', kind: 'unavailable', startTime: '14:30', endTime: '15:20',
    });
    const actual = runHardWindow(value, '14:00', '16:00');
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('14:00', '14:30', 30), slot('15:30', '16:00', 30)]);
    expect(actual.observed.totalMinutes).toBe(60);
  });

  it('uses the largest free segments of a date and emits fragments in chronological order', () => {
    const actual = run(document(120, [
      [TOMORROW, '08:00', '08:30'], [TOMORROW, '09:00', '09:45'],
      [TOMORROW, '11:00', '12:15'], [TOMORROW, '13:00', '13:30'],
    ]));
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('09:00', '09:45', 45), slot('11:00', '12:15', 75)]);
    expect(actual.observed.totalMinutes).toBe(120);
    expect(new Set(actual.result.candidates.map(({ stableKey }) => stableKey)).size).toBe(2);
  });

  it('respects daily capacity while fragmenting across eligible days', () => {
    const value = document(120, [[TOMORROW, '09:00', '12:00'], [AFTER_TOMORROW, '09:00', '12:00']]);
    for (const date of [TOMORROW, AFTER_TOMORROW]) value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: `capacity-${date}`, kind: 'capacity', dateExpression: date,
      startTime: null, endTime: null, capacityMinutes: 60,
    });
    const actual = run(value, AFTER_TOMORROW);
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('09:00', '10:00', 60), slot('09:00', '10:00', 60, AFTER_TOMORROW)]);
    expect(actual.observed.totalMinutes).toBe(120);
  });

  it('does not consume busy time or capacity when a fragmented item cannot finish', () => {
    const value = document(120, [[TOMORROW, '09:00', '10:00']]);
    value.tasks.push({
      ...value.tasks[0], localId: 'second', title: '別の学習',
      workloads: [{ ...value.tasks[0].workloads[0], localId: 'second-work', amount: 30 }],
    });
    value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: 'capacity', kind: 'capacity', capacityMinutes: 60,
      startTime: null, endTime: null,
    });
    const actual = run(value);
    const partial = scheduleWeeklyPlanningStableV5Preview({
      input: actual.input, graph: createWeeklyPlanningPlacementGraphViewV5(actual.graph), retainPartialCandidates: true,
      notBefore: { date: TODAY, time: '12:00' },
    });
    expect(partial.status).toBe('insufficient_capacity');
    expect(partial.unscheduledWorkItemIds).toEqual([actual.input.movableWorkItems[0].id]);
    expect(partial.candidates).toHaveLength(1);
    expect(partial.candidates[0]).toMatchObject(slot('09:00', '09:30', 30));
  });

  it('prefers equal useful fragments on normal days over the seventh reserve day', () => {
    const reserveDate = '2026-11-03';
    const value = document(60, [
      [TOMORROW, '09:00', '09:30'], [TOMORROW, '11:00', '11:30'],
      [reserveDate, '09:00', '09:30'], [reserveDate, '11:00', '11:30'],
    ]);
    for (const date of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']) {
      value.availabilityDeclarations.push({
        ...value.availabilityDeclarations[0], localId: `busy-${date}`, kind: 'unavailable',
        dateExpression: date, startTime: '00:00', endTime: '23:59',
      });
    }
    const actual = run(value, reserveDate);
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('09:00', '09:30', 30), slot('11:00', '11:30', 30)]);
  });

  it('retains the compiled date priority when equal fragments exist on earlier and preferred dates', () => {
    const value = document(60, [
      [TOMORROW, '09:00', '09:30'], [TOMORROW, '11:00', '11:30'],
      [AFTER_TOMORROW, '09:00', '09:30'], [AFTER_TOMORROW, '11:00', '11:30'],
    ]);
    value.tasks.unshift({
      ...value.tasks[0], localId: 'first',
      workloads: [{ ...value.tasks[0].workloads[0], localId: 'first-work', amount: 30 }],
    });
    const actual = run(value, AFTER_TOMORROW);
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([
      slot('09:00', '09:30', 30),
      slot('09:00', '09:30', 30, AFTER_TOMORROW), slot('11:00', '11:30', 30, AFTER_TOMORROW),
    ]);
  });

  it('fills normal days before the reserve day even when the reserve gap is longer', () => {
    const reserveDate = '2026-11-03';
    const value = document(90, [[TOMORROW, '09:00', '09:45'], [TOMORROW, '11:00', '11:45'], [reserveDate, '09:00', '10:00']]);
    for (const date of ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']) {
      value.availabilityDeclarations.push({
        ...value.availabilityDeclarations[0], localId: `busy-${date}`, kind: 'unavailable',
        dateExpression: date, startTime: '00:00', endTime: '23:59',
      });
    }
    const actual = run(value, reserveDate);
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('09:00', '09:45', 45), slot('11:00', '11:45', 45)]);
  });

  it('keeps a soft preferred window first when fragments are needed', () => {
    const value = document(60, [
      [TOMORROW, '09:00', '09:30'], [TOMORROW, '11:00', '11:30'],
      [TOMORROW, '15:00', '15:30'], [TOMORROW, '17:00', '17:30'],
    ]);
    value.tasks[0].temporalConstraints = [temporal('preferred_window', '15:00', '18:00', 'soft')];
    const actual = run(value);
    expect(actual.result.status, actual.evidence).toBe('ready');
    expect(actual.placed).toEqual([slot('15:00', '15:30', 30), slot('17:00', '17:30', 30)]);
  });

  it('keeps the configured break between fragments of the same work', () => {
    // 09:00-09:30 and 09:35-10:05 are only five minutes apart; a second sitting would start too soon.
    expectInsufficient(run(document(60, [[TOMORROW, '09:00', '09:30'], [TOMORROW, '09:35', '10:05']])));
  });

  it('labels each fragment with its own amount', () => {
    const actual = run(document(60, [[TOMORROW, '09:00', '09:30'], [TOMORROW, '11:00', '11:30']]));
    expect(actual.result.candidates.map(({ title }) => title)).toEqual(['学習 30分（1/2）', '学習 30分（2/2）']);
  });

  it('documents the bounded greedy fallback: it may fail closed although a three-way split exists', () => {
    // 30+30+30 would fit, but the fallback takes 45 first on the earlier day. Nothing is placed or fabricated.
    const value = document(90, [[TOMORROW, '09:00', '09:45'], [TOMORROW, '11:00', '11:45'], [AFTER_TOMORROW, '09:00', '09:30']]);
    for (const [date, capacityMinutes] of [[TOMORROW, 60], [AFTER_TOMORROW, 30]] as const) value.availabilityDeclarations.push({
      ...value.availabilityDeclarations[0], localId: `capacity-${date}`, kind: 'capacity', dateExpression: date,
      startTime: null, endTime: null, capacityMinutes,
    });
    expectInsufficient(run(value, AFTER_TOMORROW));
  });

  it('does not round a non-quantum total into fabricated fragmented time', () => {
    const actual = run(document(66, [[TOMORROW, '09:00', '09:35'], [TOMORROW, '11:00', '11:35']]));
    // Isolate the scheduler's accepted-duration boundary from the compiler's
    // intrinsic-duration allocation rounding, which is a separate policy.
    const input = structuredClone(actual.input);
    input.movableWorkItems[0].estimatedMinutes = 66;
    const result = scheduleWeeklyPlanningStableV5Preview({
      input, graph: createWeeklyPlanningPlacementGraphViewV5(actual.graph),
      notBefore: { date: TODAY, time: '12:00' },
    });
    expect(result.status).toBe('insufficient_capacity');
    expect(result.candidates).toEqual([]);
    expect(result.unscheduledWorkItemIds).toEqual([input.movableWorkItems[0].id]);
  });

  it.each([
    ['earliest_start', '13:00', '17:00', null],
    ['latest_end', '13:00', '17:00', null],
    ['deadline', '13:00', '17:00', null],
    ['earliest_start', '13:00', null, 'afternoon'],
    ['latest_end', null, '17:00', 'afternoon'],
    ['deadline', null, '17:00', 'afternoon'],
  ] as const)('blocks unsupported hard %s clock shape %s–%s with named period %s', (kind, startTime, endTime, namedTimePeriod) => {
    const baseline = run(document(60, [[TOMORROW, '09:00', '20:00']]));
    const constraint: TemporalConstraintFactV5 = {
      id: 'unsupported-hard-bound', taskId: baseline.graph.tasks[0].id, targetFactId: baseline.graph.tasks[0].id,
      kind, constraintLevel: 'hard', dateExpression: 'tomorrow', namedTimePeriod, startTime, endTime,
      precision: 'exact', createdRevision: 1,
      source: { ...baseline.graph.tasks[0].source, semanticLocalId: 'bound' },
    };
    const compiled = compileGenericSchedulerInput({
      graph: { ...baseline.graph, temporalConstraints: [constraint] },
      context: {
        ownerId: 'owner-temporal-work', currentDate: TODAY,
        planningStartDate: TOMORROW, planningEndDate: TOMORROW, timeZone: 'Asia/Tokyo',
      },
    });
    expect(compiled.status).toBe('needs_resolution');
    expect(compiled.input).toBeNull();
    expect(compiled.issues).toContainEqual(expect.objectContaining({
      domain: 'temporal_constraint', code: 'invalid_time_interval', blocking: true, factId: constraint.id,
    }));
  });
});
