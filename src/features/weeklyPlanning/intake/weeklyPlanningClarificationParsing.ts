import type { RequestClarificationCommand } from './weeklyPlanningCommandTypes';
import { normalizeIntakeText } from './weeklyPlanningTextParsing';

export interface ClarificationParsingContext {
  hasActiveQuestion?: boolean;
}

function normalizeClarificationText(text: string): string {
  return normalizeIntakeText(text)
    .replace(/\s+/g, '')
    .replace(/[?？!！。、]/g, '')
    .trim();
}

const DIRECT_MEANING_REQUESTS = [
  /どういう(?:こと|意味)/,
  /何(?:のこと|を意味している|を指している)/,
  /(?:って|とは|というのは)何(?:ですか|なの|の)?$/,
] as const;

const ANSWER_GUIDANCE_REQUESTS = [
  /何を(?:(?:答え|教え|言え|書(?:け|い|く))|(?:入力|記入)(?:す|し))/,
  /どう(?:(?:答え|返事し|書(?:け|い))|(?:入力|記入)(?:す|し))たら/,
  /どんな(?:ふうに|風に|感じで)?(?:答え|入力|記入|返事)/,
] as const;

const QUESTION_EXPLANATION_REQUESTS = [
  /(?:この|その|今の)?質問.*(?:説明|詳しく|具体的)/,
  /(?:それ|これ|今の).*(?:説明して|詳しく教えて|具体的に教えて)/,
  /何を(?:聞いて|尋ねて|求めて)いる/,
  /何の話/,
] as const;

const CONTEXTUAL_CONFUSION_REQUESTS = [
  /(?:この|その|今の)?質問.*(?:わから|分から|理解でき)/,
  /(?:それ|これ|今の).*(?:わから|分から|理解でき)/,
  /(?:意味|意図).*(?:わから|分から|理解でき)/,
] as const;

const BARE_FOLLOW_UP_REQUEST = /^(?:(?:よく)?(?:わからない|分からない|理解できない)|もう少し(?:詳しく|具体的に)(?:説明して|教えて)?|(?:詳しく|具体的に)(?:説明して|教えて)|説明して)$/;

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function referencesCurrentQuestion(text: string): boolean {
  return /^(?:それ|これ|今の|この質問|その質問)/.test(text)
    || matchesAny(text, ANSWER_GUIDANCE_REQUESTS)
    || matchesAny(text, QUESTION_EXPLANATION_REQUESTS)
    || matchesAny(text, CONTEXTUAL_CONFUSION_REQUESTS);
}

export function parseRequestClarificationCommand(
  userText: string,
  context: ClarificationParsingContext = {},
): RequestClarificationCommand | undefined {
  const normalizedText = normalizeClarificationText(userText);
  if (!normalizedText) return undefined;

  const explicitClarification = matchesAny(normalizedText, [
    ...DIRECT_MEANING_REQUESTS,
    ...ANSWER_GUIDANCE_REQUESTS,
    ...QUESTION_EXPLANATION_REQUESTS,
    ...CONTEXTUAL_CONFUSION_REQUESTS,
  ]);
  const contextualFollowUp = Boolean(context.hasActiveQuestion)
    && BARE_FOLLOW_UP_REQUEST.test(normalizedText);

  if (!explicitClarification && !contextualFollowUp) return undefined;

  return {
    type: 'request_clarification',
    target: referencesCurrentQuestion(normalizedText) || contextualFollowUp
      ? 'referenced_question'
      : 'referenced_term',
    ref: userText.trim(),
    sourceText: userText,
    confidence: 'high',
  };
}
