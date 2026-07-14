import { describe, expect, it } from 'vitest';
import type { AllowedDialogueAction } from '../planning/weeklyPlanningBehaviorTypes';
import {
  validateBehaviorAwareDialogueResponseClosed,
} from './weeklyPlanningBehaviorAwareDialogueValidation';

const action: AllowedDialogueAction = {
  actionId: 'ask:deadline:3',
  kind: 'ask_required_fact',
  topicId: 'deadline',
  sourceFactRefs: [],
  allowedProposalRefs: [],
  allowedOptionIds: [],
  maxItems: 1,
};

function validResponse() {
  return {
    acknowledgement: '英単語の予定について確認しました。',
    selectedActionIds: [action.actionId],
    items: [{
      actionId: action.actionId,
      text: '小テストの日付を教えてください。',
    }],
  };
}

describe('behavior-aware dialogue closed validation', () => {
  it('accepts a grounded response with a one-to-one allowed action mapping', () => {
    expect(validateBehaviorAwareDialogueResponseClosed({
      response: validResponse(),
      actions: [action],
      previewAllowed: false,
    })).toMatchObject({
      selectedActionIds: [action.actionId],
    });
  });

  it('rejects unknown top-level and item properties', () => {
    expect(validateBehaviorAwareDialogueResponseClosed({
      response: { ...validResponse(), readiness: 'preview_ready' },
      actions: [action],
      previewAllowed: false,
    })).toBeNull();

    expect(validateBehaviorAwareDialogueResponseClosed({
      response: {
        ...validResponse(),
        items: [{
          actionId: action.actionId,
          text: '小テストの日付を教えてください。',
          sourceFactRefs: ['fact-1'],
        }],
      },
      actions: [action],
      previewAllowed: false,
    })).toBeNull();
  });

  it('rejects a completed-preview claim without an allowed generate action', () => {
    expect(validateBehaviorAwareDialogueResponseClosed({
      response: {
        ...validResponse(),
        acknowledgement: '仮予定を作成しました。',
      },
      actions: [action],
      previewAllowed: false,
    })).toBeNull();
  });
});
