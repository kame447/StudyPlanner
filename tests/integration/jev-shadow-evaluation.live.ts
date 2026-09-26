import { expect, it } from 'vitest';
import { createOpenRouterDecisionProvider } from '../../workers/ai-proxy/src/decision/openRouterDecisionProvider';
import { evaluateFocusedAuthorizationCandidates } from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationEvaluation';
import {
  FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
  validateFocusedAuthorizationSyntheticCandidates,
} from '../../workers/ai-proxy/src/decision/evaluation/focusedAuthorizationSyntheticCandidates';

it('prints an opt-in Jev shadow evaluation without treating synthetic labels as gold', async () => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Set OPENROUTER_API_KEY in the process environment before running eval:jev:shadow.');
  }

  validateFocusedAuthorizationSyntheticCandidates(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES);
  console.log(JSON.stringify({
    event: 'jev_shadow_evaluation_started',
    fixtureStatus: 'synthetic_unreviewed',
    warning: 'Candidate labels await human review and are not gold accuracy evidence.',
    caseCount: FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.length,
  }));

  const report = await evaluateFocusedAuthorizationCandidates(
    FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES,
    createOpenRouterDecisionProvider({ apiKey }),
    (verdict) => console.log(JSON.stringify({ event: 'jev_shadow_case', ...verdict })),
  );

  console.log(JSON.stringify({
    event: 'jev_shadow_evaluation_completed',
    fixtureStatus: report.fixtureStatus,
    metrics: report.metrics,
  }, null, 2));
  expect(report.cases).toHaveLength(FOCUSED_AUTHORIZATION_SYNTHETIC_CANDIDATES.length);
}, 180_000);
