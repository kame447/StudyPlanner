import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticBaseMessagesV5,
} from './weeklyPlanningSemanticNormalizerV5';
import {
  FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
  FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
  createFocusedAuthorizationMessagesV5,
} from './weeklyPlanningFocusedAuthorizationV5';
import {
  FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
  FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
  createFocusedContextualAnswerMessagesV5,
} from './weeklyPlanningFocusedContextualAnswerV5';

const GENERIC_MAX_COMPLETION_TOKENS = 3200;
const GENERIC_SYSTEM_PROMPT_MAX_BYTES = 11_000;
const GENERIC_REQUEST_MAX_BYTES = 24_000;
const FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES = 2_500;
const FOCUSED_CONTEXTUAL_REQUEST_MAX_BYTES = 4_000;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(
    typeof value === 'string' ? value : JSON.stringify(value),
  ).byteLength;
}

function requestBytes(params: {
  messages: Array<{ role: string; content: string }>;
  responseFormat: unknown;
  maxCompletionTokens: number;
}): number {
  return byteLength({
    messages: params.messages,
    temperature: 0,
    responseFormat: params.responseFormat,
    purpose: 'weekly_planning_semantic_normalizer',
    maxCompletionTokens: params.maxCompletionTokens,
  });
}

function representativeGenericMessages() {
  return createWeeklyPlanningSemanticBaseMessagesV5({
    userText: '8月17日から23日で、英単語220語と数学の問題40問を進める予定を作りたいです。火曜日の18時から20時は予定があるので避けてください。',
    recentConversation: [],
    publicStateSummary: {
      runtime: 'weekly-planning-stable-v5',
      graphRevision: 0,
      previousCompatibilityStatus: null,
      pendingQuestion: null,
      groundingRecords: [],
      repairAgenda: [],
      planningWindows: [],
      tasks: [],
      components: [],
      workloads: [],
      uncertainties: [],
      userPlanningContext: [],
      lastAssistantMessage: null,
      effortEstimates: [],
      temporalConstraints: [],
      recurrences: [],
      episodicMemory: {
        version: 'weekly-planning-episodic-memory-v5',
        items: [],
      },
    },
  });
}

describe('Stable V5 semantic prompt budget', () => {
  it('keeps normalizer policy overhead small and scenario independent', () => {
    const corePrompt = createWeeklyPlanningSemanticSystemPromptV5();
    const messages = createWeeklyPlanningSemanticBaseMessagesV5({
      userText: '申請書を2件、参考資料を4ページ確認したいです',
      recentConversation: [
        { role: 'user', content: '来週の作業を整理したいです' },
      ],
      publicStateSummary: {
        pendingQuestion: null,
      },
    });
    const systemPrompt = messages[0]?.content ?? '';
    const policyOverhead = systemPrompt.slice(corePrompt.length);

    expect(systemPrompt.startsWith(corePrompt)).toBe(true);
    expect(byteLength(policyOverhead)).toBeLessThanOrEqual(2500);
    expect(systemPrompt).not.toContain('申請書');
    expect(systemPrompt).not.toContain('参考資料');
    expect(systemPrompt).not.toContain('Do not drop a later coordinated item');
    expect(systemPrompt).not.toContain('split the independent subjects');
    expect(systemPrompt).not.toContain('次の日, 翌日, and 明日 mean tomorrow');
  });

  it('caps the always-on generic system prompt itself', () => {
    const systemPrompt = representativeGenericMessages()[0]?.content ?? '';

    expect(byteLength(systemPrompt)).toBeLessThanOrEqual(
      GENERIC_SYSTEM_PROMPT_MAX_BYTES,
    );
  });

  it('caps a representative full generic semantic request including JSON schema', () => {
    const bytes = requestBytes({
      messages: representativeGenericMessages(),
      responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
      maxCompletionTokens: GENERIC_MAX_COMPLETION_TOKENS,
    });

    expect(bytes).toBeLessThanOrEqual(GENERIC_REQUEST_MAX_BYTES);
  });

  it('keeps machine-state focused authorization materially smaller than generic semantic', () => {
    const genericBytes = requestBytes({
      messages: representativeGenericMessages(),
      responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
      maxCompletionTokens: GENERIC_MAX_COMPLETION_TOKENS,
    });
    const focusedBytes = requestBytes({
      messages: createFocusedAuthorizationMessagesV5({
        userText: 'この条件で作って',
        publicStateSummary: {
          previousCompatibilityStatus: 'needs_scope',
          pendingQuestion: null,
          tasks: [{ publicId: 'task-1' }],
          lastAssistantMessage: '条件はそろっています。',
        },
      }),
      responseFormat: FOCUSED_AUTHORIZATION_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_AUTHORIZATION_MAX_COMPLETION_TOKENS,
    });

    expect(focusedBytes).toBeLessThanOrEqual(
      FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES,
    );
    expect(focusedBytes).toBeLessThan(genericBytes / 4);
  });

  it('keeps exact pending-answer interpretation materially smaller than generic semantic', () => {
    const genericBytes = requestBytes({
      messages: representativeGenericMessages(),
      responseFormat: WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
      maxCompletionTokens: GENERIC_MAX_COMPLETION_TOKENS,
    });
    const focusedBytes = requestBytes({
      messages: createFocusedContextualAnswerMessagesV5({
        userText: '30分くらいです',
        publicStateSummary: {
          pendingQuestion: {
            questionCode: 'missing_effort_estimate',
            targetFactId: 'workload-1',
            graphRevision: 3,
          },
          workloads: [{
            publicId: 'workload-1',
            amount: 220,
            unitCode: 'word',
            unitLabel: '語',
            quantityRole: 'target',
          }],
        },
      }),
      responseFormat: FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
    });

    expect(focusedBytes).toBeLessThanOrEqual(
      FOCUSED_CONTEXTUAL_REQUEST_MAX_BYTES,
    );
    expect(focusedBytes).toBeLessThan(genericBytes / 4);
  });
});
