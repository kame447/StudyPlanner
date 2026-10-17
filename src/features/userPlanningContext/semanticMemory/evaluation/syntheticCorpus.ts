import rawCorpus from './fixtures/japaneseSyntheticCorpus.v1.json';
import type { SyntheticEvaluationCorpus } from './evaluationTypes';

/** Synthetic-only fixture; it contains no production user memory or embeddings. */
export const JAPANESE_SYNTHETIC_CORPUS = rawCorpus as SyntheticEvaluationCorpus;

export function validateSyntheticCorpus(corpus: SyntheticEvaluationCorpus): string[] {
  const errors: string[] = [];
  const recordsById = new Map(corpus.records.map((record) => [record.id, record]));

  if (corpus.records.length < 30 || corpus.records.length > 50) {
    errors.push(`record count must be 30–50 (received ${corpus.records.length})`);
  }
  if (corpus.queries.length < 30 || corpus.queries.length > 40) {
    errors.push(`query count must be 30–40 (received ${corpus.queries.length})`);
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
