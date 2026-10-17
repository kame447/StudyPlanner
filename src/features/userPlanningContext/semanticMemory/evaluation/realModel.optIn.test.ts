import { describe, expect, it } from 'vitest';
import { createHybridRetriever } from './hybridRetriever';
import { lexicalBaselineRetriever } from './lexicalRetriever';
import { selectJapaneseSyntheticEvaluationCorpus } from './syntheticCorpus';
import { compareRetrievers } from './compareRetrievers';
import { createVectorRetriever } from './vectorRetriever';
import type { SemanticMemoryEmbedder } from '../semanticMemoryContract';

const enabled = process.env.SEMANTIC_MEMORY_EVAL_REAL_MODEL === '1';
const run = enabled ? describe : describe.skip;

run('opt-in real local model comparison (synthetic corpus only)', () => {
  it('prints lexical, vector, and hybrid metrics from a supplied local embedder adapter', async () => {
    const dataset = process.env.SEMANTIC_MEMORY_EVAL_DATASET?.trim() || 'v1';
    const corpus = selectJapaneseSyntheticEvaluationCorpus(dataset);
    const modulePath = process.env.SEMANTIC_MEMORY_EVAL_EMBEDDER_MODULE?.trim();
    if (!modulePath) throw new Error('SEMANTIC_MEMORY_EVAL_EMBEDDER_MODULE is required');

    const adapter = await import(/* @vite-ignore */ modulePath) as {
      createSemanticMemoryEvaluationEmbedder?: () => Promise<SemanticMemoryEmbedder>;
    };
    if (typeof adapter.createSemanticMemoryEvaluationEmbedder !== 'function') {
      throw new Error('adapter must export createSemanticMemoryEvaluationEmbedder()');
    }

    const embedder = await adapter.createSemanticMemoryEvaluationEmbedder();
    try {
      const vector = createVectorRetriever(embedder);
      const hybrid = createHybridRetriever(lexicalBaselineRetriever, vector);
      const results = await compareRetrievers({
        corpus,
        retrievers: [lexicalBaselineRetriever, vector, hybrid],
        topK: 5,
      });
      console.info(JSON.stringify({ dataset, results }, null, 2));
      expect(results.every((result) => result.trapViolations === 0)).toBe(true);
    } finally {
      await embedder.dispose();
    }
  }, 300_000);
});
