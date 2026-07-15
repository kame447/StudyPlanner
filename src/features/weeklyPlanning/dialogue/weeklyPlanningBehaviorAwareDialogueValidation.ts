import {
  validateBehaviorAwareDialogueResponseStrict,
} from '../planning/weeklyPlanningBehaviorSafety';
import type {
  AllowedDialogueAction,
  BehaviorAwareDialogueResponse,
} from '../planning/weeklyPlanningBehaviorTypes';

const TOP_LEVEL_KEYS = new Set([
  'acknowledgement',
  'selectedActionIds',
  'items',
  'reasoningSummary',
]);
const ITEM_KEYS = new Set(['actionId', 'text', 'optionIds']);
const PREVIEW_COMPLETION_CLAIM = /(?:仮予定|プレビュー).*(?:作成しました|作りました|生成しました|できました)/;
const TASK_IDENTITY_QUESTION = /(?:何を|学習内容|教材|課題|目標|教科|科目|どこまで)/;
const UNGROUNDED_ACKNOWLEDGEMENT = /^(?:ここまでの内容から、)?無理のない進め方を整理します。?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function containsUnknownKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}

function userVisibleTexts(response: BehaviorAwareDialogueResponse): string[] {
  return [
    response.acknowledgement,
    ...response.items.map((item) => item.text),
    response.reasoningSummary,
  ].filter((value): value is string => typeof value === 'string');
}

function hasUngroundedTaskIdentityQuestion(params: {
  response: BehaviorAwareDialogueResponse;
  actions: AllowedDialogueAction[];
}): boolean {
  const actionById = new Map(params.actions.map((action) => [action.actionId, action]));

  return params.response.items.some((item) => {
    const action = actionById.get(item.actionId);
    return action?.kind === 'ask_required_fact'
      && action.topicId === 'task-identity'
      && !TASK_IDENTITY_QUESTION.test(item.text);
  });
}

export function validateBehaviorAwareDialogueResponseClosed(params: {
  response: unknown;
  actions: AllowedDialogueAction[];
  previewAllowed: boolean;
}): BehaviorAwareDialogueResponse | null {
  if (!isRecord(params.response) || containsUnknownKeys(params.response, TOP_LEVEL_KEYS)) {
    return null;
  }
  if (!Array.isArray(params.response.items)) return null;
  if (params.response.items.some((item) =>
    !isRecord(item) || containsUnknownKeys(item, ITEM_KEYS),
  )) {
    return null;
  }

  const validated = validateBehaviorAwareDialogueResponseStrict(params);
  if (!validated) return null;

  if (
    typeof validated.acknowledgement === 'string'
    && UNGROUNDED_ACKNOWLEDGEMENT.test(validated.acknowledgement.trim())
  ) {
    return null;
  }

  if (hasUngroundedTaskIdentityQuestion({
    response: validated,
    actions: params.actions,
  })) {
    return null;
  }

  const selectedGeneratePreview = validated.selectedActionIds.some((actionId) =>
    params.actions.some((action) =>
      action.actionId === actionId && action.kind === 'generate_preview',
    ),
  );
  const hasPreviewCompletionClaim = userVisibleTexts(validated).some((text) =>
    PREVIEW_COMPLETION_CLAIM.test(text),
  );
  if (hasPreviewCompletionClaim && (!params.previewAllowed || !selectedGeneratePreview)) {
    return null;
  }

  return validated;
}
