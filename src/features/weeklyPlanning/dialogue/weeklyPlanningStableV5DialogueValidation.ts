import {
  groundedDateExpressionsFromPlanningInformation,
} from './weeklyPlanningDialogueDateGrounding';
import type {
  WeeklyPlanningStableV5DialogueFallbackReason,
  WeeklyPlanningStableV5DialogueRenderInput,
  WeeklyPlanningStableV5DialogueRenderResult,
} from './weeklyPlanningStableV5DialogueContracts';

const MAX_RENDERED_TEXT_LENGTH = 800;
const FORBIDDEN_CONTENT = /https?:\/\/|(?:パスワード|暗証番号|秘密情報|APIキー|アクセストークン|口座番号|クレジットカード)/i;
const CLOCK_EXPRESSION = /(?:[01]?\d|2[0-3])[:：][0-5]\d|(?:午前|午後)?\s*(?:[01]?\d|2[0-3])\s*時(?:\s*[0-5]?\d\s*分)?/g;
const DATE_EXPRESSION = /(?:今日|明日|明後日|今週|来週|週末)|\d{1,2}\s*月\s*\d{1,2}\s*日/g;
const PREVIEW_COUNT_EXPRESSION = /(\d+)\s*件/g;
const EXECUTION_VERB = '(?:作ります|作成します|追加します|登録します|保存します|組みます|反映します|入れます|入れました|入れておきます)';
const EXECUTION_CLAIM_EXPRESSION = new RegExp(
  `(?:(?:予定|仮予定|計画).{0,20}${EXECUTION_VERB}|${EXECUTION_VERB}.{0,20}(?:予定|仮予定|計画))`,
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProtectedExpression(value: string): string {
  return value.replace(/[\s：]/g, '').replace(/:/g, '');
}

function normalizeDialogueText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function expressions(value: string, pattern: RegExp): string[] {
  return [...value.matchAll(pattern)].map((match) => normalizeProtectedExpression(match[0]));
}

function addsUnsupportedExpression(
  rendered: string,
  groundingInformation: string,
  pattern: RegExp,
  additionalAllowedValues: readonly string[] = [],
): boolean {
  const allowed = new Set(expressions(groundingInformation, pattern));
  for (const value of additionalAllowedValues) {
    for (const expression of expressions(value, pattern)) {
      allowed.add(expression);
    }
  }
  return expressions(rendered, pattern).some((expression) => !allowed.has(expression));
}

function hasIncorrectPreviewCount(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (input.actionKind !== 'preview_ready') return false;
  const mentionedCounts = [...text.matchAll(PREVIEW_COUNT_EXPRESSION)]
    .map((match) => Number(match[1]));
  return mentionedCounts.some((count) => count !== input.previewCount);
}

function missesPreviewPromotionControl(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  return input.actionKind === 'preview_ready'
    && typeof input.previewPromotionControlLabel === 'string'
    && input.previewPromotionControlLabel.length > 0
    && !text.includes(input.previewPromotionControlLabel);
}

function claimsUnexecutedAction(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  return input.actionKind !== 'preview_ready'
    && EXECUTION_CLAIM_EXPRESSION.test(text)
    && !/[?？]|(?:ますか|でしょうか)/.test(text);
}

function repeatsMostRecentAssistantQuestion(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  if (input.actionKind !== 'question') return false;
  const previousAssistant = [...input.recentConversation]
    .reverse()
    .find((turn) => turn.role === 'assistant');
  if (!previousAssistant) return false;
  const previousText = normalizeDialogueText(previousAssistant.content);
  const currentText = normalizeDialogueText(text);
  return previousText.length > 0 && currentText === previousText;
}

function groundingAcknowledgementMismatch(
  value: unknown,
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): boolean {
  const mode = input.currentTurnGrounding?.mode ?? 'none';
  if (value === undefined || value === null) {
    return mode === 'required_before_resume';
  }
  if (!isRecord(value)) return true;
  if (mode === 'none') return true;

  const factIds = value.factIds;
  const acknowledgementText = value.text;
  if (
    !Array.isArray(factIds)
    || factIds.length === 0
    || !factIds.every((factId) => typeof factId === 'string' && factId.length > 0)
    || typeof acknowledgementText !== 'string'
    || normalizeDialogueText(acknowledgementText).length === 0
  ) {
    return true;
  }

  const acceptedFactIds = new Set(
    (input.currentTurnGrounding?.acceptedFacts ?? []).map((fact) => fact.factId),
  );
  if (
    acceptedFactIds.size === 0
    || factIds.some((factId) => !acceptedFactIds.has(factId as string))
  ) {
    return true;
  }

  return !normalizeDialogueText(text).startsWith(
    normalizeDialogueText(acknowledgementText),
  );
}

function validateRenderedText(
  text: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueFallbackReason | null {
  if (
    text.length === 0
    || text.length > MAX_RENDERED_TEXT_LENGTH
    || FORBIDDEN_CONTENT.test(text)
  ) {
    return 'unsafe_text';
  }

  if (missesPreviewPromotionControl(text, input)) {
    return 'action_contract_mismatch';
  }

  if (repeatsMostRecentAssistantQuestion(text, input)) {
    return 'repeated_question_text';
  }

  const groundingInformation = JSON.stringify({
    currentUserMessage: input.currentUserMessage,
    recentConversation: input.recentConversation,
    planningInformation: input.planningInformation,
    requiredLabels: input.requiredLabels,
    previewPromotionControlLabel: input.previewPromotionControlLabel ?? null,
    previewCount: input.previewCount,
  });
  const groundedDateExpressions = groundedDateExpressionsFromPlanningInformation(
    input.planningInformation,
  );
  if (
    addsUnsupportedExpression(text, groundingInformation, CLOCK_EXPRESSION)
    || addsUnsupportedExpression(
      text,
      groundingInformation,
      DATE_EXPRESSION,
      groundedDateExpressions,
    )
    || hasIncorrectPreviewCount(text, input)
    || claimsUnexecutedAction(text, input)
  ) {
    return 'ungrounded_text';
  }

  return null;
}

export function parseWeeklyPlanningStableV5DialogueRendererResponse(
  rawResponse: string,
  input: WeeklyPlanningStableV5DialogueRenderInput,
): WeeklyPlanningStableV5DialogueRenderResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawResponse);
  } catch {
    return { status: 'fallback', reason: 'invalid_json', rawResponse };
  }

  if (
    !isRecord(parsed)
    || typeof parsed.actionId !== 'string'
    || typeof parsed.actionKind !== 'string'
    || (parsed.questionCode !== null && typeof parsed.questionCode !== 'string')
    || typeof parsed.text !== 'string'
  ) {
    return { status: 'fallback', reason: 'invalid_shape', rawResponse };
  }

  if (parsed.actionId !== input.actionId) {
    return { status: 'fallback', reason: 'action_mismatch', rawResponse };
  }
  if (
    parsed.actionKind !== input.actionKind
    || parsed.questionCode !== input.questionCode
  ) {
    return { status: 'fallback', reason: 'action_contract_mismatch', rawResponse };
  }

  const text = parsed.text.replace(/\r\n/g, '\n').trim();
  if (groundingAcknowledgementMismatch(
    parsed.groundingAcknowledgement,
    text,
    input,
  )) {
    return { status: 'fallback', reason: 'grounding_contract_mismatch', rawResponse };
  }

  const validationError = validateRenderedText(text, input);
  if (validationError) {
    return { status: 'fallback', reason: validationError, rawResponse };
  }

  return { status: 'rendered', text, rawResponse };
}
