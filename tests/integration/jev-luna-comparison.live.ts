import { expect, it } from 'vitest';
import { createOpenRouterDecisionProvider } from '../../workers/ai-proxy/src/decision/openRouterDecisionProvider';
import { compareFocusedAuthorizationCandidates } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationJevLunaComparison';
import { createLunaFocusedAuthorizationEvaluator } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationLunaEvaluation';
import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  selectFocusedAuthorizationCandidates,
  type FocusedAuthorizationEvaluationSplit,
} from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationSyntheticCandidates';

const HARD_CASE_CAP = 60;

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} explicitly before running the Jev/Luna comparison.`);
  return value;
}

function evaluationSplit(value: string): FocusedAuthorizationEvaluationSplit {
  if (value === 'tuning' || value === 'holdout') return value;
  throw new Error('JEV_EVAL_SPLIT must be explicitly set to tuning or holdout.');
}

function caseLimit(): number {
  const raw = process.env.JEV_EVAL_MAX_CASES?.trim() || String(HARD_CASE_CAP);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > HARD_CASE_CAP) {
    throw new Error(`JEV_EVAL_MAX_CASES must be an integer from 1 to ${HARD_CASE_CAP}.`);
  }
  return value;
}

it('prints an opt-in Jev/Luna focused-boundary comparison', async () => {
  const openRouterApiKey = requiredEnvironment('OPENROUTER_API_KEY');
  const openAiApiKey = requiredEnvironment('OPENAI_API_KEY');
  const split = evaluationSplit(requiredEnvironment('JEV_EVAL_SPLIT'));
  const maxCases = caseLimit();

  // Validates split/group separation across the full fixture before filtering.
  const candidates = selectFocusedAuthorizationCandidates(
    FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
    split,
  ).slice(0, maxCases);
  const labels = Object.fromEntries(candidates.map((candidate) => [candidate.id, {
    expected: candidate.expected,
    labelStatus: candidate.reviewStatus,
  }]));

  console.log(JSON.stringify({
    event: 'jev_luna_comparison_started',
    split,
    caseCount: candidates.length,
    labelStatus: 'synthetic_unreviewed',
    warning: 'Synthetic labels are not human-reviewed gold. Agreement is not accuracy.',
  }));

  const report = await compareFocusedAuthorizationCandidates(
    candidates,
    labels,
    {
      jev: createOpenRouterDecisionProvider({ apiKey: openRouterApiKey, fetch: globalThis.fetch }),
      luna: createLunaFocusedAuthorizationEvaluator({ apiKey: openAiApiKey, fetch: globalThis.fetch }),
    },
    (result) => console.log(JSON.stringify({ event: 'jev_luna_comparison_case', ...result })),
  );

  console.log(JSON.stringify({
    event: 'jev_luna_comparison_completed',
    split,
    caseCount: report.cases.length,
    labelStatuses: report.labelStatuses,
    scopeNote: report.scopeNote,
    metrics: report.metrics,
  }, null, 2));
  expect(report.cases).toHaveLength(candidates.length);
}, 600_000);
