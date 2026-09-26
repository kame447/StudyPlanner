import { expect, it } from 'vitest';
import { createOpenRouterDecisionProvider } from '../../workers/ai-proxy/src/decision/openRouterDecisionProvider';
import { gateDecision } from '../../workers/ai-proxy/src/decision/decisionPolicy';

it('obtains an actual focused authorization decision from Jev', async () => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error('Set OPENROUTER_API_KEY in the process environment before running test:jev:live.');
  const provider = createOpenRouterDecisionProvider({ apiKey });
  const result = await provider.evaluate({
    currentUserText: 'はい、その条件のままで計画案を作ってください。',
    lastAssistantMessage: '必要な学習内容と条件はそろいました。この条件で未保存の計画案を作りますか？',
  });
  // Deliberately no request, raw response, HTTP headers or credentials in output.
  console.info(JSON.stringify({ status: result.status, ...result.metadata,
    decision: result.status === 'evaluated' ? result.decision : null,
    reason: result.status === 'unavailable' ? result.reason : null,
    gate: gateDecision(result),
  }));
  expect(result.status).toBe('evaluated');
  if (result.status !== 'evaluated') return;
  expect(result.decision).toBe('create_plan');
  expect(result.probabilities.create_plan).toBeGreaterThan(result.probabilities.fallback);
  expect(result.metadata.inputTokens).not.toBeNull();
}, 10_000);
