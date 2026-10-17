import { projectUserPlanningContextScopeV2, selectUserPlanningContextPromptRecordsV2 } from '../../userPlanningContextPromptSelectionV2Core';
import {
  eligibleRecordsForOwner,
  normalizedTopK,
  type Retriever,
} from './evaluationTypes';

/**
 * Evaluation-only baseline. Exact scope-key containment models the current
 * upstream scope hint; character bigrams only rank that bounded selector output.
 * This is not a production Japanese parser or a semantic authority.
 */
export const lexicalBaselineRetriever: Retriever = {
  name: 'lexical-baseline',

  async retrieve(input) {
    const eligible = eligibleRecordsForOwner(input.records, input.ownerId);
    const normalizedQuery = normalizeJapaneseText(input.query);
    const exactScopeKeys = eligible
      .map((record) => projectUserPlanningContextScopeV2(record).key)
      .filter((key): key is string => key !== null)
      .filter((key) => normalizedQuery.includes(normalizeJapaneseText(key)));

    const selected = selectUserPlanningContextPromptRecordsV2({
      records: eligible,
      relevantScopeKeys: exactScopeKeys,
    });
    const recordsById = new Map(eligible.map((record) => [record.id, record]));
    const queryBigrams = characterBigrams(normalizedQuery);

    return selected
      .map((candidate, ordinal) => {
        const record = recordsById.get(candidate.id);
        return {
          id: candidate.id,
          ordinal,
          score: record ? diceSimilarity(queryBigrams, characterBigrams(normalizeJapaneseText(recordText(record)))) : 0,
        };
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.ordinal - right.ordinal)
      .slice(0, normalizedTopK(input.topK))
      .map((candidate) => candidate.id);
  },
};

function normalizeJapaneseText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ja-JP').replace(/\s+/g, ' ');
}

function characterBigrams(value: string): Set<string> {
  const characters = Array.from(value.replace(/\s/g, ''));
  if (characters.length === 1) return new Set(characters);
  const bigrams = new Set<string>();
  for (let index = 0; index < characters.length - 1; index += 1) {
    bigrams.add(`${characters[index]}${characters[index + 1]}`);
  }
  return bigrams;
}

function diceSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function recordText(record: {
  label: string;
  value: string | null;
  dateExpression: string | null;
  sourceText: string;
}): string {
  return [record.label, record.value, record.dateExpression, record.sourceText]
    .filter((part): part is string => Boolean(part))
    .join(' ');
}
