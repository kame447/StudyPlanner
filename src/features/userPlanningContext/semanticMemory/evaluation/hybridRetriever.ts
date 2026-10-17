import type { Retriever } from './evaluationTypes';

/** Evaluation-only reciprocal-rank fusion of lexical and vector candidate lists. */
export function createHybridRetriever(
  lexical: Retriever,
  vector: Retriever,
  rankConstant = 60,
): Retriever {
  return {
    name: 'hybrid-rrf',

    async prepare(input) {
      await Promise.all([lexical.prepare?.(input), vector.prepare?.(input)]);
    },

    async retrieve(input) {
      const [lexicalIds, vectorIds] = await Promise.all([
        lexical.retrieve(input),
        vector.retrieve(input),
      ]);
      const scores = new Map<string, { score: number; firstSeen: number }>();
      let sequence = 0;

      for (const ids of [lexicalIds, vectorIds]) {
        ids.forEach((id, index) => {
          const existing = scores.get(id) ?? { score: 0, firstSeen: sequence++ };
          existing.score += 1 / (rankConstant + index + 1);
          scores.set(id, existing);
        });
      }

      return [...scores.entries()]
        .sort((left, right) => right[1].score - left[1].score || left[1].firstSeen - right[1].firstSeen)
        .slice(0, Math.max(0, Math.floor(input.topK)))
        .map(([id]) => id);
    },
  };
}
