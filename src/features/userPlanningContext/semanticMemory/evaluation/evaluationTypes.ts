import type { UserPlanningContextRecordV1 } from '../../userPlanningContextTypes';

export const EVALUATION_QUERY_LABELS = [
  'exact_keyword_hit',
  'paraphrase',
  'abbreviation_kana_kanji_variant',
  'negative_unrelated',
  'trap_lifecycle_or_other_owner',
] as const;

export type EvaluationQueryLabel = (typeof EVALUATION_QUERY_LABELS)[number];

export interface SyntheticEvaluationQuery {
  id: string;
  ownerId: string;
  query: string;
  label: EvaluationQueryLabel;
  expectedRelevantRecordIds: string[];
  trapRecordIds: string[];
  rationale: string;
}

export interface SyntheticEvaluationCorpus {
  version: 1;
  description: string;
  owners: string[];
  records: UserPlanningContextRecordV1[];
  queries: SyntheticEvaluationQuery[];
}

export interface RetrievalRequest {
  ownerId: string;
  query: string;
  /** The evaluation corpus; each retriever must enforce owner and active status. */
  records: readonly UserPlanningContextRecordV1[];
  topK: number;
}

export interface RetrieverPreparation {
  ownerId: string;
  records: readonly UserPlanningContextRecordV1[];
}

/** A retriever returns ranked canonical record IDs, never rewritten memory text. */
export interface Retriever {
  readonly name: string;
  prepare?(input: RetrieverPreparation): Promise<void>;
  retrieve(input: RetrievalRequest): Promise<readonly string[]>;
}

export function eligibleRecordsForOwner(
  records: readonly UserPlanningContextRecordV1[],
  ownerId: string,
): UserPlanningContextRecordV1[] {
  return records.filter((record) => record.ownerId === ownerId && record.status === 'active');
}

export function normalizedTopK(topK: number): number {
  return Number.isFinite(topK) ? Math.max(0, Math.floor(topK)) : 0;
}
