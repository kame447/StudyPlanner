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

const taskIdentityAction: AllowedDialogueAction = {
  actionId: 'ask:task-identity:1',
  kind: 'ask_required_fact',
  topicId: 'task-identity',
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

  it('accepts a task-identity action only when the text asks what to study', () => {
    expect(validateBehaviorAwareDialogueResponseClosed({
      response: {
        selectedActionIds: [taskIdentityAction.actionId],
        items: [{
          actionId: taskIdentityAction.actionId,
          text: 'この期間に何をどこまで進めたいか教えてください。',
        }],
      },
      actions: [taskIdentityAction],
      previewAllowed: false,
    })).toMatchObject({
      selectedActionIds: [taskIdentityAction.actionId],
    });
  });

  it('rejects a task-identity action that skips the learning content question', () => {
    expect(validateBehaviorAwareDialogueResponseClosed({
      response: {
        acknowledgement: 'ここまでの内容から、無理のない進め方を整理します。',
        selectedActionIds: [taskIdentityAction.actionId],
        items: [{
          actionId: taskIdentityAction.actionId,
          text: '予定へ大きく影響する条件をもう少し確認させてください。',
        }],
      },
      actions: [taskIdentityAction],
      previewAllowed: false,
    })).toBeNull();
  });

  it('rejects an ungrounded filler acknowledgement even when the question is valid', () => {
    expect(validateBehaviorAwareDialogueResponseClosed({
      response: {
        acknowledgement: 'ここまでの内容から、無理のない進め方を整理します。',
        selectedActionIds: [taskIdentityAction.actionId],
        items: [{
          actionId: taskIdentityAction.actionId,
          text: 'この期間に何をどこまで進めたいか教えてください。',
        }],
      },
      actions: [taskIdentityAction],
      previewAllowed: false,
    })).toBeNull();
  });
});
