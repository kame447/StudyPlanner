import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { createEmptyWeeklyPlanningFactGraphV5, type WeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from '../semantic/weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from '../semantic/weeklyPlanningSemanticValidatorV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5, validateWeeklyPlanningFactGraphValueV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import { SEMANTIC_RECURRENCE_KINDS_V5, WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticTypesV5';
import { resolveWeeklyPlanningDateExpressionsV5 } from '../semantic/weeklyPlanningResolvedDateExpressionsV5';
import { resolveWeeklyPlanningTaskCommitments } from '../semantic/weeklyPlanningTaskCommitmentResolver';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from './weeklyPlanningStableV5SessionStorage';
import { prepareWeeklyPlanningStableV5Checkpoint } from './weeklyPlanningStableV5SessionCodec';
const OWNER = 'checkpoint-owner';
const WEEK = '2026-08-24';
const CONVERSATION = 'checkpoint-conversation';
function document(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: [{ localId: 'task', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [{ localId: 'work', quantityRole: 'target', amount: 30, unitCode: 'page', unitLabel: 'ページ',
        rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: '数学30ページ' }],
      effortEstimates: [{ localId: 'effort', targetLocalId: 'task', kind: 'total_duration', minutes: 30, unitCode: null, precision: 'exact', sourceText: '所要時間30分' }],
      temporalConstraints: [{ localId: 'clock', targetLocalId: 'task', kind: 'fixed_interval', constraintLevel: 'hard', dateExpression: null,
        namedTimePeriod: null, startTime: '18:00', endTime: '19:00', precision: 'exact', sourceText: '毎週水曜18時から19時' }],
      recurrence: [{ localId: 'repeat', targetLocalId: 'task', kind: 'weekly', count: null, days: ['weekday:wednesday'], sourceText: '毎週水曜' }],
      sourceText: '数学を毎週水曜18時から19時' }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] };
}
function graph(input = document()) {
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: input,
    context: { conversationId: CONVERSATION, turnId: 'turn', expectedRevision: 0 } });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}
const params = (value: WeeklyPlanningFactGraphV5) => ({ ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION,
  graph: value, planningState: createInitialPlanningState(WEEK) });
const load = () => loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
function reservations(value: WeeklyPlanningFactGraphV5) {
  return resolveWeeklyPlanningTaskCommitments({ graph: value,
    context: { currentDate: '2026-08-26', planningStartDate: WEEK, planningEndDate: '2026-08-30', timeZone: 'Asia/Tokyo' },
    resolvedDateExpressions: resolveWeeklyPlanningDateExpressionsV5({ graph: value, currentDate: '2026-08-26' }) });
}
let storage: ReturnType<typeof createMemoryStorageHarness>;
let restore: () => void;
beforeEach(() => { storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage); });
afterEach(() => restore());
const invalid: Array<[string, unknown]> = [
  ['kind', 'sometimes'], ['kind', null], ['kind', undefined],
  ...[-3, 0, 'twice', null, undefined, Number.NaN, Number.POSITIVE_INFINITY].map((value): [string, unknown] => ['count', value]),
  ['days', null], ['days', undefined], ['days', 'wednesday'], ['days', [null]], ['days', [' ']], ['days', [3]],
];
describe('recurrence validation and checkpoint write boundary', () => {
  it.each(invalid)('rejects recurrence %s = %s before serialization, save, or recovery', (field, value) => {
    const input = document(); Object.assign(input.tasks[0].recurrence[0], { kind: 'times_per_week', count: 2 });
    const canonical = graph(input); Object.assign(input.tasks[0].recurrence[0], { [field]: value });
    Object.assign(canonical.recurrences[0], { [field]: value });
    const expectedField = field === 'count' && value === null ? 'count:required' : field;
    expect(validateWeeklyPlanningSemanticValueV5(input).errors).toContain(`document.tasks[0].recurrence[0].${expectedField}`);
    expect(validateWeeklyPlanningFactGraphValueV5(canonical).errors).toContain(`graph.recurrences[0].${expectedField}`);
    expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(canonical)).graph).toBeNull();
    expect(() => serializeWeeklyPlanningFactGraphV5(canonical)).toThrow('Invalid WeeklyPlanningFactGraphV5');
    expect(saveWeeklyPlanningStableV5PersistedSession(params(canonical))).toBe(false);
    expect(storage.values.size).toBe(0);
  });
  it.each(SEMANTIC_RECURRENCE_KINDS_V5)('preserves valid %s kind and fractional count', (kind) => {
    const input = document(); Object.assign(input.tasks[0].recurrence[0], { kind, count: 0.5, days: [] });
    const canonical = graph(input);
    expect(saveWeeklyPlanningStableV5PersistedSession(params(canonical))).toBe(true);
    expect(load()?.graph).toEqual(canonical);
  });
  it.each(['weekday:wednesday', 'wed'])('round trips %s and still resolves the expected reservation', (day) => {
    const input = document(); input.tasks[0].recurrence[0].days = [day];
    const canonical = graph(input); expect(saveWeeklyPlanningStableV5PersistedSession(params(canonical))).toBe(true);
    const restored = load()!; expect(restored.graph).toEqual(canonical);
    const result = reservations(restored.graph); expect(result.issues).toEqual([]);
    expect(result.reservations).toEqual([expect.objectContaining({
      start: { date: '2026-08-26', time: '18:00' }, end: { date: '2026-08-26', time: '19:00' },
    })]);
  });
  it('rejects corrupt stored recurrence before downstream calendar resolution', () => {
    expect(saveWeeklyPlanningStableV5PersistedSession(params(graph()))).toBe(true);
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
    const stored = JSON.parse(storage.storage.getItem(key)!); stored.graph.recurrences[0].days = null;
    storage.storage.setItem(key, JSON.stringify(stored));
    expect(load()).toBeNull();
  });
  it.each(['amount', 'minutes', 'reference', 'recurrence'])('direct save does not replace a valid checkpoint with invalid %s', (field) => {
    const canonical = graph(); expect(saveWeeklyPlanningStableV5PersistedSession(params(canonical))).toBe(true);
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK); const before = storage.storage.getItem(key);
    const invalidGraph = structuredClone(canonical);
    if (field === 'amount') invalidGraph.workloads[0].amount = -1;
    if (field === 'minutes') invalidGraph.effortEstimates[0].minutes = 0;
    if (field === 'reference') invalidGraph.recurrences[0].targetFactId = 'absent';
    if (field === 'recurrence') Object.assign(invalidGraph.recurrences[0], { days: null });
    expect(prepareWeeklyPlanningStableV5Checkpoint(params(invalidGraph)).status).toBe('invalid');
    expect(saveWeeklyPlanningStableV5PersistedSession(params(invalidGraph))).toBe(false);
    expect(storage.storage.getItem(key)).toBe(before); expect(load()?.graph).toEqual(canonical);
    expect(reservations(load()!.graph).reservations).toHaveLength(1);
  });
  it('keeps intentional empty checkpoint removal and includeEmpty export working', () => {
    expect(saveWeeklyPlanningStableV5PersistedSession(params(graph()))).toBe(true);
    const empty = params(createEmptyWeeklyPlanningFactGraphV5());
    expect(prepareWeeklyPlanningStableV5Checkpoint(empty).status).toBe('empty');
    expect(prepareWeeklyPlanningStableV5Checkpoint({ ...empty, includeEmpty: true }).status).toBe('ready');
    expect(saveWeeklyPlanningStableV5PersistedSession(empty)).toBe(true);
    expect(load()).toBeNull();
  });
  it.each(['tasks', 'recurrences', 'source'])('returns invalid rather than throwing on malformed %s', (field) => {
    const value = graph();
    if (field === 'source') Object.assign(value.recurrences[0], { source: null });
    else Object.assign(value, { [field]: null });
    expect(prepareWeeklyPlanningStableV5Checkpoint(params(value)).status).toBe('invalid');
    expect(saveWeeklyPlanningStableV5PersistedSession(params(value))).toBe(false);
    expect(storage.values.size).toBe(0);
  });
  it.each(SEMANTIC_RECURRENCE_KINDS_V5.filter((kind) => kind !== 'times_per_week'))('keeps nullable count and broad string-day syntax for %s', (kind) => {
    const input = document(); Object.assign(input.tasks[0].recurrence[0], { kind, count: null, days: ['custom calendar expression'] });
    const canonical = graph(input); expect(saveWeeklyPlanningStableV5PersistedSession(params(canonical))).toBe(true);
    expect(load()?.graph).toEqual(canonical);
  });
  it('preserves overnight commitments and optional historical request sequence', () => {
    const input = document(); Object.assign(input.tasks[0].temporalConstraints[0], { startTime: '23:00', endTime: '01:00' });
    const canonical = graph(input); const checkpoint = params(canonical);
    delete checkpoint.planningState.conversationRequestSequence;
    expect(saveWeeklyPlanningStableV5PersistedSession(checkpoint)).toBe(true);
    expect(reservations(load()!.graph).reservations).toEqual([expect.objectContaining({
      start: { date: '2026-08-26', time: '23:00' }, end: { date: '2026-08-27', time: '01:00' },
    })]);
  });

});
