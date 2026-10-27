import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS } from './weeklyPlanningSemanticNormalizerRunV5';
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

const baselinePendingEffort = { questionCode: 'missing_effort_estimate', graphRevision: 2,
  targetFactId: 'math-work', effortMeasurement: 'duration_per_unit' };
// Full message-array hashes after the reviewed #866 registration-act instruction.
// Every other instruction and the byte ceilings retain their prior contract.
it.each([
  ['5', baselinePendingEffort, '28c09d453c9f004c04e4e807dd36b9cae4618aad16a8467a7ae6fc078c592c14'],
  ['5分', baselinePendingEffort, 'd4fba50abe25b45c284a5b5e5e5fb8d86d1e134360ddb5012d0ef3b8c02a82c3'],
  ['15分。あと英語の締切を金曜にして', baselinePendingEffort, 'ce7d2fbb6d93fe4b5d7411fab4a2f91845a7aab26a129179973be3881f0f2c82'],
  ['全部で60分', baselinePendingEffort, '4e8f0999f3049a4c17316fa7e67858e0304a2ac835552d1cbd519ef1f7e1c658'],
  ['15分くらい', baselinePendingEffort, '8d867732d691d9cdf82a6dbe919c9370831544074007f2cac7dd815ee89a2b1a'],
  ['5', { ...baselinePendingEffort, graphRevision: 1 }, 'ff172a5f30c7964bc0a9e5f100a753c3d1c6f685a91cd8d195530db84bcf8708'],
  ['5', { questionCode: 'quantity_role_unresolved', graphRevision: 2 }, '000356fd4dd14b5b60b8476b421ae6f8c62e3b485e00653d48038f4e8888a5d0'],
  ['5', null, 'ff04e2b11ecd1ce66aa5564a888a3d512e6f5d0d98d1dae30d4b655ec6a1345a'],
] as const)('pins the reviewed registration-act prompt bytes for %s / %j', (userText, pendingQuestion, sha256) => {
  const messages = createWeeklyPlanningSemanticBaseMessagesV5({ userText, publicStateSummary: { graphRevision: 2, pendingQuestion } });
  expect(createHash('sha256').update(JSON.stringify(messages)).digest('hex')).toBe(sha256);
});

const GENERIC_MAX_COMPLETION_TOKENS = SEMANTIC_NORMALIZER_V5_MAX_COMPLETION_TOKENS;
// Measured sizes with the Issue #152 trust-boundary policy and decision-target
// sentence: 4,667 B policy, 7,776 B generic system prompt, and 3,109 B
// supplemental policy overhead.
// Ceilings keep roughly 10% headroom rounded up to 50 bytes; they remain growth
// guards, not compaction targets. PR #130 showed that forcing the budget lower
// can delete application-critical meaning.
const GENERIC_MEANING_POLICY_MAX_BYTES = 5_150;
const GENERIC_SYSTEM_PROMPT_MAX_BYTES = 8_600;
const GENERIC_POLICY_OVERHEAD_MAX_BYTES = 3_450;
const FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES = 1_800;
// The focused response schema now carries target and measurement as separate
// typed axes. Keep enough room for that contract while still requiring this
// route to remain materially smaller than generic semantic normalization.
const FOCUSED_CONTEXTUAL_REQUEST_MAX_BYTES = 3_200;
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

function representativeFocusedContextualMessages() {
  return createFocusedContextualAnswerMessagesV5({
    userText: '残りは45分くらいです',
    publicStateSummary: {
      pendingQuestion: {
        questionCode: 'missing_effort_estimate',
        targetFactId: 'workload-completed',
        graphRevision: 4,
        effortMeasurement: 'total_duration',
        estimateForWorkloadFactId: 'workload-remaining',
        questionBasis: 'completed_workload_total',
      },
      tasks: [{
        publicId: 'task-report',
        category: 'study',
        title: 'ゼミ発表の資料を完成させる',
      }],
      components: [],
      workloads: [
        {
          publicId: 'workload-completed',
          taskPublicId: 'task-report',
          componentPublicId: null,
          quantityRole: 'completed',
          amount: 70,
          unitCode: 'custom',
          unitLabel: '%',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
        },
        {
          publicId: 'workload-remaining',
          taskPublicId: 'task-report',
          componentPublicId: null,
          quantityRole: 'remaining',
          amount: 30,
          unitCode: 'custom',
          unitLabel: '%',
          rangeStart: null,
          rangeEnd: null,
          perOccurrence: false,
          periodExpression: null,
        },
      ],
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
  it('keeps the always-on meaning policy compact', () => {
    const policy = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(byteLength(policy)).toBeLessThanOrEqual(
      GENERIC_MEANING_POLICY_MAX_BYTES,
    );
    expect(
      WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.some(
        (rule) => rule.id === 'workload_quantity_effort',
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

  it('caps the always-on generic system prompt itself', () => {
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

    expect(focusedBytes).toBeLessThanOrEqual(
      FOCUSED_AUTHORIZATION_REQUEST_MAX_BYTES,
    );
    expect(focusedBytes).toBeLessThan(genericBytes / 4);
  });

  it('keeps exact pending-answer interpretation bounded on a real two-target effort context', () => {
    const genericBytes = representativeGenericRequestBytes();
    const messages = representativeFocusedContextualMessages();
    expect(messages).not.toEqual([]);
    const focusedBytes = requestBytes({
      messages,
      responseFormat: FOCUSED_CONTEXTUAL_ANSWER_RESPONSE_FORMAT_V5,
      maxCompletionTokens: FOCUSED_CONTEXTUAL_ANSWER_MAX_COMPLETION_TOKENS,
    });

    expect(focusedBytes).toBeLessThanOrEqual(
      FOCUSED_CONTEXTUAL_REQUEST_MAX_BYTES,
    );
    expect(focusedBytes).toBeLessThan(genericBytes / 3);
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
