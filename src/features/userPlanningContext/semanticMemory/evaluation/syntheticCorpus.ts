import rawCorpus from './fixtures/japaneseSyntheticCorpus.v1.json';
import rawHoldout from './fixtures/japaneseSyntheticQueries.holdout.v1.json';
import type { SyntheticEvaluationCorpus } from './evaluationTypes';

export const SYNTHETIC_EVALUATION_DATASETS = ['v1', 'holdout'] as const;

interface SyntheticHoldoutFixture {
  version: 1;
  dataset: 'holdout';
  description: string;
  queries: SyntheticEvaluationCorpus['queries'];
}

/** Synthetic-only fixture; it contains no production user memory or embeddings. */
export const JAPANESE_SYNTHETIC_CORPUS = rawCorpus as SyntheticEvaluationCorpus;
const japaneseHoldoutFixture = rawHoldout as SyntheticHoldoutFixture;

/** Held-out wording shares only the unchanged synthetic record set with v1. */
export const JAPANESE_SYNTHETIC_HOLDOUT_CORPUS: SyntheticEvaluationCorpus = {
  ...JAPANESE_SYNTHETIC_CORPUS,
  description: japaneseHoldoutFixture.description,
  queries: japaneseHoldoutFixture.queries,
};

/** Select a fixed synthetic query set for unit or opt-in local-model evaluation. */
export function selectJapaneseSyntheticEvaluationCorpus(
  dataset: string = 'v1',
): SyntheticEvaluationCorpus {
  if (dataset === 'v1') return JAPANESE_SYNTHETIC_CORPUS;
  if (dataset === 'holdout') return JAPANESE_SYNTHETIC_HOLDOUT_CORPUS;
  throw new Error(
    `Unknown synthetic evaluation dataset "${dataset}" (expected ${SYNTHETIC_EVALUATION_DATASETS.join(' or ')})`,
  );
}

export function validateSyntheticCorpus(
  corpus: SyntheticEvaluationCorpus,
  queryCountBounds: { min: number; max: number } = { min: 30, max: 40 },
): string[] {
  const errors: string[] = [];
  const recordsById = new Map(corpus.records.map((record) => [record.id, record]));

  if (corpus.records.length < 30 || corpus.records.length > 50) {
    errors.push(`record count must be 30–50 (received ${corpus.records.length})`);
  }
  if (corpus.queries.length < queryCountBounds.min || corpus.queries.length > queryCountBounds.max) {
    errors.push(`query count must be ${queryCountBounds.min}–${queryCountBounds.max} (received ${corpus.queries.length})`);
  }
  if (recordsById.size !== corpus.records.length) errors.push('record ids must be unique');
  if (new Set(corpus.queries.map((query) => query.id)).size !== corpus.queries.length) {
    errors.push('query ids must be unique');
  }

  for (const query of corpus.queries) {
    if (!corpus.owners.includes(query.ownerId)) errors.push(`${query.id}: unknown owner`);
    if (query.expectedRelevantRecordIds.length === 0 && query.label !== 'negative_unrelated'
      && query.label !== 'trap_lifecycle_or_other_owner') {
      errors.push(`${query.id}: positive label has no expected record`);
    }
    if (query.label === 'negative_unrelated' && query.expectedRelevantRecordIds.length > 0) {
      errors.push(`${query.id}: negative query has an expected record`);
    }

    for (const id of [...query.expectedRelevantRecordIds, ...query.trapRecordIds]) {
      if (!recordsById.has(id)) errors.push(`${query.id}: unknown record ${id}`);
    }
    for (const id of query.expectedRelevantRecordIds) {
      const record = recordsById.get(id);
      if (record && (record.ownerId !== query.ownerId || record.status !== 'active')) {
        errors.push(`${query.id}: expected record ${id} is not active for query owner`);
      }
    }
    for (const id of query.trapRecordIds) {
      if (query.expectedRelevantRecordIds.includes(id)) {
        errors.push(`${query.id}: a trap cannot also be expected relevant`);
      }
    }
  }

  return errors;
}
