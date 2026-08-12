import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

const EXPLANATION_REQUEST_EXPRESSION = /(?:どういう(?:こと|意味)|なぜ|なんで|理由|説明して|説明してください|分からない|わからない|つまり)/;

export function isWeeklyPlanningStableV5DialogueExplanationRequest(
  currentUserMessage: string,
): boolean {
  return EXPLANATION_REQUEST_EXPRESSION.test(currentUserMessage);
}

export function shouldUseAiWeeklyPlanningStableV5DialogueRenderer(
  input: Pick<
    WeeklyPlanningStableV5DialogueRenderInput,
    'actionKind' | 'questionCode' | 'currentUserMessage'
  >,
): boolean {
  if (input.actionKind !== 'question' || input.questionCode === null) {
    return true;
  }

  return isWeeklyPlanningStableV5DialogueExplanationRequest(input.currentUserMessage);
}
