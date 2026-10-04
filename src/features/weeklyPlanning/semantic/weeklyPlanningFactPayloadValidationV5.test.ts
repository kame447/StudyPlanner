import { createGraphCheckpointAssertions } from '../testUtils/__tests__/weeklyPlanningGraphCheckpointAssertions';
import { createWeeklyPlanningTurnRequestContext, resolveWeeklyPlanningPlanningHorizon } from '../application/weeklyPlanningTemporalContext';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from './weeklyPlanningActiveSchedulerGraphViewV5';
import { resolveWeeklyPlanningTemporalConstraintsV5 } from './weeklyPlanningResolvedTemporalConstraintsV5';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyWeeklyPlanningFactGraphV5 } from './weeklyPlanningFactGraphV5';
import { canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5 } from './weeklyPlanningSemanticCanonicalizerLifecycleV5';
import { validateWeeklyPlanningSemanticValueV5 } from './weeklyPlanningSemanticValidatorV5';
import { validateWeeklyPlanningFactGraphValueV5 } from './weeklyPlanningFactGraphValidatorV5';
import { SEMANTIC_COMPONENT_ROLES_V5, SEMANTIC_STUDY_PURPOSES_V5, SEMANTIC_TASK_CATEGORIES_V5, WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from './weeklyPlanningSemanticTypesV5';
import { createWeeklyPlanningAvailabilityResolverGraphV5 } from './weeklyPlanningSchedulerAvailabilityProjectionV5';
import { stableV5MissingSchedulableWorkQuestion } from '../application/weeklyPlanningStableV5RuntimeQuestions';

const OWNER = 'payload-owner';
const WEEK = '2026-08-24';
const CONVERSATION = 'payload-conversation';
function document(): WeeklyPlanningSemanticDocumentV5 {
  return { schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'discuss',
    planningWindow: { localId: 'window', kind: 'relative_week', value: 'this_week', start: null, end: null, sourceText: '今週' },
    tasks: [{ localId: 'task', category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: null,
      components: [{ localId: 'component', parentLocalId: null, role: 'subject', label: '代数', workloads: [], sourceText: '代数' }] },
      workloads: [], effortEstimates: [], recurrence: [], temporalConstraints: [], sourceText: '数学を学ぶ' }],
    availabilityDeclarations: [{ localId: 'availability', kind: 'unavailable', dateExpression: '2026-08-26',
      namedTimePeriod: null, startTime: '18:00', endTime: '19:00', recurrenceKind: null, days: [], constraintLevel: 'hard', sourceText: '18時から19時は不可' }],
    relations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [] };
}
function canonical(input = document()) {
  expect(validateWeeklyPlanningSemanticValueV5(input).errors).toEqual([]);
  const result = canonicalizeWeeklyPlanningSemanticDocumentWithLifecycleV5({ graph: createEmptyWeeklyPlanningFactGraphV5(), document: input,
    context: { conversationId: CONVERSATION, turnId: 'turn', expectedRevision: 0 } });
  if (result.status !== 'applied') throw new Error(result.errors.join(','));
  return result.graph;
}
let checkpoint: ReturnType<typeof createGraphCheckpointAssertions>;
beforeEach(() => { checkpoint = createGraphCheckpointAssertions({ ownerId: OWNER, weekStartDate: WEEK, conversationId: CONVERSATION }); });
afterEach(() => checkpoint.restore());
type Bucket = 'tasks' | 'components' | 'studyContexts' | 'planningWindows' | 'availabilityDeclarations';
function providerPayload(input: WeeklyPlanningSemanticDocumentV5, bucket: Bucket): object {
  if (bucket === 'tasks') return input.tasks[0];
  if (bucket === 'components') return input.tasks[0].study!.components[0];
  if (bucket === 'studyContexts') return input.tasks[0].study!;
  if (bucket === 'planningWindows') return input.planningWindow!;
  return input.availabilityDeclarations[0];
}
const malformed: Array<[Bucket, Record<string, unknown>]> = [
  ...['title', 'category'].flatMap(field => [undefined, null, 42, '', '  '].map(value => ['tasks', { [field]: value }] as [Bucket, Record<string, unknown>])),
  ...['label', 'role'].flatMap(field => [undefined, null, 42, '', '  '].map(value => ['components', { [field]: value }] as [Bucket, Record<string, unknown>])),
  ['studyContexts', { purpose: 'unsupported' }], ['studyContexts', { purpose: undefined }],
  ['studyContexts', { contextLabel: 42 }], ['studyContexts', { contextLabel: undefined }],
  ['planningWindows', { kind: 'other' }], ['planningWindows', { value: null }], ['planningWindows', { value: 42 }],
  ['planningWindows', { value: '' }], ['planningWindows', { start: undefined }], ['planningWindows', { end: 42 }],
  ['planningWindows', { start: '2026-08-24' }], ['planningWindows', { kind: 'absolute' }],
  ['availabilityDeclarations', { days: null }], ['availabilityDeclarations', { days: undefined }],
  ['availabilityDeclarations', { days: [42] }], ['availabilityDeclarations', { days: [''] }],
  ['availabilityDeclarations', { days: ['mon'] }], ['availabilityDeclarations', { recurrenceKind: 'other' }],
  ['availabilityDeclarations', { kind: 'other' }], ['availabilityDeclarations', { constraintLevel: 'soft' }],
  ['availabilityDeclarations', { kind: 'preferred' }], ['availabilityDeclarations', { constraintLevel: 'other' }],
  ['availabilityDeclarations', { startTime: '25:99' }], ['availabilityDeclarations', { endTime: undefined }],
  ['availabilityDeclarations', { namedTimePeriod: 'night' }], ['availabilityDeclarations', { dateExpression: '2026-02-30' }],
  ['availabilityDeclarations', { dateExpression: null, startTime: null, endTime: null }],
  ['availabilityDeclarations', { capacityMinutes: 30 }],
  ['availabilityDeclarations', { namedTimePeriod: 'not-a-period', startTime: null, endTime: null }],
];
describe('existing payload contracts at every persisted graph gate', () => {
  it.each(malformed)('rejects %s corruption %j without exposing it to recovery consumers', (bucket, change) => {
    const input = document(); const graph = canonical(input);
    checkpoint.roundTrip(graph);
    Object.assign(providerPayload(input, bucket), change);
    Object.assign(graph[bucket][0], change);
    const validation = validateWeeklyPlanningSemanticValueV5(input);
    expect(validation.document).toBeNull();
    if (bucket === 'availabilityDeclarations') {
      const suffix = change.startTime === '25:99' ? '.startTime:clock-format'
        : change.dateExpression === '2026-02-30' ? '.dateExpression:canonical-expression'
        : change.namedTimePeriod === 'not-a-period' ? '.namedTimePeriod' : null;
      if (suffix) expect(validation.errors).toContain(`document.availabilityDeclarations[0]${suffix}`);
    }
    checkpoint.reject(graph);
  });
  it.each(SEMANTIC_TASK_CATEGORIES_V5)('round trips category %s', category => {
    const input = document(); input.tasks[0].category = category;
    if (category === 'non_study') input.tasks[0].study = null;
    checkpoint.roundTrip(canonical(input));
  });
  it.each(SEMANTIC_COMPONENT_ROLES_V5)('round trips component role %s', role => {
    const input = document(); input.tasks[0].study!.components[0].role = role; checkpoint.roundTrip(canonical(input));
  });
  it.each(SEMANTIC_STUDY_PURPOSES_V5)('round trips study purpose %s', purpose => {
    const input = document(); input.tasks[0].study!.purpose = purpose; checkpoint.roundTrip(canonical(input));
  });
  it.each([null, '', '  ', 'exam'])('preserves contextLabel %j', contextLabel => {
    const input = document(); input.tasks[0].study!.contextLabel = contextLabel; checkpoint.roundTrip(canonical(input));
  });
  it('restores valid task and availability values for the real consumers', () => {
    checkpoint.roundTrip(canonical());
    expect(stableV5MissingSchedulableWorkQuestion(checkpoint.load()!.graph).taskTitles).toEqual(['数学']);
    expect(() => createWeeklyPlanningAvailabilityResolverGraphV5(checkpoint.load()!.graph)).not.toThrow();
  });
});

function availabilityInput(change: Record<string, unknown>) {
  const input = document(); Object.assign(input.availabilityDeclarations[0], change); return input;
}
const capacity = { kind: 'capacity', startTime: null, endTime: null, capacityMinutes: 90 };
const absence = { kind: 'no_additional_constraint', dateExpression: null, startTime: null, endTime: null };
it.each([
  {}, { capacityMinutes: null }, { startTime: '', endTime: '' },
  { startTime: '23:00', endTime: '01:00' }, { startTime: '18:00', endTime: '18:00' },
  { dateExpression: 'custom:after exam' }, { recurrenceKind: 'weekly', days: ['mon', 'wed'] },
  { recurrenceKind: 'custom', days: ['custom weekday'] },
  { namedTimePeriod: 'night', startTime: null, endTime: null },
  { namedTimePeriod: 'custom:after lunch', startTime: null, endTime: null },
  { kind: 'preferred', constraintLevel: 'soft' }, { kind: 'avoided', constraintLevel: 'unknown' },
  { kind: 'available' }, { constraintLevel: 'unknown' }, capacity, { ...capacity, capacityMinutes: 0.5 },
  { ...capacity, capacityMinutes: 1440 }, { ...capacity, dateExpression: null, recurrenceKind: 'daily' },
  absence, { ...absence, capacityMinutes: null }, { ...absence, dateExpression: 'custom:after exam' },
])('preserves canonical availability representation %j', change => {
  const graph = canonical(availabilityInput(change)); checkpoint.roundTrip(graph);
  expect(() => createWeeklyPlanningAvailabilityResolverGraphV5(checkpoint.load()!.graph)).not.toThrow();
});
it.each([
  ...[null, undefined, 0, -1, Infinity, NaN, 1441, '90'].map(capacityMinutes => ({ ...capacity, capacityMinutes })),
  { ...capacity, constraintLevel: 'soft' }, { ...capacity, startTime: '18:00' },
  { ...capacity, dateExpression: null },
  { ...absence, days: null }, { ...absence, days: ['mon'] }, { ...absence, startTime: '18:00' },
  { ...absence, namedTimePeriod: 'night' }, { ...absence, recurrenceKind: 'daily' },
  { ...absence, constraintLevel: 'unknown' }, { ...absence, capacityMinutes: 30 },
  { ...absence, dateExpression: 42 },
])('rejects malformed availability extension %j', change => {
  const graph = canonical(); Object.assign(graph.availabilityDeclarations[0], change);
  expect(validateWeeklyPlanningSemanticValueV5(availabilityInput(change)).document).toBeNull();
  expect(validateWeeklyPlanningFactGraphValueV5(graph).graph).toBeNull();
  expect(checkpoint.save(graph)).toBe(false);
});
it.each([{}, absence])('allows legacy omitted capacityMinutes in stored facts %j', change => {
  const graph = canonical(availabilityInput(change)); delete graph.availabilityDeclarations[0].capacityMinutes; checkpoint.roundTrip(graph);
});
it.each([
  { kind: 'relative_week', value: 'this_week', start: null, end: null },
  { kind: 'relative_day', value: 'today', start: null, end: null },
  { kind: 'named_period', value: 'custom:summer holiday', start: null, end: null },
  { kind: 'absolute', value: '2026-08-24/2026-08-30', start: '2026-08-24', end: '2026-08-30' },
])('round trips planning window %j', change => {
  const input = document(); Object.assign(input.planningWindow!, change); checkpoint.roundTrip(canonical(input));
});
it('keeps the saved absolute-window legacy label contract', () => {
  const input = document(); Object.assign(input.planningWindow!, { kind: 'absolute', value: '2026-08-24/2026-08-30', start: '2026-08-24', end: '2026-08-30' });
  const graph = canonical(input); graph.planningWindows[0].value = '今週の予定'; checkpoint.roundTrip(graph);
});
it('does not require provider nesting or extensions in a saved task-only graph', () => {
  const input = document(); input.tasks[0].study!.components = [];
  const graph = canonical(input); const removedIds = new Set(graph.studyContexts.map(fact => fact.id));
  graph.studyContexts = []; graph.factLifecycles = graph.factLifecycles.filter(entry => !removedIds.has(entry.factId));
  checkpoint.roundTrip(graph); expect(graph.tasks[0]).not.toHaveProperty('decompositionStatus');
});
it('checks the saved availability resolution marker', () => {
  const graph = canonical(); Object.assign(graph.availabilityDeclarations[0], { resolutionStatus: 'resolved' });
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.availabilityDeclarations[0].resolutionStatus');
});

it.each([false, true])('restores a resolvable planning horizon (legacy absolute=%s)', absolute => {
  const input = document();
  if (absolute) Object.assign(input.planningWindow!, { kind: 'absolute', value: '2026-08-24/2026-08-30', start: '2026-08-24', end: '2026-08-30' });
  const graph = canonical(input);
  if (absolute) graph.planningWindows[0].value = '今週の予定';
  checkpoint.roundTrip(graph);
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(checkpoint.load()!.graph);
  const requestContext = createWeeklyPlanningTurnRequestContext({ startedAtIso: '2026-08-24T00:00:00Z', timeZone: 'Asia/Tokyo', weekStartsOn: 'monday' });
  expect(resolveWeeklyPlanningPlanningHorizon({ graph: active, selectedDate: WEEK, requestContext,
    resolvedTemporalConstraints: resolveWeeklyPlanningTemporalConstraintsV5({ graph: active, currentDate: requestContext.currentDate, weekStartsOn: 'monday' }),
  })).toEqual({ startDate: '2026-08-24', endDate: '2026-08-30' });
});
it.each(['removed', 'superseded'] as const)('still validates malformed historical %s facts', status => {
  const graph = canonical(); graph.revision = 2;
  const old = graph.availabilityDeclarations[0];
  const replacement = { ...structuredClone(old), id: old.id + ':replacement', createdRevision: 2 };
  if (status === 'superseded') {
    graph.availabilityDeclarations.push(replacement);
    graph.factLifecycles.push({ factId: replacement.id, status: 'active', createdRevision: 2, terminalRevision: null, supersededByFactId: null });
  }
  Object.assign(graph.factLifecycles.find(entry => entry.factId === old.id)!, {
    status, terminalRevision: 2, supersededByFactId: status === 'superseded' ? replacement.id : null,
  });
  checkpoint.roundTrip(graph);
  Object.assign(old, { days: null });
  expect(validateWeeklyPlanningFactGraphValueV5(graph).errors).toContain('graph.availabilityDeclarations[0].days');
});
