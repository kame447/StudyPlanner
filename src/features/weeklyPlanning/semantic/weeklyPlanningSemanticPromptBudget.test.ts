import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';
import {
  WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticProviderResponseFormatV5';
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
import {
  FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS,
  FOCUSED_PLANNING_WINDOW_REPAIR_RESPONSE_FORMAT_V5,
  createFocusedPlanningWindowRepairMessagesV5,
} from './weeklyPlanningFocusedPlanningWindowRepairV5';
import {
  FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
  FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
  createFocusedTemporalScopeRepairMessagesV5,
} from './weeklyPlanningFocusedTemporalScopeRepairV5';

const GENERIC_MAX_COMPLETION_TOKENS = 3200;
// PR #130 proved that optimizing these limits below the semantic contract can
// remove necessary invariants. Keep explicit headroom and fail only on material
// growth rather than forcing meaning rules back out of the prompt.
const GENERIC_MEANING_POLICY_MAX_BYTES = 2_800;
const GENERIC_SYSTEM_PROMPT_MAX_BYTES = 3_900;
const GENERIC_POLICY_OVERHEAD_MAX_BYTES = 1_100;
const FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES = 1_800;
const FOCUSED_CONTEXTUAL_REQUEST_MAX_BYTES = 1_800;
const FOCUSED_PLANNING_WINDOW_REPAIR_REQUEST_MAX_BYTES = 2_000;
const FOCUSED_TEMPORAL_SCOPE_REPAIR_REQUEST_MAX_BYTES = 2_000;

function byteLength(value: unknown): number {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).byteLength;
}

function requestBytes(params: {
  messages: Array<{ role: string; content: string }>;
  responseFormat: unknown;
  maxCompletionTokens: number;
}): number {
  return byteLength({
    model: 'gpt-5.6-luna',
    messages: params.messages,
    response_format: params.responseFormat,
    max_completion_tokens: params.maxCompletionTokens,
  });
}

function representativeGenericMessages() {
  return createWeeklyPlanningSemanticBaseMessagesV5({
    userText: '8月17日から23日で数学の問題集を40問進めたい',
    recentConversation: [{
      role: 'assistant' as const,
      content: '予定に入れたい作業を教えてください。',
    }],
    publicStateSummary: {
      planningWindows: [],
      tasks: [],
      components: [],
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      taskDateRules: [],
      recurrences: [],
      relations: [],
      uncertainties: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      pendingQuestion: null,
    },
  });
}

function focusedDocument(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'pw1',
      kind: 'absolute',
      value: '8月17日から23日',
      start: null,
      end: null,
      sourceText: '8月17日から23日',
    },
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

function representativeGenericRequestBytes(): number {
  return requestBytes({
    messages: representativeGenericMessages(),
    responseFormat: WEEKLY_PLANNING_SEMANTIC_PROVIDER_RESPONSE_FORMAT_V5,
    maxCompletionTokens: GENERIC_MAX_COMPLETION_TOKENS,
  });
}

describe('Stable V5 semantic prompt budget', () => {
  it('keeps the always-on meaning policy compact without deleting semantic invariants', () => {
    const policy = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(byteLength(policy)).toBeLessThanOrEqual(
      GENERIC_MEANING_POLICY_MAX_BYTES,
    );
    expect(
      WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.some(
        (rule) => rule.id === 'workload_quantity_effort',
      ),
    ).toBe(true);
    expect(
      WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.some(
        (rule) => rule.id === 'task_structure',
      ),
    ).toBe(true);
  });

  it('keeps supplemental orchestration policy small and scenario independent', () => {
    const meaningPolicy = createWeeklyPlanningSemanticMeaningPolicyV5();
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
    const policyOverhead = systemPrompt.slice(meaningPolicy.length);

    expect(systemPrompt.startsWith(meaningPolicy)).toBe(true);
    expect(byteLength(policyOverhead)).toBeLessThanOrEqual(
      GENERIC_POLICY_OVERHEAD_MAX_BYTES,
    );
    expect(systemPrompt).not.toContain('申請書');
    expect(systemPrompt).not.toContain('参考資料');
    expect(systemPrompt).not.toContain('weekday:tuesday, weekday:wednesday');
    expect(systemPrompt).not.toContain('Return empty availabilityDeclarations');
    expect(systemPrompt).not.toContain('selector must be active');
    expect(systemPrompt).not.toContain(
      'Do not emit application, scheduling, readiness, preview, save commands, or prose.',
    );
  });

  it('caps the always-on generic system prompt with correctness headroom', () => {
    const systemPrompt = representativeGenericMessages()[0]?.content ?? '';

    expect(byteLength(systemPrompt)).toBeLessThanOrEqual(
      GENERIC_SYSTEM_PROMPT_MAX_BYTES,
    );
  });

  it('keeps machine-state focused authorization materially smaller than generic semantic', () => {
    const genericBytes = representativeGenericRequestBytes();
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

    expect(focusedBytes).toBeLessThan(genericBytes);
    expect(focusedBytes).toBeLessThanOrEqual(FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES);
  });

  it('keeps contextual-answer focused requests compact', () => {
    const focusedBytes = requestBytes({
      messages: createFocusedContextualAnswerMessagesV5({
        userText: '3時間です',
        pendingQuestion: {
          actionId: 'q1',
          questionCode: 'missing_effort_estimate',
          targetFactId: 'workload-1',
          graphRevision: 1,
          effortMeasurement: 'duration_per_unit',
        },
        publicStateSummary: { pendingQuestion: null },
      }),
      responseFormat: FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
    });
    expect(focusedBytes).toBeLessThanOrEqual(FOCUSED_CONTEXTUAL_REQUEST_MAX_BYTES);
  });

  it('keeps focused planning-window repair compact', () => {
    const focusedBytes = requestBytes({
      messages: createFocusedPlanningWindowRepairMessagesV5({
        userText: '8月17日から23日です',
        invalidDocument: focusedDocument(),
        validationErrors: ['planningWindow:start/end missing'],
      }),
      responseFormat: FOCUSED_PLANNING_WINDOW_REPAIR_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS,
    });
    expect(focusedBytes).toBeLessThanOrEqual(FOCUSED_PLANNING_WINDOW_REPAIR_REQUEST_MAX_BYTES);
  });

  it('keeps focused temporal-scope repair compact', () => {
    const focusedBytes = requestBytes({
      messages: createFocusedTemporalScopeRepairMessagesV5({
        userText: '明日の14時から20時はバイトです',
        invalidDocument: focusedDocument(),
        validationErrors: ['availability date scope missing'],
      }),
      responseFormat: FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
    });
    expect(focusedBytes).toBeLessThanOrEqual(FOCUSED_TEMPORAL_SCOPE_REPAIR_REQUEST_MAX_BYTES);
  });
});
