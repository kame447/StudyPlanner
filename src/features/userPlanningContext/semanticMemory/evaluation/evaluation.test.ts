import { describe, expect, it } from 'vitest';
import type { Retriever } from './evaluationTypes';
import { DeterministicFakeEmbedder } from './fakeEmbedder';
import { createHybridRetriever } from './hybridRetriever';
import { lexicalBaselineRetriever } from './lexicalRetriever';
import { compareRetrievers } from './compareRetrievers';
import { JAPANESE_SYNTHETIC_CORPUS, validateSyntheticCorpus } from './syntheticCorpus';
import { createVectorRetriever } from './vectorRetriever';

describe('semantic memory retrieval evaluation harness', () => {
  it('keeps the synthetic corpus human-reviewable and within the requested shape', () => {
    expect(validateSyntheticCorpus(JAPANESE_SYNTHETIC_CORPUS)).toEqual([]);
    expect(JAPANESE_SYNTHETIC_CORPUS.records).toHaveLength(37);
    expect(JAPANESE_SYNTHETIC_CORPUS.queries).toHaveLength(36);

    const labels = JAPANESE_SYNTHETIC_CORPUS.queries.reduce<Record<string, number>>((counts, query) => {
      counts[query.label] = (counts[query.label] ?? 0) + 1;
      return counts;
    }, {});
    expect(labels).toEqual({
      exact_keyword_hit: 8,
      paraphrase: 8,
      abbreviation_kana_kanji_variant: 6,
      negative_unrelated: 6,
      trap_lifecycle_or_other_owner: 8,
    });
    expect(JAPANESE_SYNTHETIC_CORPUS.records.some((record) => record.status === 'revoked')).toBe(true);
    expect(JAPANESE_SYNTHETIC_CORPUS.records.some((record) => record.status === 'superseded')).toBe(true);
  });

  it('filters inactive and other-owner records before lexical, vector, and hybrid ranking', async () => {
    const fake = new DeterministicFakeEmbedder();
    const vector = createVectorRetriever(fake);
    const retrievers = [
      lexicalBaselineRetriever,
      vector,
      createHybridRetriever(lexicalBaselineRetriever, vector),
    ];
    const results = await compareRetrievers({
      corpus: JAPANESE_SYNTHETIC_CORPUS,
      retrievers,
      topK: 5,
    });

    expect(results.map((result) => result.retriever)).toEqual([
      'lexical-baseline',
      'vector',
      'hybrid-rrf',
    ]);
    for (const result of results) {
      expect(result.trapViolations).toBe(0);
      expect(result.queryCount).toBe(36);
      expect(result.indexingLatencyMs).toBeGreaterThanOrEqual(0);
      expect(result.averageQueryLatencyMs).toBeGreaterThanOrEqual(0);
      for (const queryResult of result.perQuery) {
        for (const id of queryResult.returnedRecordIds) {
          const record = JAPANESE_SYNTHETIC_CORPUS.records.find((candidate) => candidate.id === id);
          expect(record?.ownerId).toBe(JAPANESE_SYNTHETIC_CORPUS.queries.find((query) => query.id === queryResult.queryId)?.ownerId);
          expect(record?.status).toBe('active');
        }
      }
    }

    await fake.dispose();
  });

  it('measures negative false positives, trap violations, recall, precision, and context bytes', async () => {
    const unsafeMetricFixture: Retriever = {
      name: 'metric-contract-fixture',
      async retrieve({ query }) {
        if (query === 'TOEIC 800点') return ['aya-toeic-800'];
        if (query === '今日のお昼はカレーにしよう') return ['aya-toeic-800'];
        if (query === '以前のTOEIC 750点目標') return ['aya-toeic-750-revoked'];
        return [];
      },
    };

    const [metrics] = await compareRetrievers({
      corpus: JAPANESE_SYNTHETIC_CORPUS,
      retrievers: [unsafeMetricFixture],
      topK: 5,
    });

    expect(metrics.positiveQueryCount).toBe(28);
    expect(metrics.recallAtK).toBeCloseTo(1 / 28);
    expect(metrics.precisionAtK).toBeCloseTo(1 / 140);
    expect(metrics.negativeQueryFalsePositiveCount).toBe(1);
    expect(metrics.negativeQueriesWithFalsePositives).toBe(1);
    expect(metrics.trapViolations).toBe(1);
    expect(metrics.averageContextBytes).toBeGreaterThan(0);
    expect(metrics.maxContextBytes).toBeGreaterThan(0);
  });
});
