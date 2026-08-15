import { describe, expect, it } from 'vitest';
import {
  fallbackTextForStableV5TypedIntent,
} from './weeklyPlanningStableV5TurnDialogue';

describe('Stable V5 typed dialogue fallback', () => {
  it('builds only an emergency proposal fallback from structured memory intent', () => {
    expect(fallbackTextForStableV5TypedIntent({
      applicationText: '',
      questionIntent: {
        kind: 'learning_strategy_proposal',
        proposalKind: 'spaced_memory_practice',
        targetFactId: 'workload-1',
        suggestedSessionDurationMinutes: { min: 15, max: 30 },
        spacingInterval: 'not_yet_selected',
        rationale: 'distributed_retrieval_supports_retention',
        decisionRequested: 'accept_or_reject',
      },
    })).toBe('分散学習の提案（1回15〜30分）について、採用するか教えてください。');
  });

  it('builds only an emergency calibration fallback from the selected session duration', () => {
    expect(fallbackTextForStableV5TypedIntent({
      applicationText: '',
      questionIntent: {
        kind: 'learning_strategy_proposal',
        proposalKind: 'calibrate_memory_pace',
        targetFactId: 'workload-1',
        suggestedSessionDurationMinutes: { min: 20, max: 20 },
        selectedSessionDurationMinutes: 20,
        sessionDurationMinutes: 20,
        measurementPlan: {
          observation: 'progress_during_single_session',
          objective: 'measure_personal_pace',
          futureUse: 'personalize_future_session_planning',
        },
        decisionRequested: 'accept_or_reject',
      },
    })).toBe('学習ペース計測の提案（20分）について、採用するか教えてください。');
  });

  it('uses typed session-duration meaning instead of vocabulary-specific wording', () => {
    expect(fallbackTextForStableV5TypedIntent({
      applicationText: '',
      questionIntent: {
        kind: 'effort_measurement',
        measurement: 'session_duration',
        quantityRole: 'target',
        targetFactId: 'workload-1',
        amount: 100,
        unitCode: 'item',
        unitLabel: '項目',
      },
    })).toBe('1回の学習時間を教えてください。');
  });

  it('preserves the existing application fallback for unrelated dialogue intents', () => {
    expect(fallbackTextForStableV5TypedIntent({
      applicationText: '既存のfallback',
      questionIntent: null,
    })).toBe('既存のfallback');
  });
});
