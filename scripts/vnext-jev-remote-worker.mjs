// Evaluation-only preview. The sole credential embedded in source is a digest.
export function createVNextJevRemoteSource({ root, digest, expiresAt }) {
  return `
import { evaluateCandidateChoice } from ${JSON.stringify(`${root}/workers/ai-proxy/src/decision/candidateChoiceDispatch.ts`)};
import { isCandidateChoiceDecisionContext } from ${JSON.stringify(`${root}/shared/candidateChoiceDecision.ts`)};
const missing = () => new Response('Not found', { status: 404 });
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const tokens = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const model = value => typeof value === 'string' && /^[a-zA-Z0-9./:_-]{1,160}$/.test(value) ? value : null;
const usage = (payload, status, latencyMs, jev = false) => ({
  httpStatus: status, latencyMs, servedModel: model(payload?.model),
  inputTokens: tokens(jev ? payload?.usage?.input_tokens : payload?.usage?.prompt_tokens),
  outputTokens: tokens(jev ? payload?.usage?.output_tokens : payload?.usage?.completion_tokens),
  costUsd: number(payload?.usage?.cost),
});
export default { async fetch(request, env) {
  if (Date.now() >= ${expiresAt}) return missing();
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  if (Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('') !== ${JSON.stringify(digest)}) return missing();
  const path = new URL(request.url).pathname;
  if (request.method === 'GET' && path === '/ready') return Response.json({
    openRouter: Boolean(env.OPENROUTER_API_KEY?.trim()), openAi: Boolean(env.OPENAI_API_KEY?.trim()),
  });
  if (request.method !== 'POST' || !['/luna', '/jev'].includes(path)) return missing();
  let body;
  try { body = await request.json(); } catch { return Response.json({ status: 400 }, { status: 400 }); }
  if (path === '/luna') {
    if (body?.model !== 'gpt-6-luna') return Response.json({ status: 400 }, { status: 400 });
    if (!env.OPENAI_API_KEY?.trim()) return Response.json({ status: 503 }, { status: 503 });
    const started = Date.now();
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST', redirect: 'manual', signal: request.signal,
        headers: { Authorization: 'Bearer ' + env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) return Response.json({ status: response.status }, { status: response.status });
      const payload = await response.json();
      return Response.json({ result: payload, usage: usage(payload, response.status, Date.now() - started) });
    } catch { return Response.json({ status: 502 }, { status: 502 }); }
  }
  if (!isCandidateChoiceDecisionContext(body?.decisionContext)) return Response.json({ status: 400 }, { status: 400 });
  let receipt = usage(null, null, 0, true);
  const started = Date.now();
  try {
    const result = await evaluateCandidateChoice({ context: body.decisionContext,
      env: { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY, JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100',
        JEV_CANDIDATE_CHOICE_MODE: 'canary', JEV_CANDIDATE_CHOICE_CANARY_PERCENT: '100' },
      firebaseUid: 'vnext-synthetic-evaluation', signal: request.signal,
      transport: async (url, init) => {
        const response = await fetch(url, init);
        let payload = null;
        // Diagnostics retain only usage/model/status, never raw error payloads.
        if (response.ok) { try { payload = await response.clone().json(); } catch {} }
        receipt = usage(payload, response.status, Date.now() - started, true);
        return response;
      },
    });
    return Response.json({ result, usage: { ...receipt, latencyMs: Date.now() - started } });
  } catch { return Response.json({ status: 502 }, { status: 502 }); }
}};
`;
}
