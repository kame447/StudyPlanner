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
// Entire message-array UTF-8 bytes generated from Git object22e42203a4df82b5432d4290b7b5ea3a4246b8c9.
// Pin the baseline independently of current assembly, without requiring Git history in CI.
it.each([
  ['5', baselinePendingEffort, 'd987f3301fcf973391beae941f403553335078f70825a894d8da4e0e042aace5'],
  ['5分', baselinePendingEffort, 'f3906375232e1a455cc023247b3fab48e25906faecc302ed45f1c48d38055dc5'],
  ['15分。あと英語の締切を金曜にして', baselinePendingEffort, 'f8b55c0e878418566b48f4705a722efd394fd27cf4a72ce527942cc0dbdb9b19'],
  ['全部で60分', baselinePendingEffort, '35e00d933c1ae0da2a549010a9deda87da11fa9af7f096903d42ebe20b3b30b6'],
  ['15分くらい', baselinePendingEffort, '67b57f971a165707b7ec0ce365f8ec714f774ecf9bd1241f0a1c10935b52f0e0'],
  ['5', { ...baselinePendingEffort, graphRevision: 1 }, '1f64276bf1b6155835b015eea62342d538b22b8adc4920360d02e12b592c4ed7'],
  ['5', { questionCode: 'quantity_role_unresolved', graphRevision: 2 }, '5b11346e7d74775901c8eb8b0ab1ecee63f263e549bd09571036104c52a425a0'],
  ['5', null, '21401918ddf4407830955a8cc5f832c69134e9588569dc93658b261e0a21158b'],
] as const)('keeps generic prompt bytes identical to22e42203 for %s / %j', (userText, pendingQuestion, sha256) => {
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
