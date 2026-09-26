import { expect, it } from 'vitest';
import { createOpenRouterDecisionProvider } from '../../workers/ai-proxy/src/decision/openRouterDecisionProvider';
import { evaluateFocusedAuthorizationCandidates } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationEvaluation';
import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  parseFocusedAuthorizationEvaluationSplit,
  selectFocusedAuthorizationCandidates,
} from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationSyntheticCandidates';

it('prints an opt-in Jev shadow evaluation without treating synthetic labels as gold', async () => {
  const requestedSplit = parseFocusedAuthorizationEvaluationSplit(process.env.JEV_EVAL_SPLIT);
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Set OPENROUTER_API_KEY in the process environment before running eval:jev:shadow.');
  }

  const selectedCandidates = selectFocusedAuthorizationCandidates(
    FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
    requestedSplit,
  );
  console.log(JSON.stringify({
    event: 'jev_shadow_evaluation_started',
    fixtureStatus: 'synthetic_unreviewed',
    warning: 'Candidate labels await human review and are not gold accuracy evidence.',
    requestedSplit,
    caseCount: selectedCandidates.length,
  }));
  if (requestedSplit === 'holdout') {
    console.warn(JSON.stringify({
      event: 'jev_shadow_holdout_warning',
      requestedSplit,
      warning: 'Fixed holdout results must not be used to adjust thresholds or questions.',
    }));
  }

  const report = await evaluateFocusedAuthorizationCandidates(
    selectedCandidates,
    createOpenRouterDecisionProvider({ apiKey }),
    {
      requestedSplit,
      onCase: (verdict) => console.log(JSON.stringify({ event: 'jev_shadow_case', ...verdict })),
    },
  );

  console.log(JSON.stringify({
    event: 'jev_shadow_evaluation_completed',
    fixtureStatus: report.fixtureStatus,
    fixtureSetVersion: report.fixtureSetVersion,
    catalogVersion: report.catalogVersion,
    gateVersion: report.gateVersion,
    requestedSplit: report.requestedSplit,
    caseCounts: report.caseCounts,
    global: report.metrics.global,
    bySplit: report.metrics.bySplit,
    byLayer: report.metrics.byLayer,
  }, null, 2));
  expect(report.cases).toHaveLength(selectedCandidates.length);
}, 180_000);
