/**
 * A successful provider response for controller/E2E tests whose subject is
 * typed scheduling state, not provider availability or copywriting. The real
 * Stable V5 renderer, schema parser and presentation binding still run.
 *
 * Deliberately kept in test-only code: production must never substitute a
 * scripted dialogue for failed model output.
 */
export async function successfulWeeklyPlanningRendererCompletion(
  request: { messages: readonly { content: string }[] },
): Promise<string> {
  const prompt = JSON.parse(request.messages[1].content) as {
    actionId: string;
    currentUserMessage: string;
    applicationDecision: {
      actionKind: 'question' | 'status' | 'preview_ready';
      questionCode: string | null;
      questionIntent?: {
        kind?: string;
        proposalKind?: string;
        measurement?: 'session_duration' | 'duration_per_unit' | 'total_duration';
        quantityRole?: string;
        amount?: number;
        unitLabel?: string | null;
      };
      previewPromotionControlLabel?: string | null;
    };
    currentTurnGrounding?: {
      mode: string;
      acceptedFacts: Array<{
        factId: string;
        sourceText: string;
      }>;
    };
  };
  const decision = prompt.applicationDecision;
  const grounding = prompt.currentTurnGrounding;
  const requiredAcknowledgement = grounding?.mode === 'required_before_resume'
    ? grounding.acceptedFacts.find(fact => fact.sourceText?.trim() && fact.factId)
    : undefined;
  const acknowledgementText = requiredAcknowledgement
    ? `「${requiredAcknowledgement.sourceText}」について確認しました。`
    : null;
  const acknowledgement = requiredAcknowledgement
    ? {
        factIds: [requiredAcknowledgement.factId],
        text: acknowledgementText!,
      }
    : null;

  const question = decision.questionIntent?.kind === 'learning_strategy_proposal'
    ? 'この学習方法を採用しますか？'
    : decision.questionIntent?.kind === 'effort_measurement'
      ? decision.questionIntent.measurement === 'duration_per_unit'
        ? `1${decision.questionIntent.unitLabel ?? '単位'}あたりどれくらい時間がかかりますか？`
        : decision.questionIntent.quantityRole === 'completed'
          ? `完了した${decision.questionIntent.amount}${decision.questionIntent.unitLabel ?? ''}には、合計でどれくらい時間がかかりましたか？`
          : '一回の作業にかかる時間を教えてください.'
      : decision.questionCode === 'missing_schedulable_work'
        ? '今回進めたい範囲を教えてください。'
        : '続けるために必要な条件を教えてください。';
  const lead = acknowledgementText ?? `「${prompt.currentUserMessage}」について確認しました。`;
  const text = decision.actionKind === 'preview_ready'
    ? `${lead}候補の内容を確認してください。${decision.previewPromotionControlLabel ?? ''}`
    : decision.actionKind === 'question'
      ? `${lead}${question}`
      : `${lead}続けて相談できます。`;

  return JSON.stringify({
    actionId: prompt.actionId,
    actionKind: decision.actionKind,
    questionCode: decision.questionCode,
    groundingAcknowledgement: acknowledgement,
    text,
  });
}
