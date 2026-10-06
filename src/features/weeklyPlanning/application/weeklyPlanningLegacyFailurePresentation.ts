import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { projectStableV5CompatibilityOutput } from './weeklyPlanningStableV5CompatibilityState';

/**
 * Failure presentation of the LEGACY conversation architecture (`legacy_v5`), verbatim from
 * before Issue #488 (`git show ee07697e:.../weeklyPlanningStableV5SemanticTurn.ts`).
 *
 * It exists only so the architecture comparison is honest. It keeps the old rough edges on
 * purpose: a semantic failure asks an unrelated generic question and nothing knows about the
 * pending machine question. The interaction architecture never uses this module; the
 * recovery contract test asserts that this wording stays confined to this file.
 */
export type WeeklyPlanningLegacyFailureBranch =
  | 'provider_failure'
  | 'normalization_rejected'
  | 'canonicalization_rejected';

const LEGACY_FAILURE_MESSAGES: Readonly<Record<WeeklyPlanningLegacyFailureBranch, string>> = {
  provider_failure:
    'AIに接続できなかったため、入力内容は変更していません。接続を確認してもう一度送ってください。',
  normalization_rejected:
    'こちらの処理で内容を安全に整理できなかったため、予定条件には反映していません。まず、いつの予定を作るか、または何を進めるかを一つだけ教えてください。',
  canonicalization_rejected:
    '直前の会話状態と構造化結果が一致しなかったため、変更は反映していません。直前に確認していた項目だけ、短く一つ教えてください。',
};

export function createWeeklyPlanningLegacyFailureOutput(params: {
  branch: WeeklyPlanningLegacyFailureBranch;
  previousState: PlanningIntakeState | undefined;
  userText: string;
}): WeeklyPlanningTurnExecutionResult {
  return projectStableV5CompatibilityOutput({
    previousState: params.previousState,
    userText: params.userText,
    message: LEGACY_FAILURE_MESSAGES[params.branch],
    draftCandidates: [],
    authorized: false,
  });
}
