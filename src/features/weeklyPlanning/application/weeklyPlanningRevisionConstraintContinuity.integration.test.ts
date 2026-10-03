import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan, ScheduleTemplate, TimetableTerm } from '../../../types/domain';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { WeeklyPlanningStableV5CandidateMetadata } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, type WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import type { WeeklyPlanningSemanticNormalizerResultV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import type { scheduleWeeklyPlanningStableV5Preview } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import { resetWeeklyPlanningStableV5DebugTraceForTest } from '../trace/weeklyPlanningStableV5DebugTrace';
import { finalizeWeeklyPlanningStableV5RuntimeGraph, getWeeklyPlanningStableV5StagedGraph, resetWeeklyPlanningStableV5RuntimeSessionsForTest } from './weeklyPlanningStableV5RuntimeSession';

const { normalizeMock, placements } = vi.hoisted(() => ({
  normalizeMock: vi.fn(), placements: [] as Parameters<typeof scheduleWeeklyPlanningStableV5Preview>[0][],
}));
vi.mock('../../../lib/aiConfig', () => ({ getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid', model: 'test', apiKey: 'test' }), getAiConfigValidationMessage: () => undefined }));
vi.mock('../../../services/ai/openAiCompatibleClient', () => ({ createOpenAiCompatibleClient: () => ({ createChatCompletion: vi.fn() }) }));
vi.mock('../semantic/weeklyPlanningSemanticNormalizerV5', () => ({ createWeeklyPlanningSemanticNormalizerV5: () => ({ normalize: normalizeMock }) }));
vi.mock('../semantic/weeklyPlanningStableV5PreviewScheduler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../semantic/weeklyPlanningStableV5PreviewScheduler')>();
  return { ...actual, scheduleWeeklyPlanningStableV5Preview: (input: Parameters<typeof actual.scheduleWeeklyPlanningStableV5Preview>[0]) => {
    placements.push(structuredClone(input));
    return actual.scheduleWeeklyPlanningStableV5Preview(input);
  } };
});
import { executeWeeklyPlanningStableV5RuntimeTurn } from './weeklyPlanningStableV5RuntimeExecutor';

const DATE = '2026-07-27';
const OWNER = 'revision-constraint-owner';
const CREATED = `${DATE}T00:00:00.000Z`;
const plan: Plan = { id: 'existing-plan', seriesId: 'existing-plan', userId: OWNER, title: '既存予定', subject: '', date: DATE, startTime: '09:00', endTime: '11:00', repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [], type: 'other', memo: '', createdAt: CREATED, updatedAt: CREATED };
const term: TimetableTerm = { id: 'active-term', userId: OWNER, year: 2026, kind: 'custom', label: '対象期間', startDate: DATE, endDate: '2026-08-02', usesAlternatingWeeks: false, alternatingWeekAnchorDate: DATE, isActive: true, createdAt: CREATED, updatedAt: CREATED };
const timetable: ScheduleTemplate = { id: 'monday-class', userId: OWNER, title: '授業', subject: '授業', type: 'school-event', weekday: 'mon', startTime: '11:30', endTime: '13:30', termId: term.id, periodNumber: 1, classroom: '', memo: '', active: true, createdAt: CREATED, updatedAt: CREATED };
const firstText = '7月27日に数学を60分。既存予定と時間割を使って、14時から16時は使わないで計画を作って';
const secondText = '数学は60分ではなく90分に変更。数学を90分';

function doc(amount: number): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5, planningIntent: 'create_plan',
    planningWindow: { localId: 'window', kind: 'absolute', value: DATE, start: DATE, end: DATE, sourceText: '7月27日' },
    tasks: [{ localId: `task-${amount}`, category: 'study', title: '数学', study: { purpose: 'self_study', contextLabel: null, components: [] },
      workloads: [{ localId: `workload-${amount}`, quantityRole: 'target', amount, unitCode: 'minute', unitLabel: '分', rangeStart: null, rangeEnd: null, perOccurrence: false, periodExpression: null, sourceText: `数学を${amount}分` }],
      effortEstimates: [], temporalConstraints: [], recurrence: [], sourceText: `数学を${amount}分` }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [], uncertainties: [], corrections: [], decisions: [],
  };
}
function accepted(document: WeeklyPlanningSemanticDocumentV5): WeeklyPlanningSemanticNormalizerResultV5 {
  return { status: 'accepted', document, diagnostics: { schemaVersion: 'weekly-planning-semantic-v5', jsonSchemaName: 'weekly_planning_semantic_document_v5', normalizerVersion: 'weekly-planning-semantic-normalizer-v5', attemptCount: 1, repairAttempted: false, requestBytes: [100], responseLengths: [100], latencyMs: 1, validationErrors: [], providerError: null } };
}
function minutes(time: string) { const [h, m] = time.split(':').map(Number); return h * 60 + m; }
function metadata(candidate: WeeklyDraftCandidate) {
  return (candidate as WeeklyDraftCandidate & { stableV5Metadata: WeeklyPlanningStableV5CandidateMetadata }).stableV5Metadata;
}

beforeEach(() => { normalizeMock.mockReset(); placements.length = 0; resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); });
afterEach(() => { resetWeeklyPlanningStableV5RuntimeSessionsForTest(); resetWeeklyPlanningStableV5DebugTraceForTest(); });

type Omission = 'none' | 'plan' | 'timetable' | 'buffer';
async function revise(omit: Omission = 'none') {
  const conversationId = `revision-constraints-${omit}`;
  const firstDoc = doc(60);
  firstDoc.constraintSourceRequests = [
    { localId: 'plans-source', kind: 'existing_plans', selector: 'active', requestedAction: 'use', sourceText: '既存予定' },
    { localId: 'timetable-source', kind: 'timetable', selector: 'active', requestedAction: 'use', sourceText: '時間割' },
  ];
  if (omit !== 'buffer') firstDoc.availabilityDeclarations = [{ localId: 'hard-buffer', kind: 'unavailable', dateExpression: DATE, namedTimePeriod: null, startTime: '14:00', endTime: '16:00', recurrenceKind: null, days: [], constraintLevel: 'hard', capacityMinutes: null, sourceText: '14時から16時は使わない' }];
  const common = {
    messages: [], selectedDate: DATE, userId: OWNER, conversationId,
    plans: omit === 'plan' ? [] : [structuredClone(plan)],
    scheduleTemplates: omit === 'timetable' ? [] : [structuredClone(timetable)],
    timetableTermId: term.id, timetableTerm: structuredClone(term), timetableTerms: [structuredClone(term)],
    requestContext: { startedAtIso: `${DATE}T00:00:00.000Z`, timeZone: 'Asia/Tokyo', currentDate: DATE, currentTime: '09:00', notBeforeDate: DATE, notBeforeTime: '09:00', weekStartsOn: 'monday' as const },
  };
  const originalInputs = structuredClone(common);
  normalizeMock.mockResolvedValueOnce(accepted(firstDoc));
  const first = await executeWeeklyPlanningStableV5RuntimeTurn({ ...common, previousState: undefined, traceRequestId: 'first', userText: firstText });
  expect(first.state.status).toBe('draft_ready');
  expect(first.draftCandidates.reduce((sum, c) => sum + c.durationMinutes, 0)).toBe(60);
  const firstGraph = getWeeklyPlanningStableV5StagedGraph({ ownerId: OWNER, conversationId, requestId: 'first' });
  expect(firstGraph).not.toBeNull();
  const originalGraph = structuredClone(firstGraph!);
  const originalResult = structuredClone(first);
  finalizeWeeklyPlanningStableV5RuntimeGraph({ ownerId: OWNER, conversationId, requestId: 'first' });
  const oldWorkload = firstGraph!.workloads[0];
  const correction = doc(90);
  correction.planningIntent = 'update_plan'; correction.planningWindow = null;
  correction.corrections = [{ localId: 'replace-workload', target: { kind: 'workload', publicId: oldWorkload.id, localId: null, mention: '数学60分' }, operation: 'replace', replacementLocalId: 'workload-90', sourceText: '数学は60分ではなく90分' }];
  // Constraints are deliberately omitted from the revision document, not reasserted by the provider.
  normalizeMock.mockResolvedValueOnce(accepted(correction));
  const placementStart = placements.length;
  const second = await executeWeeklyPlanningStableV5RuntimeTurn({ ...common, previousState: first.state, traceRequestId: 'second', userText: secondText });
  expect(second.state.status).toBe('draft_ready');
  expect(second.draftCandidates.reduce((sum, c) => sum + c.durationMinutes, 0)).toBe(90);
  const graph = getWeeklyPlanningStableV5StagedGraph({ ownerId: OWNER, conversationId, requestId: 'second' });
  expect(graph).not.toBeNull();
  expect(graph!.revision).toBeGreaterThan(firstGraph!.revision);
  expect(graph!.availabilityDeclarations).toEqual(originalGraph.availabilityDeclarations);
  expect(graph!.constraintSourceRequests).toEqual(originalGraph.constraintSourceRequests);
  const active = new Set(graph!.factLifecycles.filter((f) => f.status === 'active').map((f) => f.factId));
  expect(graph!.tasks.filter((f) => active.has(f.id)).map((f) => f.id)).toEqual([oldWorkload.taskId]);
  const workloads = graph!.workloads.filter((f) => active.has(f.id));
  expect(workloads).toHaveLength(1);
  expect(workloads[0]).toMatchObject({ amount: 90, taskId: oldWorkload.taskId });
  expect(graph!.factLifecycles.find((f) => f.factId === oldWorkload.id)).toMatchObject({ status: 'superseded', supersededByFactId: workloads[0].id });
  for (const f of [...originalGraph.availabilityDeclarations, ...originalGraph.constraintSourceRequests]) expect(active.has(f.id)).toBe(true);
  expect(placements.length).toBeGreaterThan(placementStart);
  const placement = placements[placements.length - 1];
  expect(placement.input.graphRevision).toBe(graph!.revision);
  for (const c of second.draftCandidates) {
    expect(c.date).toBe(DATE);
    expect(metadata(c)).toMatchObject({ graphRevision: graph!.revision, taskId: oldWorkload.taskId });
    expect(metadata(c).sourceFactRefs).toContain(workloads[0].id);
    expect(metadata(c).sourceFactRefs).not.toContain(oldWorkload.id);
  }
  expect(common).toEqual(originalInputs);
  expect(firstGraph).toEqual(originalGraph);
  expect(first).toEqual(originalResult);
  return { second, graph: graph!, placement };
}

describe('revision retains existing plans, timetable and explicit hard buffer', () => {
  it('recompiles the amended workload without dropping inherited constraints or provenance', async () => {
    const { second, graph, placement } = await revise();
    const windows = placement.input.availabilityWindows;
    for (const window of windows) expect(window).toMatchObject({ ownerId: OWNER, graphRevision: graph.revision });
    expect(windows).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: 'existing_plan', sourceRef: plan.id, constraintLevel: 'hard' }),
      expect.objectContaining({ sourceKind: 'timetable', sourceRef: timetable.id, constraintLevel: 'hard' }),
      expect.objectContaining({ sourceKind: 'user_declaration', sourceRef: graph.availabilityDeclarations[0].id, constraintLevel: 'hard' }),
    ]));
    for (const c of second.draftCandidates) for (const [start, end] of [['08:50', '11:10'], ['11:20', '13:40'], ['14:00', '16:00']]) {
      expect(minutes(c.endTime) <= minutes(start) || minutes(c.startTime) >= minutes(end)).toBe(true);
    }
  });
  it.each(['plan', 'timetable', 'buffer'] as const)('proves the %s constraint is independently consequential', async (omit) => {
    const full = await revise();
    const relaxed = await revise(omit);
    const earliest = (result: typeof full) => Math.min(...result.second.draftCandidates.map((c) => minutes(c.startTime)));
    expect(earliest(relaxed)).toBeLessThan(earliest(full));
  });
});
