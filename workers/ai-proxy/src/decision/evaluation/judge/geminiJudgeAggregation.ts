import type { AuthorizationDecision } from '../../decisionProvider';
import type {
  GeminiJudgedClass,
  GeminiJudgeRecord,
} from './geminiJudgeContract';

export const GEMINI_JUDGE_MAX_REPETITIONS = 3;

export interface GeminiJudgeAggregate {
  majorityClass: GeminiJudgedClass | null;
  unstable: boolean;
  incomplete: boolean;
  judgedRunCount: number;
  failedRunCount: number;
  anyReviewRequired: boolean;
  disagreesWithSyntheticLabel: boolean;
}

export interface GeminiJudgeCaseAggregate extends GeminiJudgeAggregate {
  caseId: string;
  representativeRationale: string | null;
  records: readonly GeminiJudgeRecord[];
}

export function validateGeminiJudgeRepetitions(repetitions: number): void {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1
    || repetitions > GEMINI_JUDGE_MAX_REPETITIONS) {
    throw new Error(`Gemini judge repetitions must be an integer from 1 to ${GEMINI_JUDGE_MAX_REPETITIONS}.`);
  }
}

export function aggregateGeminiJudgeRecords(
  syntheticLabel: AuthorizationDecision | null,
  records: readonly GeminiJudgeRecord[],
): GeminiJudgeAggregate {
  validateGeminiJudgeRepetitions(records.length);
  const judgments = records.flatMap((record) => record.status === 'judged' && record.judgment
    ? [record.judgment] : []);
  const counts = new Map<GeminiJudgedClass, number>();
  for (const judgment of judgments) {
    counts.set(judgment.judgedClass, (counts.get(judgment.judgedClass) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  const majorityClass = ranked.length > 0 && (ranked.length === 1 || ranked[0][1] > ranked[1][1])
    ? ranked[0][0] : null;
  const judgedRunCount = judgments.length;
  const failedRunCount = records.filter((record) =>
    record.status === 'invalid_response' || record.status === 'missing').length;
  return {
    majorityClass,
    unstable: counts.size > 1 || failedRunCount > 0,
    incomplete: failedRunCount > 0,
    judgedRunCount,
    failedRunCount,
    anyReviewRequired: judgments.some((judgment) =>
      judgment.reviewRequired || judgment.judgedClass === 'ambiguous') || failedRunCount > 0,
    disagreesWithSyntheticLabel: syntheticLabel !== null
      && majorityClass !== null && majorityClass !== syntheticLabel,
  };
}

export function aggregateGeminiJudgeCase(
  caseId: string,
  syntheticLabel: AuthorizationDecision | null,
  records: readonly GeminiJudgeRecord[],
): GeminiJudgeCaseAggregate {
  if (records.some((record) => record.caseId !== caseId)) {
    throw new Error(`Gemini judge record caseId mismatch: ${caseId}`);
  }
  const aggregate = aggregateGeminiJudgeRecords(syntheticLabel, records);
  const judgments = records.flatMap((record) => record.status === 'judged' && record.judgment
    ? [record.judgment] : []);
  const representative = judgments.find((judgment) =>
    judgment.judgedClass === aggregate.majorityClass) ?? judgments[0];
  return {
    caseId,
    ...aggregate,
    representativeRationale: representative?.rationale ?? null,
    records: [...records],
  };
}

export function geminiJudgeReviewPriority(aggregate: GeminiJudgeAggregate | null): number {
  if (!aggregate) return 3;
  if (aggregate.unstable || aggregate.incomplete) return 0;
  if (aggregate.majorityClass === 'ambiguous' || aggregate.anyReviewRequired) return 1;
  if (aggregate.disagreesWithSyntheticLabel) return 2;
  return 3;
}
