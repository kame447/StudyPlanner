import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5, validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { createMemoryStorageHarness, installWeeklyPlanningTestStorage } from '../testUtils/weeklyPlanningApplicationTestHarness';
import { createInitialPlanningState } from '../weeklyPlanningReducer';
import { getWeeklyPlanningStableV5SessionStorageKeyForTest, loadWeeklyPlanningStableV5PersistedSession, saveWeeklyPlanningStableV5PersistedSession } from '../application/weeklyPlanningStableV5SessionStorage';
import { resolveWeeklyPlanningDateExpressionsV5 } from './weeklyPlanningResolvedDateExpressionsV5';
import { resolveWeeklyPlanningTaskCommitments } from './weeklyPlanningTaskCommitmentResolver';
import { applyWeeklyPlanningFactLifecycleOperationV5 } from './weeklyPlanningFactLifecycleEngineV5';

const OWNER = 'calendar-owner'; const WEEK = '2026-08-24'; const CONVERSATION = 'calendar-conversation';
function document(dateRule = false): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss', planningWindow: null,
    tasks: [{ localId: 'task', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [], effortEstimates: [], recurrence: [], sourceText: '8月26日の数学',
      temporalConstraints: [{ localId: 'constraint', targetLocalId: 'task', kind: dateRule ? 'allowed_date' : 'fixed_interval',
        constraintLevel: 'hard', dateExpression: '2026-08-26', namedTimePeriod: null,
        startTime: dateRule ? null : '18:00', endTime: dateRule ? null : '19:00', precision: 'exact', sourceText: '8月26日18時から19時' }] }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] };
}
function canonical(input = document()) {
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: input,
    context: { conversationId: CONVERSATION, turnId: 'turn', expectedRevision: 0 } });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}
const parameters = (graph: ReturnType<typeof canonical>) => ({ ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION,
  graph, planningState: createInitialPlanningState(WEEK) });
const load = () => loadWeeklyPlanningStableV5PersistedSession({ ownerId: OWNER, weekStartDate: WEEK });
function resolve(graph: ReturnType<typeof canonical>) {
  return resolveWeeklyPlanningTaskCommitments({ graph,
    context: { currentDate: '2026-08-26', planningStartDate: WEEK, planningEndDate: '2026-08-30', timeZone: 'Asia/Tokyo' },
    resolvedDateExpressions: resolveWeeklyPlanningDateExpressionsV5({ graph, currentDate: '2026-08-26' }) });
}
let storage: ReturnType<typeof createMemoryStorageHarness>; let restore: () => void;
beforeEach(() => { storage = createMemoryStorageHarness(); restore = installWeeklyPlanningTestStorage(storage.storage); });
afterEach(() => restore());
const malformed: Array<[Record<string, unknown>, string]> = [
  [{ kind: 'during' }, '.kind'], [{ kind: undefined }, '.kind'],
  [{ constraintLevel: 'strong' }, '.constraintLevel'], [{ constraintLevel: undefined }, '.constraintLevel'],
  [{ dateExpression: '2026-02-30' }, '.dateExpression:canonical-expression'],
  [{ dateExpression: '2026-08-30/2026-08-24' }, '.dateExpression:canonical-expression'],
  [{ dateExpression: undefined }, '.dateExpression'], [{ dateExpression: 26 }, '.dateExpression'],
  [{ namedTimePeriod: 'not-a-period' }, '.namedTimePeriod'], [{ namedTimePeriod: undefined }, '.namedTimePeriod'],
  [{ startTime: '25:99' }, '.startTime:clock-format'], [{ startTime: undefined }, '.startTime'],
  [{ endTime: '24:00' }, '.endTime:clock-format'], [{ endTime: 19 }, '.endTime'],
  [{ precision: 'certain' }, '.precision'], [{ precision: undefined }, '.precision'],
  [{ namedTimePeriod: 'night' }, '.namedTimePeriod:cannot-combine-with-clock'],
  [{ kind: 'earliest_start', dateExpression: null, startTime: null }, ':missing-start'],
  [{ kind: 'latest_end', dateExpression: null, endTime: null }, ':missing-end'],
  [{ startTime: null }, ':missing-interval'],
  [{ kind: 'deadline', dateExpression: null, endTime: null }, ':missing-deadline'],
  [{ kind: 'preferred_window' }, '.constraintLevel:preferred-window-cannot-be-hard'],
  [{ constraintLevel: 'soft' }, '.constraintLevel:soft-fixed-interval-use-preferred-window'],
];
describe('temporal value parity without changing scheduling policy', () => {
  it.each(malformed)('rejects malformed temporal %j at %s', (change, suffix) => {
    const input = document(); const graph = canonical(input);
    Object.assign(input.tasks[0].temporalConstraints[0], change); Object.assign(graph.temporalConstraints[0], change);
    expect(validateWeeklyPlanningSemanticValueV5(input).errors).toContain(`document.tasks[0].temporalConstraints[0]${suffix}`);
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain(`graph.temporalConstraints[0]${suffix}`);
    expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).graph).toBeNull();
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(false);
    expect(storage.values.size).toBe(0);
  });
  it.each([
    { startTime: '23:00', endTime: '01:00' },
    { startTime: '18:00', endTime: '18:00' },
    { kind: 'deadline', startTime: '', endTime: '' },
    { kind: 'earliest_start', startTime: null, endTime: null },
    { kind: 'latest_end', dateExpression: 'custom:after exam', startTime: null, endTime: null },
    { kind: 'preferred_window', constraintLevel: 'soft', dateExpression: null, namedTimePeriod: 'night', startTime: null, endTime: null },
    { kind: 'avoid_window', constraintLevel: 'unknown', dateExpression: null, namedTimePeriod: 'custom:after lunch', startTime: null, endTime: null },
    { constraintLevel: 'unknown', precision: 'approximate' },
    { precision: 'unspecified' },
  ])('preserves existing accepted representation %j', (change) => {
    const input = document(); Object.assign(input.tasks[0].temporalConstraints[0], change); const graph = canonical(input);
    expect(parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph)).graph).toEqual(graph);
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(true); expect(load()?.graph).toEqual(graph);
  });
  it('keeps downstream malformed-clock defense and valid overnight resolution distinct', () => {
    const graph = canonical(); const malformedGraph = structuredClone(graph); malformedGraph.temporalConstraints[0].startTime = '25:99';
    const blocked = resolve(malformedGraph); expect(blocked.readiness).toBe('needs_resolution'); expect(blocked.reservations).toEqual([]);
    expect(blocked.issues).toContainEqual(expect.objectContaining({ code: 'invalid_commitment_interval', blocking: true }));
    Object.assign(graph.temporalConstraints[0], { startTime: '23:00', endTime: '01:00' });
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(true);
    expect(resolve(load()!.graph).reservations).toEqual([expect.objectContaining({
      start: { date: '2026-08-26', time: '23:00' }, end: { date: '2026-08-27', time: '01:00' },
    })]);
  });
  it.each([false, true])('rejects corrupted checkpoint recovery (date rule=%s)', (dateRule) => {
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(canonical(document(dateRule))))).toBe(true);
    const key = getWeeklyPlanningStableV5SessionStorageKeyForTest(OWNER, WEEK);
    const raw = JSON.parse(storage.storage.getItem(key)!);
    if (dateRule) raw.graph.taskDateRules[0].dateExpression = null; else raw.graph.temporalConstraints[0].startTime = '25:99';
    storage.storage.setItem(key, JSON.stringify(raw)); expect(load()).toBeNull();
  });
});
describe('reduced saved date rules', () => {
  it.each([
    [{ kind: 'invalid' }, '.kind'], [{ constraintLevel: 'soft' }, '.constraintLevel:date-rule-must-be-hard'],
    [{ constraintLevel: undefined }, '.constraintLevel'], [{ dateExpression: null }, '.dateExpression:canonical-expression-required'],
    [{ dateExpression: '' }, '.dateExpression:canonical-expression-required'], [{ dateExpression: 26 }, '.dateExpression'],
    [{ dateExpression: '2026-02-30' }, '.dateExpression:canonical-expression-required'],
  ] as Array<[Record<string, unknown>, string]>)('rejects malformed date rule %j', (change, suffix) => {
    const input = document(true); const graph = canonical(input);
    Object.assign(input.tasks[0].temporalConstraints[0], change); Object.assign(graph.taskDateRules[0], change);
    expect(validateWeeklyPlanningSemanticValueV5(input).errors).toContain(`document.tasks[0].temporalConstraints[0]${suffix}`);
    expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain(`graph.taskDateRules[0]${suffix}`);
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(false);
  });
  it.each(['allowed_date', 'excluded_date'] as const)('preserves reduced %s rules including removed historical facts', (kind) => {
    const input = document(true); input.tasks[0].temporalConstraints[0].kind = kind; const graph = canonical(input);
    const fact = graph.taskDateRules[0]; expect(fact).not.toHaveProperty('startTime'); expect(fact).not.toHaveProperty('namedTimePeriod'); expect(fact).not.toHaveProperty('precision');
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(true); expect(load()?.graph).toEqual(graph);
    const removed = applyWeeklyPlanningFactLifecycleOperationV5({ graph, expectedRevision: graph.revision,
      operation: { operationKey: 'remove-rule', kind: 'remove', targetFactId: fact.id } });
    expect(removed.status).toBe('applied');
    if (removed.status !== 'applied') throw new Error('Removal failed');
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(removed.graph))).toBe(true);
    expect(load()?.graph).toEqual(removed.graph);
  });
});

describe('provider-only wire fields and shared availability primitives', () => {
  it.each([
    [{ precision: 'certain' }, '.precision'], [{ precision: undefined }, '.precision'],
    [{ namedTimePeriod: 'night' }, '.namedTimePeriod:must-be-null-for-date-rule'],
    [{ startTime: '18:00' }, ':date-rule-cannot-have-clock'],
    [{ endTime: '19:00' }, ':date-rule-cannot-have-clock'], [{ startTime: undefined }, '.startTime'],
  ] as Array<[Record<string, unknown>, string]>)('still rejects invalid date-rule wire fields %j', (change, suffix) => {
    const input = document(true); Object.assign(input.tasks[0].temporalConstraints[0], change);
    expect(validateWeeklyPlanningSemanticValueV5(input).errors).toContain(`document.tasks[0].temporalConstraints[0]${suffix}`);
  });
  it.each(['exact', 'approximate', 'unspecified'] as const)('accepts wire precision %s without requiring it on saved date rules', (precision) => {
    const input = document(true); input.tasks[0].temporalConstraints[0].precision = precision;
    const graph = canonical(input); expect(graph.taskDateRules[0]).not.toHaveProperty('precision');
    expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(true);
  });
  function availabilityInput(change: Record<string, unknown>) {
    const input = document(); input.availabilityDeclarations = [{ localId: 'availability', kind: 'unavailable',
      dateExpression: '2026-08-26', namedTimePeriod: null, startTime: '18:00', endTime: '19:00',
      recurrenceKind: null, days: [], constraintLevel: 'hard', sourceText: 'この時間は予定あり' }];
    Object.assign(input.availabilityDeclarations[0], change); return input;
  }
  it.each([
    [{ startTime: '25:99' }, '.startTime:clock-format'], [{ dateExpression: '2026-02-30' }, '.dateExpression:canonical-expression'],
    [{ namedTimePeriod: 'not-a-period', startTime: null, endTime: null }, '.namedTimePeriod'],
  ] as Array<[Record<string, unknown>, string]>)('retains availability rejection %j', (change, suffix) => {
    expect(validateWeeklyPlanningSemanticValueV5(availabilityInput(change)).errors).toContain(`document.availabilityDeclarations[0]${suffix}`);
  });
  it.each([
    { startTime: '', endTime: '' },
    { dateExpression: 'custom:after exam' },
    { namedTimePeriod: 'custom:after lunch', startTime: null, endTime: null },
  ])('retains valid availability scalar representation %j', (change) => {
    expect(validateWeeklyPlanningSemanticValueV5(availabilityInput(change)).errors).toEqual([]);
  });
});

it.each(['custom:after exam', '2026-08-24/2026-08-30'])('round trips a reduced date rule with %s', (dateExpression) => {
  const input = document(true); input.tasks[0].temporalConstraints[0].dateExpression = dateExpression;
  const graph = canonical(input); expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(true);
  expect(load()?.graph.taskDateRules[0].dateExpression).toBe(dateExpression);
});
it.each([false, true])('does not accept the other fact category in a saved array (date rule=%s)', (dateRule) => {
  const graph = canonical(document(dateRule));
  const fact = dateRule ? graph.taskDateRules[0] : graph.temporalConstraints[0];
  Object.assign(fact, { kind: dateRule ? 'fixed_interval' : 'allowed_date' });
  const path = dateRule ? 'graph.taskDateRules[0].kind' : 'graph.temporalConstraints[0].kind';
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain(path);
  expect(saveWeeklyPlanningStableV5PersistedSession(parameters(graph))).toBe(false);
});
