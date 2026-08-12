import { describe, expect, it } from 'vitest';
import type {
  WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
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
const GENERIC_SYSTEM_PROMPT_MAX_BYTES = 9_000;
const GENERIC_REQUEST_MAX_BYTES = 23_000;
const GENERIC_POLICY_OVERHEAD_MAX_BYTES = 2_200;
const FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES = 2_500;
const FOCUSED_CONTEXTUAL_REQUEST_MAX_BYTES = 4_000;
const FOCUSED_PLANNING_WINDOW_REPAIR_REQUEST_MAX_BYTES = 2_000;
const FOCUSED_TEMPORAL_SCOPE_REPAIR_REQUEST_MAX_BYTES = 2_000;

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
      calendarContext: {
        currentDate: '2026-08-12',
        timeZone: 'Asia/Tokyo',
      },
      episodicMemory: {
        version: 'weekly-planning-episodic-memory-v5',
        items: [],
      },
    },
  });
}

function invalidPlanningWindowDocument(): WeeklyPlanningSemanticDocumentV5 {
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
  });

  it('caps the always-on generic system prompt itself', () => {
    const systemPrompt = representativeGenericMessages()[0]?.content ?? '';

    expect(byteLength(systemPrompt)).toBeLessThanOrEqual(
      GENERIC_SYSTEM_PROMPT_MAX_BYTES,
    );
  });

  it('caps the actual representative generic request including hardened provider schema and calendar context', () => {
    expect(representativeGenericRequestBytes()).toBeLessThanOrEqual(
      GENERIC_REQUEST_MAX_BYTES,
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

    expect(focusedBytes).toBeLessThanOrEqual(
      FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES,
    );
    expect(focusedBytes).toBeLessThan(genericBytes / 4);
  });

  it('keeps exact pending-answer interpretation materially smaller than generic semantic', () => {
    const genericBytes = representativeGenericRequestBytes();
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

  it('keeps planning-window representation repair tiny and evidence-local', () => {
    const genericBytes = representativeGenericRequestBytes();
    const focusedBytes = requestBytes({
      messages: createFocusedPlanningWindowRepairMessagesV5({
        userText: '8月17日から23日で、英単語220語も進めたいです',
        invalidDocument: invalidPlanningWindowDocument(),
        validationErrors: ['document.planningWindow:absolute-range'],
        calendarContext: {
          currentDate: '2026-08-12',
          timeZone: 'Asia/Tokyo',
        },
      }),
      responseFormat: FOCUSED_PLANNING_WINDOW_REPAIR_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_PLANNING_WINDOW_REPAIR_MAX_COMPLETION_TOKENS,
    });

    expect(focusedBytes).toBeLessThanOrEqual(
      FOCUSED_PLANNING_WINDOW_REPAIR_REQUEST_MAX_BYTES,
    );
    expect(focusedBytes).toBeLessThan(genericBytes / 8);
  });

  it('keeps temporal-scope repair tiny instead of regenerating the semantic document', () => {
    const genericBytes = representativeGenericRequestBytes();
    const focusedBytes = requestBytes({
      messages: createFocusedTemporalScopeRepairMessagesV5({
        taskIndex: 1,
        constraintIndex: 0,
        taskTitle: '数学の問題を進める',
        taskLocalId: 't2',
        constraintLocalId: 'tc1',
        sourceText: '火曜日の18時から20時は予定があるので避けてください',
        dateExpression: 'weekday:tuesday',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
        constraintLevel: 'hard',
      }),
      responseFormat: FOCUSED_TEMPORAL_SCOPE_REPAIR_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_TEMPORAL_SCOPE_REPAIR_MAX_COMPLETION_TOKENS,
    });

    expect(focusedBytes).toBeLessThanOrEqual(
      FOCUSED_TEMPORAL_SCOPE_REPAIR_REQUEST_MAX_BYTES,
    );
    expect(focusedBytes).toBeLessThan(genericBytes / 8);
  });
});
