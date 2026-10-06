import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createStableV5SemanticPublicStateSummary } from './application/weeklyPlanningStableV5SemanticContext';
import { createWeeklyPlanningStableV5DialoguePrompt } from './dialogue/weeklyPlanningStableV5DialoguePrompt';
import { resolveWeeklyPlanningQuestionPresentationFreshness } from './intake/weeklyPlanningQuestionPresentation';
import { createEmptyWeeklyPlanningFactGraphV5 } from './semantic/weeklyPlanningFactGraphV5';
import { createWeeklyPlanningSemanticMeaningPolicyV5 } from './semantic/weeklyPlanningSemanticMeaningPolicyV5';
import { normalizeWeeklyPlanningSemanticPreParseV5 } from './semantic/weeklyPlanningSemanticPreParseNormalizationV5';
import { createWeeklyPlanningSemanticBaseMessagesV5 } from './semantic/weeklyPlanningSemanticPromptAssemblyV5';
import { semanticProviderResponseFormatV5 } from './semantic/weeklyPlanningSemanticProviderResponseFormatV5';
import { validateWeeklyPlanningSemanticResponseV5 } from './semantic/weeklyPlanningSemanticResponseValidationV5';

/*
 * Legacy fidelity oracle (Issue #488 comparison switch).
 *
 * The expected hashes below were produced from the PRE-#488 tree, not from this code:
 *
 *   git archive ee07697e src shared workers package.json tsconfig*.json vite.config.mjs | tar -x -C <dir>
 *   (a probe test in <dir> imported the same functions and hashed their outputs with sha256)
 *
 * so `legacy_v5` is proven to send the same provider schema / prompt text / renderer prompt /
 * pending-question context and to apply the same document contract as ee07697e for these
 * boundaries. `interaction_v1` must differ at exactly the boundaries #488 changed.
 */
const ORACLE_EE07697E = {
  providerFormat: 'b43fc4febd70df044ac19d64cecc182920aa51f0632c33cc2c87f913da829972',
  meaningPolicy: 'c6e2d94e52fb9665f53fcb8e1e62edfddb485f36b4998df9644cd2ea224577cb',
  baseMessages: 'c94577a42aaea6b6be07c62fb1b287654409fe61f41e8c23645fcfd27df1d117',
  dialogueSystem: '5451e539c912a2a61ef1fbe778aa40d614a082d3f5928d9da45daa948efa5625',
  dialogueUser: '905134e69a8d7a42db87138cd072f0388a7de7afb573623226791af5a189cfc4',
  publicStateSummary: '7399eee0fce084004e35eb2558f2505c3b9b4597e6d1769308ba4e8b7985077c',
  preparse: 'b7defac1b1142ac90added9ee22fa004a7dfa1c35cf133c9732ac5b77438acae',
} as const;

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

const PREVIOUS_STATE = {
  status: 'needs_unit_rate',
  missing: [],
  questions: ['q'],
  lastQuestionContext: {
    kind: 'missing',
    targetSlot: 'stable_v5:missing_effort_estimate',
    topicId: 't1',
    actionId: 'a1',
    intent: 'duration_per_unit',
  },
} as never;

function publicStateSummary(architecture: 'legacy_v5' | 'interaction_v1') {
  const graph = { ...createEmptyWeeklyPlanningFactGraphV5(), revision: 7 };
  return createStableV5SemanticPublicStateSummary({
    graph,
    messages: [],
    previousState: PREVIOUS_STATE,
    // The previous question was never presented by a committed message: not fresh.
    pendingQuestionPresentation: resolveWeeklyPlanningQuestionPresentationFreshness({
      previousState: PREVIOUS_STATE,
      inputStateRevision: 1,
      messages: [],
      graphRevision: 7,
    }),
    freshPendingQuestionBinding: architecture === 'interaction_v1',
    userText: 'x',
  } as never);
}

function dialoguePrompt(architecture: 'legacy_v5' | 'interaction_v1') {
  return createWeeklyPlanningStableV5DialoguePrompt({
    actionId: 'act-1',
    currentUserMessage: 'なんで時間が必要？',
    recentConversation: [],
    planningInformation: null,
    actionKind: 'question',
    questionCode: 'missing_effort_estimate',
    requiredLabels: [],
    fallbackText: 'f',
    previewCount: 0,
    conversationArchitecture: architecture,
  } as never);
}

const EMPTY_ENVELOPE = JSON.stringify({
  corrections: [], execution: { approvalRequests: [] }, facts: [],
  grounding: { needsGrounding: false, note: null, targetFactIds: [] }, notes: [], uncertainties: [],
});

function documentJson(withActs: boolean): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null, tasks: [], relations: [],
    availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [],
    ...(withActs
      ? { conversationActs: [{ kind: 'ask_about_pending_question', targetPublicId: null, sourceText: 'なんで' }] }
      : {}),
    uncertainties: [], corrections: [], decisions: [],
  });
}

describe('legacy_v5 reproduces the pre-#488 boundaries (oracle: ee07697e)', () => {
  it('sends the pre-#488 provider schema without conversationActs', () => {
    expect(sha(JSON.stringify(semanticProviderResponseFormatV5('legacy_v5')))).toBe(ORACLE_EE07697E.providerFormat);
    expect(JSON.stringify(semanticProviderResponseFormatV5('legacy_v5'))).not.toContain('conversationActs');
  });

  it('sends the pre-#488 semantic prompt (meaning rules and base messages)', () => {
    expect(sha(createWeeklyPlanningSemanticMeaningPolicyV5('legacy_v5'))).toBe(ORACLE_EE07697E.meaningPolicy);
    expect(sha(JSON.stringify(createWeeklyPlanningSemanticBaseMessagesV5({
      userText: 'テスト', recentConversation: [], publicStateSummary: {}, conversationArchitecture: 'legacy_v5',
    })))).toBe(ORACLE_EE07697E.baseMessages);
  });

  it('sends the pre-#488 renderer prompt (renderer decides "explain" from the raw message)', () => {
    const prompt = dialoguePrompt('legacy_v5');
    expect(sha(prompt.systemPrompt)).toBe(ORACLE_EE07697E.dialogueSystem);
    expect(sha(prompt.userPrompt)).toBe(ORACLE_EE07697E.dialogueUser);
    expect(prompt.userPrompt).not.toContain('conversationOutcome');
    expect(prompt.userPrompt).not.toContain('consultationDeferred');
  });

  it('offers the raw previous question stamped with the current graph revision (no freshness gate)', () => {
    const summary = publicStateSummary('legacy_v5');
    expect(sha(JSON.stringify(summary))).toBe(ORACLE_EE07697E.publicStateSummary);
    expect(summary.pendingQuestion).toMatchObject({ graphRevision: 7, targetFactId: 't1' });
  });

  it('keeps the pre-#488 document contract (no empty conversationActs, acts are an unknown key)', () => {
    const preparsed = normalizeWeeklyPlanningSemanticPreParseV5({
      rawResponse: EMPTY_ENVELOPE, semanticConversationActs: false,
    }).rawResponse;
    expect(sha(preparsed)).toBe(ORACLE_EE07697E.preparse);

    const withActs = validateWeeklyPlanningSemanticResponseV5(documentJson(true), {
      currentUserText: 'なんで', conversationArchitecture: 'legacy_v5',
    });
    expect(withActs.document).toBeNull();
    expect(withActs.errors).toEqual(['document.unknown-key:conversationActs']);
    const plain = validateWeeklyPlanningSemanticResponseV5(documentJson(false), {
      currentUserText: 'なんで', conversationArchitecture: 'legacy_v5',
    });
    expect(plain.errors).toEqual([]);
    expect(plain.document).not.toBeNull();
  });
});

describe('interaction_v1 differs at exactly the boundaries #488 changed', () => {
  it('requires/prompts conversationActs and uses the typed renderer outcome', () => {
    expect(sha(JSON.stringify(semanticProviderResponseFormatV5('interaction_v1')))).not.toBe(ORACLE_EE07697E.providerFormat);
    expect(JSON.stringify(semanticProviderResponseFormatV5('interaction_v1'))).toContain('conversationActs');
    expect(createWeeklyPlanningSemanticMeaningPolicyV5('interaction_v1')).toContain('conversationActs add non-mutating');
    expect(dialoguePrompt('interaction_v1').userPrompt).toContain('conversationOutcome');
    expect(sha(dialoguePrompt('interaction_v1').systemPrompt)).toBe(ORACLE_EE07697E.dialogueSystem);
  });

  it('withholds a question that was never presented and accepts typed acts', () => {
    expect(publicStateSummary('interaction_v1').pendingQuestion).toBeNull();
    const withActs = validateWeeklyPlanningSemanticResponseV5(documentJson(true), {
      currentUserText: 'なんで', conversationArchitecture: 'interaction_v1',
    });
    expect(withActs.errors).toEqual([]);
    expect(withActs.document?.conversationActs).toHaveLength(1);
    expect(normalizeWeeklyPlanningSemanticPreParseV5({ rawResponse: EMPTY_ENVELOPE }).rawResponse)
      .toContain('"conversationActs":[]');
  });
});
