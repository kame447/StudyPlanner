import type { UserPlanningContextRecordV1 } from '../../userPlanningContextTypes';
import type {
  Retriever,
  SyntheticEvaluationCorpus,
  SyntheticEvaluationQuery,
} from './evaluationTypes';

export interface QueryEvaluationResult {
  queryId: string;
  returnedRecordIds: string[];
  relevantHits: number;
  falsePositiveCount: number;
  trapViolationIds: string[];
  contextBytes: number;
  latencyMs: number;
}

export interface RetrieverEvaluationMetrics {
  retriever: string;
  topK: number;
  queryCount: number;
  positiveQueryCount: number;
  recallAtK: number | null;
  precisionAtK: number | null;
  negativeQueryFalsePositiveCount: number;
  negativeQueriesWithFalsePositives: number;
  trapViolations: number;
  averageContextBytes: number;
  maxContextBytes: number;
  indexingLatencyMs: number;
  averageQueryLatencyMs: number;
  p50QueryLatencyMs: number;
  p95QueryLatencyMs: number;
  perQuery: QueryEvaluationResult[];
}

/** Compare retrievers using only the explicitly synthetic fixture. */
export async function compareRetrievers(params: {
  corpus: SyntheticEvaluationCorpus;
  retrievers: readonly Retriever[];
  topK?: number;
}): Promise<RetrieverEvaluationMetrics[]> {
  const topK = Math.max(0, Math.floor(params.topK ?? 5));
  const owners = [...new Set(params.corpus.queries.map((query) => query.ownerId))];
  const recordsById = new Map(params.corpus.records.map((record) => [record.id, record]));
  const results: RetrieverEvaluationMetrics[] = [];

  for (const retriever of params.retrievers) {
    const indexingStartedAt = performance.now();
    for (const ownerId of owners) {
      await retriever.prepare?.({ ownerId, records: params.corpus.records });
    }
    const indexingLatencyMs = performance.now() - indexingStartedAt;
    const perQuery: QueryEvaluationResult[] = [];

    for (const query of params.corpus.queries) {
      const startedAt = performance.now();
      const returnedRecordIds = [...await retriever.retrieve({
        ownerId: query.ownerId,
        query: query.query,
        records: params.corpus.records,
        topK,
      })];
      const latencyMs = performance.now() - startedAt;
      const returned = new Set(returnedRecordIds);
      const relevantHits = query.expectedRelevantRecordIds.filter((id) => returned.has(id)).length;
      const trapViolationIds = query.trapRecordIds.filter((id) => returned.has(id));
      const contextBytes = returnedRecordIds.reduce((total, id) => {
        const record = recordsById.get(id);
        return total + (record ? recordUtf8Bytes(record) : 0);
      }, 0);

      perQuery.push({
        queryId: query.id,
        returnedRecordIds,
        relevantHits,
        falsePositiveCount: query.expectedRelevantRecordIds.length === 0
          ? returnedRecordIds.length
          : Math.max(0, returnedRecordIds.length - relevantHits),
        trapViolationIds,
        contextBytes,
        latencyMs,
      });
    }

    results.push(aggregateMetrics({
      retriever: retriever.name,
      topK,
      queries: params.corpus.queries,
      perQuery,
      indexingLatencyMs,
    }));
  }

  return results;
}

function aggregateMetrics(params: {
  retriever: string;
  topK: number;
  queries: readonly SyntheticEvaluationQuery[];
  perQuery: QueryEvaluationResult[];
  indexingLatencyMs: number;
}): RetrieverEvaluationMetrics {
  const positiveIndexes = params.queries
    .map((query, index) => ({ query, result: params.perQuery[index] }))
    .filter(({ query }) => query.expectedRelevantRecordIds.length > 0);
  const recallAtK = positiveIndexes.length === 0
    ? null
    : average(positiveIndexes.map(({ query, result }) => (
      result.relevantHits / query.expectedRelevantRecordIds.length
    )));
  const precisionAtK = positiveIndexes.length === 0 || params.topK === 0
    ? null
    : average(positiveIndexes.map(({ result }) => result.relevantHits / params.topK));
  const negativeResults = params.queries
    .map((query, index) => ({ query, result: params.perQuery[index] }))
    .filter(({ query }) => query.label === 'negative_unrelated');
  const latencies = params.perQuery.map((result) => result.latencyMs);
  const contextBytes = params.perQuery.map((result) => result.contextBytes);

  return {
    retriever: params.retriever,
    topK: params.topK,
    queryCount: params.queries.length,
    positiveQueryCount: positiveIndexes.length,
    recallAtK,
    precisionAtK,
    negativeQueryFalsePositiveCount: negativeResults.reduce((sum, { result }) => sum + result.falsePositiveCount, 0),
    negativeQueriesWithFalsePositives: negativeResults.filter(({ result }) => result.falsePositiveCount > 0).length,
    trapViolations: params.perQuery.reduce((sum, result) => sum + result.trapViolationIds.length, 0),
    averageContextBytes: average(contextBytes),
    maxContextBytes: Math.max(0, ...contextBytes),
    indexingLatencyMs: roundMilliseconds(params.indexingLatencyMs),
    averageQueryLatencyMs: roundMilliseconds(average(latencies)),
    p50QueryLatencyMs: roundMilliseconds(percentile(latencies, 0.5)),
    p95QueryLatencyMs: roundMilliseconds(percentile(latencies, 0.95)),
    perQuery: params.perQuery.map((result) => ({
      ...result,
      latencyMs: roundMilliseconds(result.latencyMs),
    })),
  };
}

function recordUtf8Bytes(record: UserPlanningContextRecordV1): number {
  return new TextEncoder().encode(JSON.stringify(record)).byteLength;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], proportion: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1);
  return sorted[Math.max(0, index)];
}

function roundMilliseconds(value: number): number {
  return Math.round(value * 1000) / 1000;
}
