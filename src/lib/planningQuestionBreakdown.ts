import type { PlanningQuestionCode, PlanningTurnRejectionReason } from '../../shared/productObservabilityContract';
import type { ObservabilityPlanningAggregate } from '../../shared/productObservabilityReadModel';

export const PLANNING_QUESTION_LABELS: Record<PlanningQuestionCode, string> = {
  semantic_uncertainty: '計画期間の確認',
  learning_strategy_proposal: '学習方法の提案',
  quantity_role_unresolved: '量の意味の確認',
  quantity_basis_invalid: '範囲の確認',
  duplicate_quantity: '量の重複',
  completed_exceeds_total: '完了量が全体を超過',
  remaining_inconsistent: '残量の不一致',
  same_or_distinct_work: '同じ作業か別か',
  missing_effort_estimate: '所要時間の確認',
  effort_inconsistent: '見積もりの不一致',
  invalid_commitment_interval: '固定予定の時刻の確認',
  missing_schedulable_work: '作業量の確認',
};

export const PLANNING_REJECTION_LABELS: Record<PlanningTurnRejectionReason, string> = {
  provider_error: 'AIの呼び出しに失敗',
  unparseable: 'AIの応答を解析できない',
  rejected_after_repair: '修復の後も受理されない',
  rejected: 'ターンを受理できない',
  checkpoint_unreadable: '保存済みの状態を読めない',
  other: 'その他',
};

export interface PlanningBreakdownRow { key: string; label: string; count: number }
export interface PlanningBreakdown {
  /** `null` when no day of the period carried these counts: unmeasured, which is not "none happened". */
  questions: PlanningBreakdownRow[] | null;
  rejections: PlanningBreakdownRow[] | null;
  /** Days of the period that carry the counts; the others are unmeasured. */
  measuredDays: number | null;
}

function rows<T extends string>(counts: Partial<Record<T, number>> | undefined, labels: Record<T, string>): PlanningBreakdownRow[] | null {
  if (counts === undefined) return null;
  return (Object.keys(labels) as T[])
    .map(key => ({ key, label: labels[key], count: counts[key] ?? 0 }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** The counts of a period's planning aggregate as labelled rows, most frequent first; codes outside the closed lists never appear. */
export function planningBreakdown(planning: ObservabilityPlanningAggregate | undefined): PlanningBreakdown {
  return {
    questions: rows(planning?.questionCodeCounts, PLANNING_QUESTION_LABELS),
    rejections: rows(planning?.rejectionReasonCounts, PLANNING_REJECTION_LABELS),
    measuredDays: planning?.questionCountDays ?? null,
  };
}
