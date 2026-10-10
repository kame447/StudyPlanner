import { afterEach, describe, expect, it, vi } from 'vitest';
import { AI_PROXY_CHAT_REQUEST_LIMITS, measureJsonUtf8Bytes } from '../../../../shared/aiProxyContract';
import { createOpenAiCompatibleChatRequestPayload, type OpenAiCompatibleClient } from '../../../services/ai/openAiCompatibleClient';
import type { WeeklyPlanningTurnExecutionResult, WeeklyPlanningTurnFailure } from '../weeklyPlanningTurnExecutionTypes';
import { isWeeklyPlanningStableV5SystemResult, renderWeeklyPlanningStableV5AssistantMessage } from './weeklyPlanningStableV5TurnDialogue';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningActiveSchedulerGraphViewV5 } from '../semantic/weeklyPlanningActiveSchedulerGraphViewV5';
import { createWeeklyPlanningPlacementGraphViewV5 } from '../semantic/weeklyPlanningPlacementGraphViewV5';
import { compileGenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import { scheduleWeeklyPlanningStableV5Preview, type WeeklyPlanningStableV5CandidateMetadata } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import { boundWeeklyPlanningDialogueRendererTraceForTransport, resetWeeklyPlanningDialogueRendererPromptContextsForTest } from '../trace/weeklyPlanningDialogueRendererTrace';

const failure: WeeklyPlanningTurnFailure = {
  code: 'stable_v5_provider_failure',
  userMessage: 'provider failed',
  traceCode: 'provider_failed',
  diagnostics: {
    attemptCount: 1,
    repairAttempted: false,
    validationErrorCategories: [],
    providerErrorCategory: 'provider_error',
  },
};

describe('Stable V5 system result classification', () => {
  it('classifies explicit system response source as system', () => {
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'system' })).toBe(true);
  });

  it('classifies an explicit failure as system even without a response source', () => {
    expect(isWeeklyPlanningStableV5SystemResult({ failure })).toBe(true);
  });

  it('does not classify non-system response sources as system', () => {
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'ai' })).toBe(false);
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'rules' })).toBe(false);
    expect(isWeeklyPlanningStableV5SystemResult({ responseSource: 'deterministic_fallback' })).toBe(false);
  });

  it('requires explicit machine state rather than presentation text', () => {
    expect(isWeeklyPlanningStableV5SystemResult({})).toBe(false);
  });
});

const completion = vi.hoisted(() => vi.fn<OpenAiCompatibleClient['createChatCompletion']>());
vi.mock('../../../lib/aiConfig', () => ({
  getAiConfig: () => ({ provider: 'openai', baseUrl: 'https://example.invalid/v1', model: 'test', apiKey: 'test-key' }),
  getAiConfigValidationMessage: () => undefined,
  usesCloudflareOpenAiProxy: () => false,
}));
vi.mock('../../../services/ai/openAiCompatibleClient', async importOriginal => ({
  ...await importOriginal<typeof import('../../../services/ai/openAiCompatibleClient')>(),
  createOpenAiCompatibleClient: () => ({ createChatCompletion: completion }),
}));


const CONVERSATION = 'weekly-conversation-123e4567-e89b-52d3-a456-426614174000';
const REQUEST = `${CONVERSATION}:request:1`;
const CONTROL = 'この内容で仮予定にする';
const NEUTRAL = `候補の内容を確認して、「${CONTROL}」を選択してください。`;

type Candidate = WeeklyDraftCandidate & { stableV5Metadata: WeeklyPlanningStableV5CandidateMetadata };
type Evidence = {
  status: 'available' | 'unavailable';
  graphRevision?: number;
  phase?: 'generated_preview';
  constraintEvaluation?: 'not_evaluated';
  summary?: { scope: 'all_candidates'; candidateCount: number; totalDurationMinutes: number;
    minDurationMinutes: number; maxDurationMinutes: number; earliestStartTime: string; latestEndTime: string };
  details?: { coverage: 'complete' | 'partial'; omittedCount: number; candidates: Array<{
    candidateKey: string; taskId: string; workItemKey: string; date: string; startTime: string; endTime: string;
    durationMinutes: number; approvalStatus: 'unapproved'; sourceFactRefs: string[];
  }> };
};

function acceptedGraph(sessionMinutes = 30, earliestStart = '20:00') {
  const graph = createEmptyWeeklyPlanningFactGraphV5();
  graph.revision = 1;
  const source = { conversationId: CONVERSATION, turnId: REQUEST, semanticLocalId: 'fixture', sourceText: 'synthetic', origin: 'user' as const };
  graph.planningWindows = [{ id: 'window', kind: 'absolute', value: '2026-08-24/2026-08-30',
    start: '2026-08-24', end: '2026-08-30', source, createdRevision: 1 }];
  graph.tasks = [{ id: 'task', category: 'study', title: '数学', source, createdRevision: 1 }];
  graph.workloads = [{ id: 'workload', taskId: 'task', componentId: null, quantityRole: 'target', amount: 20,
    unitCode: 'problem', unitLabel: '問', rangeStart: null, rangeEnd: null, perOccurrence: false,
    periodExpression: null, source, createdRevision: 1 }];
  graph.effortEstimates = [
    { id: 'pace', taskId: 'task', targetFactId: 'workload', kind: 'duration_per_unit', minutes: 3,
      unitCode: 'problem', precision: 'exact', source, createdRevision: 1 },
    { id: 'session', taskId: 'task', targetFactId: 'task', kind: 'session_duration', minutes: sessionMinutes,
      unitCode: 'session', precision: 'exact', source, createdRevision: 1 },
  ];
  graph.temporalConstraints = [{ id: 'clock', taskId: 'task', targetFactId: 'task', kind: 'earliest_start',
    constraintLevel: 'hard', dateExpression: null, namedTimePeriod: null, startTime: earliestStart, endTime: null,
    precision: 'exact', source, createdRevision: 1 }];
  graph.factLifecycles = ['window', 'task', 'workload', 'pace', 'session', 'clock'].map(factId => ({
    factId, status: 'active' as const, createdRevision: 1, terminalRevision: null, supersededByFactId: null,
  }));
  return graph;
}

function generatedPreview(): WeeklyPlanningTurnExecutionResult {
  // Valid before/after independent clock and cap fixes: the70-minute work fits.
  const graph = acceptedGraph(90, '09:00');
  const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
  const compiled = compileGenericSchedulerInput({ graph: active,
    context: { ownerId: 'owner-1', currentDate: '2026-08-19', planningStartDate: '2026-08-24',
      planningEndDate: '2026-08-30', timeZone: 'Asia/Tokyo' } });
  expect(compiled.status).toBe('ready');
  if (!compiled.input) throw new Error('fixture did not compile');
  const preview = scheduleWeeklyPlanningStableV5Preview({ input: compiled.input,
    graph: createWeeklyPlanningPlacementGraphViewV5(active), plans: [], scheduleTemplates: [] });
  expect(preview.status).toBe('ready');
  return { state: { ...createInitialPlanningIntakeState(), status: 'draft_ready' },
    message: '候補を確認してください。', stableV5Graph: graph, draftCandidates: preview.candidates };
}

function mismatchedPreview(): WeeklyPlanningTurnExecutionResult {
  // Deliberately inconsistent observed data, not a requirement that any scheduler
  // reproduce the old defect. Accepted requests still exist without candidate refs.
  const candidate: Candidate = {
    stableKey: 'synthetic-mismatch', workItemKey: 'synthetic-work', date: '2026-08-24',
    startTime: '09:00', endTime: '10:10', durationMinutes: 70, estimatedMinutes: 70,
    title: '数学', field: '数学', year: 2026, source: 'weekly_exam_prep', approvalStatus: 'unapproved',
    stableV5Metadata: { runtime: 'stable_v5', conversationId: CONVERSATION, graphRevision: 1,
      taskId: 'task', sourceFactRefs: ['task', 'workload', 'pace'], planType: 'study' },
  };
  return { state: { ...createInitialPlanningIntakeState(), status: 'draft_ready' },
    message: '候補を確認してください。', stableV5Graph: acceptedGraph(), draftCandidates: [candidate] };
}

async function renderPreview(result: WeeklyPlanningTurnExecutionResult, text = NEUTRAL, userText = '候補の内容を確認したいです。') {
  completion.mockReset().mockImplementation(async request => {
    const payload = JSON.parse(request.messages[1].content);
    return JSON.stringify({ actionId: payload.actionId, actionKind: payload.applicationDecision.actionKind,
      questionCode: payload.applicationDecision.questionCode, groundingAcknowledgement: null, text });
  });
  const before = structuredClone(result);
  const actual = await renderWeeklyPlanningStableV5AssistantMessage({ result,
    input: { messages: [], userText, selectedDate: '2026-08-19',
      userId: 'owner-1', plans: [], scheduleTemplates: [], conversationId: CONVERSATION, traceRequestId: REQUEST } });
  expect(completion).toHaveBeenCalledTimes(1);
  expect(result).toEqual(before);
  expect(actual.draftCandidates).toEqual(before.draftCandidates);
  const request = completion.mock.calls[0][0];
  const payload = JSON.parse(request.messages[1].content);
  const evidence = payload.applicationDecision.previewEvidence as Evidence | undefined;
  return { actual, payload, evidence, request };
}

afterEach(() => { vi.unstubAllGlobals(); completion.mockReset(); resetWeeklyPlanningDialogueRendererPromptContextsForTest(); });

describe('preview observations reach the existing renderer request', () => {
  // Integration-only: apply this row after C2, E-session and J are combined.
  it('carries the actual cap30/earliest20 two-session result and preserved20 problems into renderer input and trace', async () => {
    const graph = acceptedGraph(30, '20:00');
    const beforeGraph = structuredClone(graph);
    const active = createWeeklyPlanningActiveSchedulerGraphViewV5(graph);
    const compiled = compileGenericSchedulerInput({ graph: active,
      context: { ownerId: 'owner-1', currentDate: '2026-08-19', planningStartDate: '2026-08-24',
        planningEndDate: '2026-08-30', timeZone: 'Asia/Tokyo' } });
    expect(compiled.status).toBe('ready');
    if (!compiled.input) throw new Error('integrated scenario did not compile');
    const items = compiled.input.movableWorkItems;
    expect(items.map(item => item.estimatedMinutes)).toEqual([30, 30]);
    expect(items.map(item => item.quantity.amount)).toEqual([10, 10]);
    expect(items.reduce((sum, item) => sum + item.quantity.amount, 0)).toBe(20);
    expect(items.every(item => item.quantity.unitCode === 'problem'
      && item.sourceFactRefs.includes('session'))).toBe(true);
    const preview = scheduleWeeklyPlanningStableV5Preview({ input: compiled.input,
      graph: createWeeklyPlanningPlacementGraphViewV5(active), plans: [], scheduleTemplates: [] });
    expect(preview.status).toBe('ready');
    expect(preview.unscheduledWorkItemIds).toEqual([]);
    expect(preview.candidates.map(candidate => candidate.durationMinutes)).toEqual([30, 30]);
    expect(preview.candidates.reduce((sum, candidate) => sum + candidate.durationMinutes, 0)).toBe(60);
    expect(preview.candidates.every(candidate => candidate.startTime >= '20:00'
      && candidate.date >= '2026-08-24' && candidate.date <= '2026-08-30')).toBe(true);
    expect(preview.candidates.map(candidate => candidate.workItemKey).sort())
      .toEqual(items.map(item => item.id).sort());
    const result: WeeklyPlanningTurnExecutionResult = {
      state: { ...createInitialPlanningIntakeState(), status: 'draft_ready' },
      message: '候補を確認してください。', stableV5Graph: graph, draftCandidates: preview.candidates,
    };
    const { actual, payload, evidence, request } = await renderPreview(result);
    expect(payload.planningStateSummary.acceptedFacts.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'session', taskId: 'task', kind: 'session_duration', minutes: 30 }),
    ]));
    expect(payload.planningStateSummary.acceptedFacts.temporalConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'clock', taskId: 'task', kind: 'earliest_start', startTime: '20:00' }),
    ]));
    expect(evidence).toMatchObject({ status: 'available', graphRevision: 1, phase: 'generated_preview',
      constraintEvaluation: 'not_evaluated', summary: { scope: 'all_candidates', candidateCount: 2,
        totalDurationMinutes: 60, minDurationMinutes: 30, maxDurationMinutes: 30 },
      details: { coverage: 'complete', omittedCount: 0 } });
    const expectedDetails = preview.candidates.map(candidate => {
      const metadata = (candidate as Candidate).stableV5Metadata;
      expect(metadata.sourceFactRefs).toEqual(expect.arrayContaining(['task', 'workload', 'pace', 'session']));
      return { candidateKey: candidate.stableKey, taskId: 'task', workItemKey: candidate.workItemKey,
        date: candidate.date, startTime: candidate.startTime, endTime: candidate.endTime,
        durationMinutes: 30, approvalStatus: 'unapproved', sourceFactRefs: metadata.sourceFactRefs };
    }).sort((a, b) => a.candidateKey.localeCompare(b.candidateKey));
    expect(evidence!.details!.candidates).toEqual(expectedDetails);
    const trace = boundWeeklyPlanningDialogueRendererTraceForTransport(actual.dialogueRendererTrace!);
    const context = trace.request!.promptContext as { messages: typeof request.messages };
    expect(context.messages).toEqual(request.messages);
    expect(JSON.parse(context.messages[1].content).applicationDecision.previewEvidence).toEqual(evidence);
    expect(actual.responseSource).toBe('ai');
    expect(trace.decision.finalMessage).toBe(NEUTRAL);
    expect(graph).toEqual(beforeGraph);
  });

  it('carries a valid real compiler/scheduler result into the renderer without depending on an unfixed placement policy', async () => {
    const result = generatedPreview();
    // Independent numeric oracle:20 problems ×3 minutes plus the existing buffer;
    //70 minutes fits the accepted90-minute cap and09:00 earliest start.
    expect(result.draftCandidates.map(candidate => [candidate.date, candidate.startTime, candidate.endTime, candidate.durationMinutes]))
      .toEqual([['2026-08-24', '09:00', '10:10', 70]]);
    const candidate = result.draftCandidates[0] as Candidate;
    const { actual, payload, evidence } = await renderPreview(result);
    expect(payload.planningStateSummary.acceptedFacts.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'session', kind: 'session_duration', minutes: 90 }),
    ]));
    expect(payload.planningStateSummary.acceptedFacts.temporalConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'clock', kind: 'earliest_start', startTime: '09:00' }),
    ]));
    expect(evidence).toMatchObject({ status: 'available', graphRevision: 1, phase: 'generated_preview',
      constraintEvaluation: 'not_evaluated', summary: { scope: 'all_candidates', candidateCount: 1,
        totalDurationMinutes: 70, minDurationMinutes: 70, maxDurationMinutes: 70,
        earliestStartTime: '09:00', latestEndTime: '10:10' },
      details: { coverage: 'complete', omittedCount: 0, candidates: [{ candidateKey: candidate.stableKey,
        taskId: 'task', workItemKey: candidate.workItemKey, date: '2026-08-24', startTime: '09:00', endTime: '10:10',
        durationMinutes: 70, approvalStatus: 'unapproved', sourceFactRefs: candidate.stableV5Metadata.sourceFactRefs }] } });
    expect(actual.responseSource).toBe('ai');
    expect(actual.dialogueRendererTrace?.decision.finalMessage).toBe(NEUTRAL);
  });
  it('keeps accepted30/20:00 separate from deliberately mismatched70/09:00 observations without claiming fulfillment', async () => {
    const result = mismatchedPreview();
    expect(result.draftCandidates.map(c => [c.startTime, c.endTime, c.durationMinutes])).toEqual([['09:00', '10:10', 70]]);
    const candidate = result.draftCandidates[0] as Candidate;
    expect(candidate.stableV5Metadata.sourceFactRefs).not.toContain('session');
    expect(candidate.stableV5Metadata.sourceFactRefs).not.toContain('clock');
    const { actual, payload, evidence } = await renderPreview(result);
    expect(payload.planningStateSummary.acceptedFacts.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'session', kind: 'session_duration', minutes: 30 }),
    ]));
    expect(payload.planningStateSummary.acceptedFacts.temporalConstraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'clock', kind: 'earliest_start', startTime: '20:00' }),
    ]));
    expect(evidence).toMatchObject({ status: 'available', graphRevision: 1, phase: 'generated_preview',
      constraintEvaluation: 'not_evaluated', summary: { scope: 'all_candidates', candidateCount: 1,
        totalDurationMinutes: 70, minDurationMinutes: 70, maxDurationMinutes: 70,
        earliestStartTime: '09:00', latestEndTime: '10:10' },
      details: { coverage: 'complete', omittedCount: 0, candidates: [{ candidateKey: candidate.stableKey,
        taskId: 'task', workItemKey: candidate.workItemKey, date: '2026-08-24', startTime: '09:00', endTime: '10:10',
        durationMinutes: 70, approvalStatus: 'unapproved', sourceFactRefs: candidate.stableV5Metadata.sourceFactRefs }] } });
    expect(actual.responseSource).toBe('ai');
    expect(actual.message).toBe(NEUTRAL);
    expect(actual.dialogueRendererTrace?.decision.finalMessage).toBe(NEUTRAL);
  });

  it.each(['missing graph', 'stale revision', 'foreign task'] as const)('does not expose authoritative observations for %s', async kind => {
    const result = mismatchedPreview();
    if (kind === 'missing graph') delete result.stableV5Graph;
    else {
      const metadata = (result.draftCandidates[0] as Candidate).stableV5Metadata;
      if (kind === 'stale revision') metadata.graphRevision = 0;
      else metadata.taskId = 'foreign-task';
    }
    const { evidence } = await renderPreview(result);
    expect(evidence).toMatchObject({ status: 'unavailable' });
    expect(evidence).not.toHaveProperty('summary');
    expect(evidence).not.toHaveProperty('details');
  });

  it('aggregates the last of500 candidates before limiting details and preserves the same facts under permutation', async () => {
    const result = mismatchedPreview();
    const seed = result.draftCandidates[0] as Candidate;
    // Synthetic candidate set isolates projection; it is not500 scheduler placements or an admission test.
    result.draftCandidates = Array.from({ length: 500 }, (_, index) => ({ ...structuredClone(seed),
      stableKey: `candidate-${index}`, workItemKey: `work-${index}`, startTime: '09:00',
      endTime: index === 499 ? '10:10' : '09:30', durationMinutes: index === 499 ? 70 : 30,
      estimatedMinutes: index === 499 ? 70 : 30 }));
    const first = await renderPreview(result);
    expect(first.evidence?.summary).toEqual({ scope: 'all_candidates', candidateCount: 500,
      totalDurationMinutes: 15040, minDurationMinutes: 30, maxDurationMinutes: 70,
      earliestStartTime: '09:00', latestEndTime: '10:10' });
    expect(first.evidence?.details?.coverage).toBe('partial');
    expect(first.evidence!.details!.candidates.length).toBeGreaterThan(0);
    expect(first.evidence!.details!.candidates.length).toBeLessThan(500);
    expect(first.evidence!.details!.candidates).toEqual(expect.arrayContaining([expect.objectContaining({
      candidateKey: 'candidate-499', durationMinutes: 70,
    })]));
    expect(first.evidence!.details!.omittedCount).toBe(500 - first.evidence!.details!.candidates.length);
    const wireRequest = { purpose: first.request.purpose, temperature: first.request.temperature,
      messages: first.request.messages, response_format: first.request.responseFormat,
      max_completion_tokens: first.request.maxCompletionTokens };
    expect(measureJsonUtf8Bytes(wireRequest)).toBeLessThanOrEqual(AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes);
    expect(first.request.messages.every(m => m.content.length <= AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageContentLength)).toBe(true);
    expect(first.request.messages.reduce((sum, m) => sum + m.content.length, 0))
      .toBeLessThanOrEqual(AI_PROXY_CHAT_REQUEST_LIMITS.maxTotalMessageContentLength);
    expect(measureJsonUtf8Bytes({ messages: first.request.messages, requestBytes: measureJsonUtf8Bytes(first.request.messages) }))
      .toBeLessThanOrEqual(12 * 1024);
    result.draftCandidates.reverse();
    const reversed = await renderPreview(result);
    expect(reversed.evidence?.summary).toEqual(first.evidence?.summary);
    expect(reversed.evidence?.constraintEvaluation).toBe('not_evaluated');
  });

  it.each(['foreign conversation', 'retained preview', 'span mismatch', 'foreign reference', 'inactive reference', 'foreign source', 'non-draft phase', 'cross-task reference'] as const)(
    'keeps %s outside the observed-preview scope', async kind => {
      const result = mismatchedPreview();
      const candidate = result.draftCandidates[0] as Candidate;
      if (kind === 'foreign conversation') candidate.stableV5Metadata.conversationId = 'another-conversation';
      if (kind === 'retained preview') result.preserveExistingPreview = true;
      if (kind === 'non-draft phase') result.state.status = 'needs_scope';
      if (kind === 'foreign source') result.stableV5Graph!.effortEstimates[0].source = {
        ...result.stableV5Graph!.effortEstimates[0].source, conversationId: 'another-conversation' };
      if (kind === 'cross-task reference') {
        result.stableV5Graph!.tasks.push({ ...result.stableV5Graph!.tasks[0], id: 'other-task' });
        result.stableV5Graph!.factLifecycles.push({ factId: 'other-task', status: 'active',
          createdRevision: 1, terminalRevision: null, supersededByFactId: null });
        candidate.stableV5Metadata.sourceFactRefs.push('other-task');
      }
      if (kind === 'span mismatch') candidate.endTime = '09:30';
      if (kind === 'foreign reference') candidate.stableV5Metadata.sourceFactRefs.push('not-in-this-graph');
      if (kind === 'inactive reference') result.stableV5Graph!.factLifecycles = result.stableV5Graph!.factLifecycles
        .filter(entry => entry.factId !== 'pace');
      const { evidence } = await renderPreview(result);
      expect(evidence).toMatchObject({ status: 'unavailable' });
      expect(evidence).not.toHaveProperty('summary');
      expect(evidence).not.toHaveProperty('details');
    },
  );

  it('keeps two current tasks separate while the aggregate covers the entire preview', async () => {
    const result = mismatchedPreview();
    const graph = result.stableV5Graph!;
    graph.tasks.push({ ...graph.tasks[0], id: 'other-task', title: '英語' });
    graph.factLifecycles.push({ factId: 'other-task', status: 'active', createdRevision: 1,
      terminalRevision: null, supersededByFactId: null });
    const other = structuredClone(result.draftCandidates[0]) as Candidate;
    Object.assign(other, { stableKey: 'other-candidate', workItemKey: 'other-work', durationMinutes: 30,
      estimatedMinutes: 30, endTime: '09:30' });
    other.stableV5Metadata.taskId = 'other-task';
    other.stableV5Metadata.sourceFactRefs = ['other-task'];
    result.draftCandidates.push(other);
    const { evidence, payload } = await renderPreview(result);
    expect(evidence?.summary).toMatchObject({ scope: 'all_candidates', candidateCount: 2,
      totalDurationMinutes: 100, minDurationMinutes: 30, maxDurationMinutes: 70 });
    expect(evidence?.details?.candidates.map(row => [row.taskId, row.durationMinutes, row.sourceFactRefs]))
      .toEqual([['task', 70, ['task', 'workload', 'pace']], ['other-task', 30, ['other-task']]]);
    expect(payload.planningStateSummary.acceptedFacts.effortEstimates.find((fact: { id: string }) => fact.id === 'session'))
      .toMatchObject({ taskId: 'task', targetFactId: 'task', minutes: 30 });
    expect(evidence?.constraintEvaluation).toBe('not_evaluated');
  });

  it.each(['work item', 'source reference'] as const)('omits an oversized %s detail explicitly without truncating an identity or losing the full summary', async kind => {
    const result = mismatchedPreview();
    const longId = 'w'.repeat(5000);
    if (kind === 'work item') result.draftCandidates[0].workItemKey = longId;
    else {
      result.stableV5Graph!.effortEstimates[0].id = longId;
      result.stableV5Graph!.factLifecycles.find(entry => entry.factId === 'pace')!.factId = longId;
      const metadata = (result.draftCandidates[0] as Candidate).stableV5Metadata;
      metadata.sourceFactRefs = metadata.sourceFactRefs.map(ref => ref === 'pace' ? longId : ref);
    }
    const { evidence } = await renderPreview(result);
    expect(evidence).toMatchObject({ status: 'available', summary: { candidateCount: 1, totalDurationMinutes: 70 },
      details: { coverage: 'partial', omittedCount: 1, candidates: [] }, constraintEvaluation: 'not_evaluated' });
    expect(measureJsonUtf8Bytes(evidence)).toBeLessThanOrEqual(4 * 1024);
  });

  it('reports a matching duration and clock as observations without promoting them to verified fulfillment', async () => {
    const result = mismatchedPreview();
    Object.assign(result.draftCandidates[0], { startTime: '20:00', endTime: '20:30', durationMinutes: 30, estimatedMinutes: 30 });
    const { evidence } = await renderPreview(result);
    expect(evidence).toMatchObject({ status: 'available', constraintEvaluation: 'not_evaluated',
      summary: { candidateCount: 1, totalDurationMinutes: 30, minDurationMinutes: 30, maxDurationMinutes: 30,
        earliestStartTime: '20:00', latestEndTime: '20:30' } });
  });

  it('drops only the new observations explicitly if they would cross an existing message budget', async () => {
    const first = await renderPreview(mismatchedPreview());
    const padding = 'x'.repeat(AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageContentLength - first.request.messages[1].content.length + 1);
    const second = await renderPreview(mismatchedPreview(), NEUTRAL, `候補の内容を確認したいです。${padding}`);
    expect(second.evidence).toEqual({ status: 'unavailable', reason: 'request_budget' });
    expect(second.request.messages.every(message => message.content.length <= AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageContentLength)).toBe(true);
    expect(second.payload.planningStateSummary.acceptedFacts.effortEstimates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'session', minutes: 30 }),
    ]));
  });

  it('keeps the actual direct-client fetch body bounded when the added observations cross the UTF-8 body limit', async () => {
    const first = await renderPreview(mismatchedPreview());
    const config = { provider: 'openai' as const, baseUrl: 'https://example.invalid/v1', model: 'test', apiKey: 'test-key' };
    const originalBytes = measureJsonUtf8Bytes(createOpenAiCompatibleChatRequestPayload(config, first.request));
    const addedBytes = AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes - originalBytes + 1;
    const padding = '界'.repeat(Math.floor(addedBytes / 3)) + 'x'.repeat(addedBytes % 3);
    const originalUserText = '候補の内容を確認したいです。';
    const fullPayload = structuredClone(first.payload);
    fullPayload.currentUserMessage = originalUserText + padding;
    const fullRequest = { ...first.request, messages: [first.request.messages[0],
      { role: 'user' as const, content: JSON.stringify(fullPayload) }] };
    expect(measureJsonUtf8Bytes(createOpenAiCompatibleChatRequestPayload(config, fullRequest)))
      .toBe(AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes + 1);
    expect(fullRequest.messages[1].content.length).toBeLessThan(AI_PROXY_CHAT_REQUEST_LIMITS.maxMessageContentLength);
    const realClient = await vi.importActual<typeof import('../../../services/ai/openAiCompatibleClient')>(
      '../../../services/ai/openAiCompatibleClient');
    const fetchMock = vi.fn(async (_url: unknown, init: RequestInit | undefined) => {
      const wire = JSON.parse(String(init?.body));
      const payload = JSON.parse(wire.messages[1].content);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        actionId: payload.actionId, actionKind: 'preview_ready', questionCode: null,
        groundingAcknowledgement: null, text: NEUTRAL,
      }) } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    completion.mockReset().mockImplementation(request => realClient.createOpenAiCompatibleClient(config).createChatCompletion(request));
    const result = mismatchedPreview();
    const before = structuredClone(result);
    const actual = await renderWeeklyPlanningStableV5AssistantMessage({ result,
      input: { messages: [], userText: originalUserText + padding, selectedDate: '2026-08-19',
        userId: 'owner-1', plans: [], scheduleTemplates: [], conversationId: CONVERSATION, traceRequestId: REQUEST } });
    expect(completion).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const actualBody = String(fetchMock.mock.calls[0][1]?.body);
    expect(new TextEncoder().encode(actualBody).byteLength).toBeLessThanOrEqual(AI_PROXY_CHAT_REQUEST_LIMITS.maxRequestBodyBytes);
    expect(JSON.parse(JSON.parse(actualBody).messages[1].content).applicationDecision.previewEvidence)
      .toEqual({ status: 'unavailable', reason: 'request_budget' });
    expect(actual.responseSource).toBe('ai');
    expect(result).toEqual(before);
  });

  it.each([
    ['actual clock', `候補は09:00から10:10の70分です。「${CONTROL}」を選択してください。`, 'ai'],
    ['invented clock', `候補は11:00から12:10の70分です。「${CONTROL}」を選択してください。`, 'deterministic_fallback'],
    ['false save', `保存しました。「${CONTROL}」を選択してください。`, 'deterministic_fallback'],
  ] as const)('admits actual data while retaining the %s boundary', async (_label, text, expected) => {
    const { actual } = await renderPreview(mismatchedPreview(), text);
    expect(actual.responseSource).toBe(expected);
    if (expected === 'ai') expect(actual.message).toBe(text);
    else expect(actual.dialogueRendererTrace?.response.reason).toBe('ungrounded_text');
  });
});
