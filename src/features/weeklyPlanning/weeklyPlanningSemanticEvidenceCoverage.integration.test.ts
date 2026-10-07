import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScriptedConversation, installScriptedWeeklyPlanningProvider, resetScriptedConversationRuntime } from './testUtils/weeklyPlanningScriptedConversationHarness';
import { COVERAGE_USER_TEXT, COVERAGE_C_USER_TEXT, coverageDocument, coverageRendererReply } from './testUtils/weeklyPlanningSemanticEvidenceCoverageFixture';
import calibration from './testUtils/weeklyPlanningSemanticEvidenceCoverageCalibration.json';
import type { WeeklyPlanningSemanticDocumentV5 } from './semantic/weeklyPlanningSemanticDocumentV5';
import { createWeeklyPlanningTurnDispatchBudget, withWeeklyPlanningTurnDispatchBudget } from './application/weeklyPlanningTurnDispatchBudget';
import { createWeeklyPlanningSemanticNormalizerV5 } from './semantic/weeklyPlanningSemanticNormalizerV5';
import type { ScriptedProviderReply } from './testUtils/weeklyPlanningScriptedConversationHarness';

let provider: ReturnType<typeof installScriptedWeeklyPlanningProvider>;
let auditDecision: 'complete' | 'incomplete';
let initiallyComplete: boolean;
let genericCalls: number;
let variant: 'A' | 'C';
let firstDocumentOverride: WeeklyPlanningSemanticDocumentV5 | null;
let auditReply: ScriptedProviderReply | null;
let failRetry: boolean;
let taskOnlyFirst: boolean;

beforeEach(() => {
  resetScriptedConversationRuntime();
  auditDecision = 'incomplete'; initiallyComplete = false; genericCalls = 0; variant = 'A'; firstDocumentOverride = null; auditReply = null; failRetry = false; taskOnlyFirst = false;
  provider = installScriptedWeeklyPlanningProvider((call) => {
    if (call.kind === 'renderer') return coverageRendererReply(call);
    if (call.schemaName === 'weekly_planning_dense_turn_completeness_audit_v5') return auditReply ?? JSON.stringify({
      decision: auditDecision, missingFacts: auditDecision === 'incomplete'
        ? variant === 'C' ? ['1ページ4分の作業時間'] : ['1ページ3分の作業時間', '平日20時以降の希望'] : [],
    });
    if (call.kind === 'semantic_generic') {
      if (failRetry && genericCalls > 0) return { failure: 'http', status: 503 };
      if (taskOnlyFirst && genericCalls === 0) {
        genericCalls += 1;
        // Live C on 8c4ef790: the first document kept only the window and the task.
        const taskOnly = coverageDocument(false, variant);
        taskOnly.tasks = taskOnly.tasks.map((task) => ({
          ...task, workloads: [], effortEstimates: [],
          study: task.study ? { ...task.study, components: task.study.components.map((component) => ({ ...component, workloads: [] })) } : task.study,
        }));
        if (!call.schemaProperties.includes('conversationActs')) delete taskOnly.conversationActs;
        return JSON.stringify(taskOnly);
      }
      const document = firstDocumentOverride ? structuredClone(firstDocumentOverride) : coverageDocument(initiallyComplete || genericCalls++ > 0, variant);
      if (!call.schemaProperties.includes('conversationActs')) delete document.conversationActs;
      return JSON.stringify(document);
    }
    throw new Error(`Unexpected coverage fixture call: ${call.schemaName}`);
  }, { completenessAudit: 'scripted' });
});
afterEach(() => { provider.restore(); resetScriptedConversationRuntime(); });

describe('partial omission uses the existing AI audit in the production turn', () => {
  it('audits/retries the short live omission and previews Monday 20:00–21:10', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const turn = await conversation.submit(COVERAGE_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map((call) => call.schemaName)).toEqual([
      'weekly_planning_semantic_document_v5', 'weekly_planning_dense_turn_completeness_audit_v5',
      'weekly_planning_semantic_document_v5', 'weekly_planning_stable_v5_dialogue_response',
    ]);
    expect(turn.result?.draftCandidates).toEqual([expect.objectContaining({ date: '2026-10-12', startTime: '20:00', endTime: '21:10' })]);
    expect(conversation.graph()?.effortEstimates).toContainEqual(expect.objectContaining({ kind: 'duration_per_unit', minutes: 3 }));
    expect(conversation.graph()?.availabilityDeclarations).toContainEqual(expect.objectContaining({ startTime: '20:00', recurrenceKind: 'weekdays' }));
    expect(turn.debugTrace.find((event) => event.stage === 'semantic_evidence_coverage_eligibility')?.data).toMatchObject({
      route: 'partial_leaf_evidence_coverage', eligible: true, maxUncoveredSpanCodePoints: 27,
    });
  });

  it('does not audit the complete live A document', async () => {
    initiallyComplete = true;
    const turn = await createScriptedConversation({ provider, architecture: 'interaction_v1' }).submit(COVERAGE_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'renderer']);
  });

  it('audits a first document that kept only the task instead of asking for the stated pages (live C on 8c4ef790)', async () => {
    variant = 'C';
    taskOnlyFirst = true;
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const turn = await conversation.submit(COVERAGE_C_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'semantic_other', 'semantic_generic', 'renderer']);
    expect(conversation.graph()?.workloads).toContainEqual(expect.objectContaining({ amount: 30, unitCode: 'page' }));
    expect(conversation.graph()?.effortEstimates).toContainEqual(expect.objectContaining({ kind: 'duration_per_unit', minutes: 4 }));
    expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
  });

  it('catches the short C rate-only tail through audit and normal interpretation', async () => {
    variant = 'C';
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const turn = await conversation.submit(COVERAGE_C_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'semantic_other', 'semantic_generic', 'renderer']);
    expect(turn.result!.draftCandidates.length).toBeGreaterThan(0);
    expect(conversation.graph()?.effortEstimates).toContainEqual(expect.objectContaining({ kind: 'duration_per_unit', minutes: 4 }));
    expect(conversation.graph()?.workloads).toContainEqual(expect.objectContaining({ amount: 30, unitCode: 'page' }));
    expect(conversation.graph()?.availabilityDeclarations).toHaveLength(0);
  });

  it.each(calibration.filter((entry) =>
    (entry.capture.startsWith('B-') && [2, 5].includes(entry.responseIndex))
    || (entry.capture.startsWith('E-') && [2, 6].includes(entry.responseIndex))))(
    'does not audit live $capture response $responseIndex (exact call sequence)', async (entry) => {
      const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
      if (entry.capture.startsWith('E-') && entry.responseIndex === 6) {
        const setup = calibration.find((candidate) => candidate.capture === entry.capture && candidate.responseIndex === 2)!;
        firstDocumentOverride = structuredClone(setup.document) as WeeklyPlanningSemanticDocumentV5;
        for (const task of firstDocumentOverride.tasks) for (const component of task.study?.components ?? []) component.existingPublicId = null;
        await conversation.submit(setup.userText);
      }
      firstDocumentOverride = structuredClone(entry.document) as WeeklyPlanningSemanticDocumentV5;
      for (const task of firstDocumentOverride.tasks) for (const component of task.study?.components ?? []) component.existingPublicId = null;
      if (entry.capture.startsWith('E-') && entry.responseIndex === 6) {
        const taskId = conversation.graph()!.tasks[0].id;
        firstDocumentOverride.tasks[0].existingPublicId = taskId;
        firstDocumentOverride.conversationActs![0].targetPublicId = taskId;
      }
      const turn = await conversation.submit(entry.userText);
      expect(turn.result?.failure).toBeUndefined();
      expect(turn.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'renderer']);
    },
  );

  it('keeps the valid partial document when the AI auditor judges coverage complete', async () => {
    auditDecision = 'complete';
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const turn = await conversation.submit(COVERAGE_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'semantic_other', 'renderer']);
    expect(conversation.graph()?.effortEstimates).toHaveLength(0);
    expect(turn.result?.draftCandidates).toHaveLength(0);
  });

  it('leaves legacy short-input control flow unchanged', async () => {
    const conversation = createScriptedConversation({ provider, architecture: 'legacy_v5' });
    const turn = await conversation.submit(COVERAGE_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(turn.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'renderer']);
    expect(conversation.graph()?.effortEstimates).toHaveLength(0);
    expect(turn.debugTrace.some((event) => event.stage === 'semantic_evidence_coverage_eligibility')).toBe(false);
  });

  it.each(['malformed', 'outage'] as const)('optional %s audit keeps the valid initial facts and missing-effort question', async (failure) => {
    auditReply = failure === 'malformed' ? 'not an audit decision' : { failure: 'http', status: 503 };
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const turn = await conversation.submit(COVERAGE_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.graph()?.workloads).toContainEqual(expect.objectContaining({ amount: 20 }));
    expect(conversation.graph()?.effortEstimates).toHaveLength(0);
    expect(turn.result?.draftCandidates).toHaveLength(0);
    expect(conversation.getState().intakeState?.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_effort_estimate');
    expect(turn.debugTrace.find((event) => event.stage === 'semantic_evidence_coverage_abstained')?.data).toMatchObject({
      reason: failure === 'malformed' ? 'malformed_audit_response' : 'provider_failure', step: 'audit',
    });
    expect(turn.calls.map((call) => call.kind)).toEqual(failure === 'malformed'
      ? ['semantic_generic', 'semantic_other', 'renderer'] : ['semantic_generic', 'semantic_other']);
  });

  it('an optional retry outage also keeps the initial blocked document', async () => {
    failRetry = true;
    const conversation = createScriptedConversation({ provider, architecture: 'interaction_v1' });
    const turn = await conversation.submit(COVERAGE_USER_TEXT);
    expect(turn.result?.failure).toBeUndefined();
    expect(conversation.graph()?.workloads).toContainEqual(expect.objectContaining({ amount: 20 }));
    expect(turn.result?.draftCandidates).toHaveLength(0);
    expect(turn.debugTrace.find((event) => event.stage === 'semantic_evidence_coverage_abstained')?.data).toMatchObject({ reason: 'provider_failure', step: 'retry' });
    expect(turn.calls.map((call) => call.kind)).toEqual(['semantic_generic', 'semantic_other', 'semantic_generic']);
  });

  it('the existing dense audit still rejects a malformed decision', async () => {
    const client = { async createChatCompletion(request: Parameters<import('../../services/ai/openAiCompatibleClient').OpenAiCompatibleClient['createChatCompletion']>[0]) {
      return request.responseFormat?.json_schema.name === 'weekly_planning_dense_turn_completeness_audit_v5'
        ? 'not an audit decision' : JSON.stringify(coverageDocument());
    } };
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText: COVERAGE_USER_TEXT.repeat(20), conversationArchitecture: 'interaction_v1' });
    expect(result.status).toBe('provider_failure');
    expect(result.document).toBeNull();
  });

  it.each([2, 3])('keeps the valid initial document when the shared dispatch limit is %s', async (limit) => {
    const requests: string[] = [];
    const budget = createWeeklyPlanningTurnDispatchBudget(limit);
    const client = withWeeklyPlanningTurnDispatchBudget({ async createChatCompletion(request) {
      const name = request.responseFormat?.json_schema?.name ?? '';
      requests.push(name);
      return name === 'weekly_planning_dense_turn_completeness_audit_v5'
        ? JSON.stringify({ decision: 'incomplete', missingFacts: ['rate and weekday preference'] })
        : JSON.stringify(coverageDocument());
    } }, budget, 'semantic');
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({ userText: COVERAGE_USER_TEXT, conversationArchitecture: 'interaction_v1' });
    expect(result.status).toBe('accepted');
    expect(result.document?.tasks[0].effortEstimates).toHaveLength(0);
    expect(budget.usage().refused).toBe(1);
    expect(requests).toHaveLength(limit - 1);
  });
});
