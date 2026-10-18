import type { SemanticMemoryEmbedder } from '../semanticMemoryContract';
import type { UserPlanningContextRecordV1 } from '../../userPlanningContextTypes';
import {
  eligibleRecordsForOwner,
  normalizedTopK,
  type Retriever,
  type RetrieverPreparation,
} from './evaluationTypes';

interface PreparedOwnerIndex {
  signature: string;
  records: UserPlanningContextRecordV1[];
  vectors: Float32Array[];
}

/** Vector comparison over the shared embedder port; all inputs are local. */
export function createVectorRetriever(embedder: SemanticMemoryEmbedder): Retriever {
  const preparedByOwner = new Map<string, PreparedOwnerIndex>();

  const prepare = async ({ ownerId, records }: RetrieverPreparation): Promise<void> => {
    const eligible = eligibleRecordsForOwner(records, ownerId);
    const signature = recordsSignature(eligible);
    const existing = preparedByOwner.get(ownerId);
    if (existing?.signature === signature) return;

    const vectors = eligible.length === 0
      ? []
      : await embedder.embed(eligible.map(recordPassage), 'passage');
    validateVectors(vectors, eligible.length, embedder.model.dimensions, 'passage');
    preparedByOwner.set(ownerId, { signature, records: eligible, vectors });
  };

  return {
    name: 'vector',
    prepare,

    async retrieve(input) {
      const eligible = eligibleRecordsForOwner(input.records, input.ownerId);
      const signature = recordsSignature(eligible);
      if (preparedByOwner.get(input.ownerId)?.signature !== signature) {
        await prepare({ ownerId: input.ownerId, records: input.records });
      }
      const prepared = preparedByOwner.get(input.ownerId);
      if (!prepared || prepared.records.length === 0 || normalizedTopK(input.topK) === 0) return [];

      const [queryVector] = await embedder.embed([input.query], 'query');
      validateVectors(queryVector ? [queryVector] : [], 1, embedder.model.dimensions, 'query');

      return prepared.records
        .map((record, ordinal) => ({
          id: record.id,
          ordinal,
          score: cosineSimilarity(queryVector, prepared.vectors[ordinal]),
        }))
        .sort((left, right) => right.score - left.score || left.ordinal - right.ordinal)
        .slice(0, normalizedTopK(input.topK))
        .map((candidate) => candidate.id);
    },
  };
}

function recordPassage(record: UserPlanningContextRecordV1): string {
  return [record.label, record.value, record.dateExpression, record.sourceText]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}

function recordsSignature(records: readonly UserPlanningContextRecordV1[]): string {
  return JSON.stringify(records.map((record) => [
    record.id,
    record.ownerId,
    record.kind,
    record.label,
    record.value,
    record.dateExpression,
    record.sourceText,
    record.status,
  ]));
}

function validateVectors(
  vectors: readonly Float32Array[],
  expectedCount: number,
  expectedDimensions: number,
  role: string,
): void {
  if (vectors.length !== expectedCount) {
    throw new Error(`${role} embedder returned ${vectors.length} vectors for ${expectedCount} texts`);
  }
  for (const vector of vectors) {
    if (vector.length !== expectedDimensions) {
      throw new Error(`${role} vector dimension ${vector.length} did not match ${expectedDimensions}`);
    }
    if (Array.from(vector).some((value) => !Number.isFinite(value))) {
      throw new Error(`${role} vector contains a non-finite value`);
    }
  }
}

function cosineSimilarity(left: Float32Array, right: Float32Array): number {
  if (left.length !== right.length) throw new Error('cannot compare vectors with different dimensions');
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
