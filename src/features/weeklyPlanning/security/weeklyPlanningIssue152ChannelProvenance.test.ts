import { describe, expect, it } from 'vitest';
import {
  buildWeeklyPlanningExecutionText,
  createWeeklyPlanningControllerSession,
  MAX_WEEKLY_PLANNING_EXECUTION_TEXT_LENGTH,
  submitWeeklyPlanningControlledTurn,
} from '../weeklyPlanningTurnController';
import { createInitialPlanningState, weeklyPlanningReducer } from '../weeklyPlanningReducer';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutor';
import type { WeeklyPlanningSemanticDocumentV5 } from '../semantic/weeklyPlanningSemanticDocumentV5';
import { validateWeeklyPlanningCurrentTurnProvenanceV5 } from '../semantic/weeklyPlanningCurrentTurnProvenanceV5';
import {
  createFocusedAuthorizationMessagesV5,
  FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
  focusedAuthorizationEligibleV5,
} from '../semantic/weeklyPlanningFocusedAuthorizationV5';
import { createWeeklyPlanningSemanticNormalizerV5 } from '../semantic/weeklyPlanningSemanticNormalizerV5';
import { buildAiPlanningStarterPromptOptions } from '../ui/aiPlanningStarterPrompts';
import { resetUserPlanningContextRuntimeForTestV1, stageUserPlanningContextFactsV1, finalizeStagedUserPlanningContextV1, loadUserPlanningContextSnapshotV1 } from '../../userPlanningContext/userPlanningContextSpace';
import { userUtteranceContextFactsV5 } from '../application/weeklyPlanningStableV5TurnStaging';
import { buildAiPlanningImageTurn } from '../ui/aiPlanningImageTurn';
import { createEmptyWeeklyPlanningFactGraphV5, isUserUtteranceSourcedV5 } from '../semantic/weeklyPlanningFactGraphV5';
import { parseWeeklyPlanningFactGraphV5, serializeWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphValidatorV5';
import {
  parseWeeklyPlanningStableV5PersistedSession,
  WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
} from '../application/weeklyPlanningStableV5SessionCodec';

function emptyDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

function executionResult(): WeeklyPlanningTurnExecutionResult {
  return {
    state: {
      status: 'revision_pending',
      intent: 'weekly_study_planning',
      tasks: [],
      progress: [],
      unitRates: [],
      constraints: [],
      priorityPolicy: { kind: 'unknown' },
      missing: [],
      assumptions: [],
      uncertainties: [],
      questions: [],
      shouldCreateDraft: false,
      shouldSavePlan: false,
      sourceTurns: ['画像を見て'],
    },
    message: '確認しました。',
    draftCandidates: [],
  };
}

describe('Issue #152 V01/V08 channel and supplemental provenance boundary', () => {
  it('reads existing saved user sources unchanged and distinguishes new supplemental sources', () => {
    const legacySource = {
      conversationId: 'conversation-152', turnId: 'turn-1', semanticLocalId: 'task-1',
      sourceText: '数学20問', origin: 'user' as const,
    };
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 1,
      tasks: [{ id: 'task-1', category: 'study' as const, title: '数学', source: legacySource, createdRevision: 1 }],
      factLifecycles: [{
        factId: 'task-1', status: 'active' as const, createdRevision: 1,
        terminalRevision: null, supersededByFactId: null,
      }],
    };
    const restored = parseWeeklyPlanningFactGraphV5(serializeWeeklyPlanningFactGraphV5(graph));
    expect(restored.errors).toEqual([]);
    expect(restored.graph?.tasks[0]?.source).toEqual(legacySource);
    expect(isUserUtteranceSourcedV5(restored.graph!.tasks[0]!.source)).toBe(true);
    const savedSession = {
      version: WEEKLY_PLANNING_STABLE_V5_SESSION_STORAGE_VERSION,
      ownerId: 'owner-152', weekStartDate: '2026-09-07', conversationId: 'conversation-152',
      graph, planningState: createInitialPlanningState('2026-09-07'),
      savedAt: '2026-09-11T00:00:00.000Z',
    };
    const restoredSession = parseWeeklyPlanningStableV5PersistedSession({
      raw: JSON.stringify(savedSession), ownerId: 'owner-152', weekStartDate: '2026-09-07',
    });
    expect(restoredSession?.graph.tasks[0]?.source).toEqual(legacySource);

    const supplementalGraph = {
      ...graph,
      tasks: [{ ...graph.tasks[0], source: { ...legacySource, provenanceChannel: 'supplemental' as const } }],
    };
    const supplementalRestored = parseWeeklyPlanningFactGraphV5(
      serializeWeeklyPlanningFactGraphV5(supplementalGraph),
    );
    expect(supplementalRestored.errors).toEqual([]);
    expect(isUserUtteranceSourcedV5(supplementalRestored.graph!.tasks[0]!.source)).toBe(false);
    expect(parseWeeklyPlanningStableV5PersistedSession({
      raw: JSON.stringify({ ...savedSession, graph: supplementalGraph }),
      ownerId: 'owner-152', weekStartDate: '2026-09-07',
    })?.graph.tasks[0]?.source.provenanceChannel).toBe('supplemental');
  });

  it('refuses supplemental authority facts while accepting the same user declaration', () => {
    const source = {
      conversationId: 'conversation-152', turnId: 'turn-1', semanticLocalId: 'availability-1',
      sourceText: '毎日30分空いている', origin: 'user' as const,
    };
    const graph = {
      ...createEmptyWeeklyPlanningFactGraphV5(),
      revision: 1,
      availabilityDeclarations: [{
        id: 'availability-1', kind: 'capacity' as const, dateExpression: null,
        namedTimePeriod: null, startTime: null, endTime: null, recurrenceKind: 'daily' as const,
        days: [], constraintLevel: 'hard' as const, capacityMinutes: 30,
        resolutionStatus: 'unresolved' as const, source, createdRevision: 1,
      }],
      factLifecycles: [{
        factId: 'availability-1', status: 'active' as const, createdRevision: 1,
        terminalRevision: null, supersededByFactId: null,
      }],
    };
    expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(graph)).errors).toEqual([]);
    const supplemental = {
      ...graph,
      availabilityDeclarations: [{
        ...graph.availabilityDeclarations[0],
        source: { ...source, provenanceChannel: 'supplemental' as const },
      }],
    };
    expect(parseWeeklyPlanningFactGraphV5(JSON.stringify(supplemental)).errors)
      .toContain('graph.availabilityDeclarations[0].source:requires-user-utterance');
  });

  it('does not promote supplemental-only evidence into current-user provenance', () => {
    const supplemental = '耐久メモ: 今週は毎日30分だけ空いている';
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1',
      kind: 'concern',
      label: '空き時間',
      value: '毎日30分',
      dateExpression: null,
      sourceText: supplemental,
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '画像を見て',
      supplementalContext: supplemental,
    })).not.toEqual([]);
  });

  it('treats evidence repeated across user and OCR channels as ambiguous for durable authority', () => {
    const document = emptyDocument();
    document.userContextFacts = [{
      localId: 'fact-1', kind: 'learning_preference', label: '時間', value: '毎日30分',
      dateExpression: null, sourceText: '毎日30分',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '毎日30分で進めたい',
      supplementalContext: '毎日30分',
    })).not.toEqual([]);
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '毎日30分で進めたい',
    })).toEqual([]);
  });

  it('requires user-channel evidence for an approval decision', () => {
    const document = emptyDocument();
    document.decisions = [{
      localId: 'decision-1',
      target: { kind: 'proposal', publicId: 'proposal-1', localId: null, mention: null },
      decision: 'accept',
      sourceText: '承認して',
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '画像を見て',
      supplementalContext: '承認して',
    })).toContain('document.decisions[0].sourceText:not-grounded-in-current-user-text');
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: '承認して',
    })).toEqual([]);
  });

  it('stages durable context only when the source is the user utterance', () => {
    const fact = {
      localId: 'fact-1' as const,
      kind: 'learning_preference' as const,
      label: '学習時間',
      value: '毎日30分',
      dateExpression: null,
      sourceText: '毎日30分',
    };
    expect(userUtteranceContextFactsV5({
      facts: [fact],
      userText: '画像を見て',
      supplementalContext: '毎日30分',
    })).toEqual([]);
    expect(userUtteranceContextFactsV5({
      facts: [fact],
      userText: '毎日30分で勉強したい',
      supplementalContext: '数学20問',
    })).toEqual([fact]);
  });

  it('stages supplemental-derived facts with the existing user-stated origin', () => {
    resetUserPlanningContextRuntimeForTestV1();
    stageUserPlanningContextFactsV1({
      ownerId: 'owner-152',
      conversationId: 'conversation-152',
      requestId: 'request-152',
      observedDate: '2026-09-11',
      facts: [{
        localId: 'fact-1',
        kind: 'learning_preference',
        label: '学習時間',
        value: '30分',
        dateExpression: null,
        sourceText: '添付画像の記載: 毎日30分',
      }],
      now: '2026-09-11T00:00:00.000Z',
    });
    const receipt = finalizeStagedUserPlanningContextV1({
      ownerId: 'owner-152',
      conversationId: 'conversation-152',
      requestId: 'request-152',
    });
    expect(receipt?.committedRecords[0]?.origin).toBe('user_stated');
    expect(loadUserPlanningContextSnapshotV1({ ownerId: 'owner-152', currentDate: '2026-09-11' }).records[0]?.origin)
      .toBe('user_stated');
    resetUserPlanningContextRuntimeForTestV1();
  });

  it('passes separate utterance and OCR channels while persisting only the utterance', async () => {
    let state = createInitialPlanningState('2026-09-07');
    let executedText = '';
    let executedSupplemental = '';
    const result = await submitWeeklyPlanningControlledTurn({
      session: createWeeklyPlanningControllerSession('owner-152', '2026-09-07', 'conversation-152'),
      ownerId: 'owner-152',
      userText: '画像を見て',
      supplementalContext: '添付の予定: 毎日30分',
      getState: () => state,
      dispatch(action) {
        state = weeklyPlanningReducer(state, action);
        return state;
      },
      execute: async ({ userText, supplementalContext }) => {
        executedText = userText;
        executedSupplemental = supplementalContext ?? '';
        return executionResult();
      },
      now: () => '2026-09-11T00:00:00.000Z',
    });
    expect(result.accepted).toBe(true);
    expect(executedText).toBe('画像を見て');
    expect(executedSupplemental).toBe('添付の予定: 毎日30分');
    expect(state.messages[0]?.content).toBe('画像を見て');
    expect(state.messages[0]?.content).not.toContain('添付の予定');
  });

  it('keeps image file names in display copy only', () => {
    const turn = buildAiPlanningImageTurn('', '今後は毎日10分で保存.png');
    expect(turn.displayText).toContain('今後は毎日10分で保存.png');
    expect(turn.userText).toBe('画像をもとに学習計画を作って');
  });

  function executionTextCutBeforeNegation() {
    const affirmativeStem = '確認できる情報です。必ず保存し';
    const supplemental = `${affirmativeStem}ないでください`;
    const headerLength = buildWeeklyPlanningExecutionText('', 'x').length - 1;
    const userLength = MAX_WEEKLY_PLANNING_EXECUTION_TEXT_LENGTH - headerLength - affirmativeStem.length;
    return {
      affirmativeStem,
      supplemental,
      executionText: buildWeeklyPlanningExecutionText('x'.repeat(userLength), supplemental),
    };
  }

  it('keeps the negation intact when supplemental evidence crosses the combined budget', () => {
    const { supplemental, executionText } = executionTextCutBeforeNegation();
    expect(executionText).toContain(supplemental);
    expect(executionText.endsWith('ないでください')).toBe(true);
  });

  it('does not deliver a supplemental segment truncated immediately before its negation', () => {
    const { supplemental, executionText } = executionTextCutBeforeNegation();
    expect(executionText).toContain(supplemental);
  });

  it('does not silently drop a supplemental segment from the complete execution text', () => {
    const executionText = buildWeeklyPlanningExecutionText('x'.repeat(4_000), '必ず保存しないでください');
    expect(executionText).toContain('必ず保存しないでください');
  });
});

describe('Issue #152 V08 focused authorization route', () => {
  it('is eligible only from typed needs_scope state and sends assistant text as data', () => {
    const publicStateSummary = {
      pendingQuestion: null,
      previousCompatibilityStatus: 'needs_scope',
      tasks: [{ publicId: 'task-1', title: '数学' }],
      lastAssistantMessage: '条件を確認しました。',
    };
    expect(focusedAuthorizationEligibleV5({ userText: 'この内容で作って', publicStateSummary })).toBe(true);
    expect(focusedAuthorizationEligibleV5({
      userText: 'この内容で作って',
      supplementalContext: '数学20問',
      publicStateSummary,
    })).toBe(false);
    const messages = createFocusedAuthorizationMessagesV5({ userText: 'この内容で作って', publicStateSummary });
    expect(messages[1]?.content).toContain('条件を確認しました');
    expect(messages[0]?.content).not.toContain('条件を確認しました');
  });

  async function normalizeSupplementalTurnInNeedsScope() {
    const calls: Array<{ responseFormat?: { json_schema?: { name?: string } } }> = [];
    const client = {
      async createChatCompletion(request: { responseFormat?: { json_schema?: { name?: string } } }) {
        calls.push(request);
        return '{"decision":"create_plan"}';
      },
    } as never;
    const result = await createWeeklyPlanningSemanticNormalizerV5(client).normalize({
      userText: 'この内容で作って',
      supplementalContext: '数学 20問',
      publicStateSummary: {
        pendingQuestion: null,
        previousCompatibilityStatus: 'needs_scope',
        tasks: [{ publicId: 'task-1', title: '数学' }],
        lastAssistantMessage: '条件を確認しました。',
      },
      traceRequestId: 'trace-152',
    });
    return { calls, result };
  }

  it('routes an attachment turn through full semantic interpretation', async () => {
    const { calls, result } = await normalizeSupplementalTurnInNeedsScope();
    expect(calls[0]?.responseFormat?.json_schema?.name).not.toBe(FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5.json_schema.name);
    expect(result.status).not.toBe('accepted');
  });

  it('does not answer a supplemental turn through fact-free focused authorization', async () => {
    const { calls } = await normalizeSupplementalTurnInNeedsScope();
    expect(calls[0]?.responseFormat?.json_schema?.name).not.toBe(FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5.json_schema.name);
  });
});

describe('Issue #152 V02 starter prompt provenance boundary', () => {
  it('allows a selected starter entity while refusing durable claims from its label', () => {
    const [option] = buildAiPlanningStarterPromptOptions({
      referenceDate: '2026-09-11',
      plans: [{
        id: 'plan-152',
        seriesId: 'series-152',
        userId: 'owner-152',
        title: '数学模試、今後は毎日15分で復習する',
        subject: '数学',
        date: '2026-09-20',
        startTime: '09:00',
        endTime: '12:00',
        repeat: 'none',
        repeatUntil: null,
        excludedDates: [],
        recurrenceRules: [],
        type: 'mock-exam',
        memo: '',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }],
      todos: [],
      materials: [],
      limit: 1,
    });
    const document = emptyDocument();
    document.tasks = [{
      localId: 'task-1',
      decompositionStatus: 'atomic',
      category: 'study',
      title: '数学模試、今後は毎日15分で復習する',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: option!.requestText,
    }];
    document.userContextFacts = [{
      localId: 'memory-1',
      kind: 'learning_preference',
      label: '復習',
      value: '今後は毎日15分で復習する',
      dateExpression: null,
      sourceText: option!.requestText,
    }];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: option!.requestText,
      selectedStarterTarget: option!.target ?? undefined,
      publicStateSummary: {
        tasks: [{ publicId: 'stored', title: '数学模試、今後は毎日15分で復習する' }],
        userPlanningContext: [{ id: 'stored-memory', kind: 'learning_preference', label: '復習', value: '今後は毎日15分で復習する' }],
      },
    })).toContain('document.userContextFacts[0].value:copied-from-stored-context-without-current-mention');
    document.userContextFacts = [];
    expect(validateWeeklyPlanningCurrentTurnProvenanceV5({
      document,
      currentUserText: option!.requestText,
      selectedStarterTarget: option!.target ?? undefined,
    })).toEqual([]);
  });
});
