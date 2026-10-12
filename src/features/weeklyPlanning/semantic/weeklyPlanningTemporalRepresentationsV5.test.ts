import { describe, expect, it } from 'vitest';
import { questionIntentForStableV5Dialogue } from '../dialogue/weeklyPlanningStableV5DialogueContext';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { createEmptyWeeklyPlanningFactGraphV5, type AvailabilityDeclarationFactV5, type TemporalConstraintFactV5, type WeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { compileGenericSchedulerInput } from './weeklyPlanningGenericSchedulerInput';
import { createWeeklyPlanningPlacementGraphViewV5 } from './weeklyPlanningPlacementGraphViewV5';
import { buildHardAvailableWindowsByDate, buildPlacementWindowsByDate } from './weeklyPlanningStableV5PlacementAvailability';
import { scheduleWeeklyPlanningStableV5Preview } from './weeklyPlanningStableV5PreviewScheduler';

const source = { conversationId: 'temporal-forms', turnId: 'turn-1', semanticLocalId: 'fact', sourceText: 'typed fact', origin: 'user' as const };
function preference(overrides: Partial<TemporalConstraintFactV5> = {}): TemporalConstraintFactV5 {
  return { id: 'preference', taskId: 'task', targetFactId: 'task', kind: 'preferred_window', constraintLevel: 'soft',
    dateExpression: null, namedTimePeriod: null, startTime: '20:00', endTime: null,
    precision: 'exact', source, createdRevision: 1, ...overrides };
}
function availability(overrides: Partial<AvailabilityDeclarationFactV5> = {}): AvailabilityDeclarationFactV5 {
  return { id: 'availability', kind: 'available', dateExpression: '2026-10-12', namedTimePeriod: null,
    startTime: '20:00', endTime: null, recurrenceKind: null, days: [], constraintLevel: 'soft', resolutionStatus: 'unresolved',
    source, createdRevision: 1, ...overrides };
}
function graph(overrides: Partial<WeeklyPlanningFactGraphV5> = {}): WeeklyPlanningFactGraphV5 {
  const value = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 1,
    tasks: [{ id: 'task', category: 'non_study' as const, title: 'work', source, createdRevision: 1 }],
    workloads: [{ id: 'work', taskId: 'task', componentId: null, quantityRole: 'target' as const, amount: 60,
      unitCode: 'minute' as const, unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false,
      periodExpression: null, source, createdRevision: 1 }],
    planningWindows: [{ id: 'window', kind: 'absolute' as const, value: '2026-10-12/2026-10-18',
      start: '2026-10-12', end: '2026-10-18', source, createdRevision: 1 }], ...overrides };
  value.factLifecycles = [value.tasks, value.workloads, value.planningWindows, value.temporalConstraints, value.availabilityDeclarations]
    .flat().map(fact => ({ factId: fact.id, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null }));
  return value;
}
function compile(value: WeeklyPlanningFactGraphV5, currentDate = '2026-10-08') {
  return compileGenericSchedulerInput({ graph: createWeeklyPlanningActiveSchedulerGraphViewV5(value), context: {
    ownerId: 'owner', currentDate, planningStartDate: '2026-10-12', planningEndDate: '2026-10-18', timeZone: 'Asia/Tokyo',
  } });
}
function schedule(value: WeeklyPlanningFactGraphV5) {
  const compilation = compile(value);
  expect(compilation.issues).toEqual([]);
  expect(compilation.status).toBe('ready');
  const result = scheduleWeeklyPlanningStableV5Preview({ input: compilation.input!,
    graph: createWeeklyPlanningPlacementGraphViewV5(createWeeklyPlanningActiveSchedulerGraphViewV5(value)),
  });
  expect(result.status).toBe('ready');
  return { compilation, result };
}

describe('typed temporal representation closure', () => {
  it.each([
    { form: 'start only', changes: {}, startMinute: 1200, endMinute: 1440, startTime: '20:00' },
    { form: 'end only', changes: { startTime: null, endTime: '08:00' }, startMinute: 0, endMinute: 480, startTime: '00:00' },
    { form: 'both clocks', changes: { endTime: '23:00' }, startMinute: 1200, endMinute: 1380, startTime: '20:00' },
    { form: 'named period', changes: { startTime: null, namedTimePeriod: 'evening' as const }, startMinute: 1020, endMinute: 1260, startTime: '17:00' },
  ])('keeps task $form through real compilation and placement', ({ changes, startMinute, endMinute, startTime }) => {
    const value = graph({ temporalConstraints: [preference(changes)] });
    const before = structuredClone(value);
    const { compilation, result } = schedule(value);
    expect(compilation.input?.preferredPlacements).toEqual([expect.objectContaining({
      taskId: 'task', targetFactId: 'task', sourceFactId: 'preference', window: { startMinute, endMinute },
    })]);
    expect(result.candidates).toEqual([expect.objectContaining({ date: '2026-10-12', startTime, durationMinutes: 60 })]);
    expect(value).toEqual(before);
  });

  it('retains a valid date-only preference', () => {
    const { result } = schedule(graph({ temporalConstraints: [preference({ dateExpression: '2026-10-16', startTime: null })] }));
    expect(result.candidates[0].date).toBe('2026-10-16');
  });

  it.each([
    { changes: { constraintLevel: 'unknown' as const }, code: 'unknown_constraint_level' },
    { changes: { dateExpression: 'custom:later' }, code: 'unsupported_date_expression' },
    { changes: { startTime: null, namedTimePeriod: 'custom:late' as const }, code: 'named_time_period_unresolved' },
    { changes: { endTime: '19:00' }, code: 'invalid_time_interval' },
  ])('blocks unsupported task preference: $code', ({ changes, code }) => {
    const compiled = compile(graph({ temporalConstraints: [preference(changes)] }));
    expect(compiled.status).toBe('needs_resolution');
    expect(compiled.input).toBeNull();
    expect(compiled.issues).toEqual([expect.objectContaining({ domain: 'temporal_constraint', code, factId: 'preference', blocking: true })]);
  });

  it.each([
    { startTime: null, namedTimePeriod: 'night' as const }, { startTime: '20:00' }, { startTime: null, endTime: '08:00' },
  ])('does not mistake missing work for unresolved known time: %j', changes => {
    const compiled = compile(graph({ workloads: [], temporalConstraints: [preference(changes)] }));
    expect(compiled.status).toBe('needs_resolution');
    expect(compiled.issues.filter(issue => issue.domain === 'temporal_constraint')).toEqual([]);
  });

  it('does not revive a removed unsupported preference', () => {
    const value = graph({ temporalConstraints: [preference({ constraintLevel: 'unknown' })] });
    Object.assign(value.factLifecycles.find(item => item.factId === 'preference')!, { status: 'removed', terminalRevision: 2 });
    expect(compile(value).issues).toEqual([]);
  });

  it.each(['soft', 'hard'] as const)('places a %s available start-only interval rather than dropping its midnight endpoint', constraintLevel => {
    const { compilation, result } = schedule(graph({ availabilityDeclarations: [availability({ constraintLevel })] }));
    expect(compilation.input?.availabilityWindows[0]).toMatchObject({ constraintLevel,
      start: { date: '2026-10-12', time: '20:00' }, end: { date: '2026-10-13', time: '00:00' } });
    expect(result.candidates).toEqual([expect.objectContaining({ date: '2026-10-12', startTime: '20:00' })]);
  });

  it('ranks soft availability without widening a hard available window', () => {
    const { result } = schedule(graph({ availabilityDeclarations: [availability(),
      availability({ id: 'hard', constraintLevel: 'hard', startTime: '10:00', endTime: '12:00' })] }));
    expect(result.candidates).toEqual([expect.objectContaining({ date: '2026-10-12', startTime: '10:00', endTime: '11:00' })]);
  });

  it('keeps authoritative unavailable time within a preferred available interval occupied', () => {
    const { result } = schedule(graph({ availabilityDeclarations: [availability(),
      availability({ id: 'busy', kind: 'unavailable', constraintLevel: 'hard', startTime: '20:00', endTime: '21:00' })] }));
    expect(result.candidates[0]).toMatchObject({ date: '2026-10-12' });
    expect(result.candidates[0].startTime >= '21:00').toBe(true);
    expect(result.candidates.every(candidate => candidate.date !== '2026-10-12'
      || candidate.endTime <= '20:00' || candidate.startTime >= '21:00')).toBe(true);
  });

  it('splits hard availability over dates with the same notBefore boundary for both placement consumers', () => {
    const input = compile(graph()).input!;
    input.availabilityWindows = [{ id: 'span', sourceRef: 'span', kind: 'available', constraintLevel: 'hard',
      ownerId: 'owner', timeZone: 'Asia/Tokyo', sourceKind: 'user_declaration', graphRevision: 1,
      start: { date: '2026-10-12', time: '20:00' }, end: { date: '2026-10-14', time: '02:00' } }];
    const params = { input, dates: ['2026-10-12', '2026-10-13', '2026-10-14'],
      notBefore: { date: '2026-10-12', time: '21:30' } };
    const expected = new Map([
      ['2026-10-12', [{ start: 1290, end: 1440 }]], ['2026-10-13', [{ start: 0, end: 1440 }]],
      ['2026-10-14', [{ start: 0, end: 120 }]],
    ]);
    expect(buildHardAvailableWindowsByDate(params)).toEqual(expected);
    expect(buildPlacementWindowsByDate({ ...params, dayStartTime: '09:00', dayEndTime: '22:00' })).toEqual(expected);
    expect(buildHardAvailableWindowsByDate({ ...params, dates: ['2026-10-13'] })).toEqual(new Map([['2026-10-13', [{ start: 0, end: 1440 }]]]));
  });

  it.each(['preferred', 'available'] as const)('asks for the date of a nonrecurring out-of-period %s weekday', kind => {
    const value = graph({ availabilityDeclarations: [availability({ kind, dateExpression: 'weekday:friday' })] });
    const compiled = compile(value);
    expect(compiled.status).toBe('needs_resolution');
    expect(compiled.issues).toEqual([expect.objectContaining({ domain: 'availability', code: 'availability_outside_planning_window', blocking: true, factId: 'availability' })]);
    expect(value.availabilityDeclarations[0]).toMatchObject({ dateExpression: 'weekday:friday', recurrenceKind: null, days: [] });
    expect(questionIntentForStableV5Dialogue({ questionCode: compiled.issues[0].code, questionTarget: null })).toMatchObject({
      resolutionKind: 'availability_date_scope', requestedInformation: ['availability_date_scope'],
    });
    value.availabilityDeclarations[0].dateExpression = '2026-10-16';
    expect(schedule(value).result.candidates[0]).toMatchObject({ date: '2026-10-16', startTime: '20:00' });
  });

  it.each([
    { name: 'absolute outside date', changes: { dateExpression: '2026-10-09' } },
    { name: 'hard available weekday', changes: { dateExpression: 'weekday:friday', constraintLevel: 'hard' as const } },
    { name: 'recurring weekday', changes: { dateExpression: 'weekday:friday', recurrenceKind: 'weekly' as const, days: ['weekday:friday'] } },
    { name: 'in-period weekday', changes: { dateExpression: 'weekday:wednesday' }, currentDate: '2026-10-12' },
  ])('does not broaden the narrow date-scope question: $name', ({ changes, currentDate }) => {
    const compiled = compile(graph({ availabilityDeclarations: [availability(changes)] }), currentDate);
    expect(compiled.issues.some(issue => issue.code === 'availability_outside_planning_window' && issue.blocking)).toBe(false);
  });
});
