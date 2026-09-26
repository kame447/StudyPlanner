import {
  FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES,
  validateFocusedAuthorizationExpansionCandidates,
} from './focusedAuthorizationExpansionCandidates';
import type { FocusedAuthorizationFirstRouteCandidate } from './focusedAuthorizationFirstRouteEvaluation';
import {
  FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGMENTS,
  FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGE_VERSION,
  limitedJudgmentExpectedDecision,
} from './focusedAuthorizationOpusLimitedJudgments';
import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  validateFocusedAuthorizationSyntheticCandidates,
  type FocusedAuthorizationEvaluationSplit,
} from './focusedAuthorizationSyntheticCandidates';

export const FOCUSED_AUTHORIZATION_FIRST_ROUTE_CORPUS_VERSION =
  'focused-authorization-first-route-2026-09-27-v1' as const;

const SYNTHETIC_JUDGMENT_OVERRIDES = new Set([
  'stored-injection-07',
  'abnormal-value-04',
]);

function judgmentStatus(label: string): string {
  return label === 'ambiguous'
    ? `${FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGE_VERSION}:ambiguous_safe_fallback`
    : FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGE_VERSION;
}

export function focusedAuthorizationFirstRouteCorpus(
  split: FocusedAuthorizationEvaluationSplit,
): FocusedAuthorizationFirstRouteCandidate[] {
  validateFocusedAuthorizationSyntheticCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES);
  validateFocusedAuthorizationExpansionCandidates(FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES);

  const synthetic = FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES
    .filter((candidate) => candidate.split === split)
    .map<FocusedAuthorizationFirstRouteCandidate>((candidate) => {
      const judgment = SYNTHETIC_JUDGMENT_OVERRIDES.has(candidate.id)
        ? FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGMENTS[candidate.id as keyof typeof FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGMENTS]
        : undefined;
      return {
        ...candidate,
        expected: judgment ? limitedJudgmentExpectedDecision(judgment) ?? undefined : candidate.expected,
        labelStatus: judgment ? judgmentStatus(judgment.label) : candidate.reviewStatus,
      };
    });
  const expansion = FOCUSED_AUTHORIZATION_EXPANSION_CANDIDATES
    .filter((candidate) => candidate.split === split)
    .flatMap<FocusedAuthorizationFirstRouteCandidate>((candidate) => {
      const judgment = FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGMENTS[candidate.id as keyof typeof FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGMENTS];
      if (!judgment) throw new Error(`Missing limited judgment: ${candidate.id}`);
      const expected = limitedJudgmentExpectedDecision(judgment);
      if (expected === null) return [];
      return [{
        ...candidate,
        expected,
        labelStatus: judgmentStatus(judgment.label),
      }];
    });
  return [...synthetic, ...expansion];
}

export function focusedAuthorizationAmbiguousLimitedJudgmentIds(): string[] {
  return Object.entries(FOCUSED_AUTHORIZATION_OPUS_LIMITED_JUDGMENTS)
    .filter(([, judgment]) => judgment.label === 'ambiguous')
    .map(([id]) => id)
    .sort();
}
