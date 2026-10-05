import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { choiceRequest } from '../../../../shared/candidateChoiceFixtures.testUtils';
import { JEV_MODEL } from './decisionPolicy';
import { jevPurposeCanarySample, type JevRolloutEnv } from './jevPurposeRollout';

const routes = [
  { purpose: 'focused_authorization', prefix: 'FOCUSED_AUTHORIZATION', choice: 'create_plan' },
  { purpose: 'focused_contextual_answer', prefix: 'FOCUSED_CONTEXTUAL_ANSWER', choice: 'remaining' },
  { purpose: 'temporal_scope_repair', prefix: 'TEMPORAL_SCOPE_REPAIR', choice: 'plan_unavailable' },
  { purpose: 'user_context_routing', prefix: 'USER_CONTEXT_ROUTING', choice: 'bookshelf' },
  { purpose: 'candidate_choice', prefix: 'CANDIDATE_CHOICE', choice: 'leaf:0' },
] as const;
type Route = typeof routes[number];
const cohorts = {
  focused_authorization: [['fixture-cohort-43', 0.0041], ['fixture-cohort-2', 0.1346], ['fixture-cohort-0', 0.6108]],
  focused_contextual_answer: [['fixture-cohort-3', 0.0392], ['fixture-cohort-7', 0.0868], ['fixture-cohort-0', 0.3249]],
  temporal_scope_repair: [['fixture-cohort-4', 0.0212], ['fixture-cohort-13', 0.1848], ['fixture-cohort-0', 0.9736]],
  user_context_routing: [['fixture-cohort-18', 0.0458], ['fixture-cohort-3', 0.0704], ['fixture-cohort-0', 0.3561]],
  candidate_choice: [['fixture-cohort-2', 0.011], ['fixture-cohort-1', 0.2491], ['fixture-cohort-0', 0.4872]],
} as const;
let uid: string;
let sends: { jev: number; luna: number };
function setting(route: Route, mode: string, percent = '100'): JevRolloutEnv {
  return { [`JEV_${route.prefix}_MODE`]: mode, [`JEV_${route.prefix}_CANARY_PERCENT`]: percent };
}
function context(route: Route): Record<string, unknown> {
  const base = { purpose: route.purpose, requestId: 'fixture-context-id', inputRevision: 1 };
  switch (route.purpose) {
    case 'focused_authorization': return { ...base, previousStatus: 'needs_scope', hasTasks: true, hasPendingQuestion: false,
      state: { currentUserText: 'fixture input', lastAssistantMessage: 'fixture draft question' } };
    case 'focused_contextual_answer': return { ...base, questionCode: 'quantity_role_unresolved',
      state: { currentUserText: 'fixture input', pendingQuestion: { targetQuantityRole: 'declared', questionBasis: null, hasEstimateTarget: false } } };
    case 'temporal_scope_repair': return { ...base, state: { sourceText: 'fixture input', currentAttachedTask: { title: 'fixture task' },
      interpretedTime: { dateExpression: 'weekday:tuesday', namedTimePeriod: null, startTime: '18:00', endTime: '20:00' } } };
    case 'user_context_routing': return { ...base, state: { currentUserText: 'fixture input' } };
    case 'candidate_choice': return { purpose: route.purpose, request: choiceRequest() };
  }
}
async function execute(route: Route, overrides: JevRolloutEnv, payloadOverrides = {}, requestHeaders: Record<string, string> = {}) {
  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch(new Request('https://proxy.fixture/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer fixture-session', Origin: 'https://app.fixture', ...requestHeaders },
    body: JSON.stringify({ purpose: route.purpose === 'user_context_routing' ? 'user_context_interpreter' : 'weekly_planning_semantic_normalizer',
      messages: [{ role: 'user', content: route.purpose === 'candidate_choice' ? choiceRequest().wholeUtterance : 'fixture input' }],
      decisionContext: context(route), ...payloadOverrides }),
  }), {
    OPENAI_API_KEY: 'fixture-luna', OPENROUTER_API_KEY: 'fixture-jev', FIREBASE_WEB_API_KEY: 'fixture-project',
    ALLOWED_ORIGIN: 'https://app.fixture', JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100', ...overrides,
    AI_QUOTA: { getByName: () => ({ checkAndConsume: async () => ({ allowed: true, retryAfterSeconds: 0 }) }) },
  } as never, undefined, { waitUntil: (work: Promise<unknown>) => pending.push(work) } as ExecutionContext);
  await Promise.all(pending);
  expect(response.status).toBe(200);
  return response.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  uid = 'fixture-owner'; sends = { jev: 0, luna: 0 };
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = String(input);
    if (url.includes('identitytoolkit.googleapis.com')) return Response.json({ users: [{ localId: uid, emailVerified: true }] });
    if (url === 'https://openrouter.ai/api/alpha/decisions') {
      sends.jev += 1;
      const body = JSON.parse(String(init?.body));
      const answers = Object.fromEntries(Object.entries(body.questions as Record<string, { type: string; criteria: Record<string, string> }>).map(([key, question]) => {
        if (question.type === 'noul') return [key, { type: 'noul', noul: 0.001 }];
        const choice = ({ authorization: 'create_plan', contextual_answer: 'remaining', temporal_scope: 'plan_unavailable', target_domain: 'bookshelf', candidate: 'leaf:0' } as Record<string, string>)[key];
        const options = Object.keys(question.criteria);
        return [key, { type: 'choice', choice, confidence: 0.999,
          probabilities: Object.fromEntries(options.map(option => [option, option === choice ? 0.9996 : 0.0004 / (options.length - 1)])) }];
      }));
      return Response.json({ model: JEV_MODEL.request, answers });
    }
    if (url === 'https://api.openai.com/v1/chat/completions') {
      sends.luna += 1;
      const body = JSON.parse(String(init?.body));
      expect(body).not.toHaveProperty('decisionContext');
      expect(JSON.stringify(body)).not.toContain('JEV_');
      return Response.json({ choices: [{ message: { content: 'Luna baseline sentinel' } }] });
    }
    throw new Error('Unstubbed endpoint: fixture must never send a real request.');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('purpose isolation through real authenticated Worker handler', () => {
  it.each(Array.from({ length: 32 }, (_, mask) => mask))('isolates every enable combination %i', async mask => {
    const env = Object.assign({}, ...routes.filter((_, i) => (mask & (1 << i)) !== 0).map(route => setting(route, 'canary')));
    for (const [i, route] of routes.entries()) {
      sends = { jev: 0, luna: 0 };
      const enabled = (mask & (1 << i)) !== 0;
      const result = await execute(route, env);
      expect(sends).toEqual({ jev: enabled ? 1 : 0, luna: !enabled && route.purpose !== 'candidate_choice' ? 1 : 0 });
      if (!enabled) expect(result).toMatchObject(route.purpose === 'candidate_choice'
        ? { status: 'unavailable', reason: 'off' } : { content: 'Luna baseline sentinel' });
      else expect(JSON.stringify(result)).toContain(route.choice);
    }
  });

  it.each(['off', '', 'invalid', undefined])('global %s kills all individually enabled routes', async master => {
    const env = Object.assign({}, ...routes.map(route => setting(route, 'canary')), { JEV_MODE: master });
    for (const route of routes) {
      sends = { jev: 0, luna: 0 };
      const result = await execute(route, env);
      expect(sends.jev).toBe(0);
      expect(result).toMatchObject(route.purpose === 'candidate_choice'
        ? { status: 'unavailable', reason: 'off' } : { content: 'Luna baseline sentinel' });
    }
  });

  it.each([undefined, '', '0', ' 5', '5.0', '5e0', '50', 'malformed'])('global percentage %s kills individually enabled routes', async percentage => {
    const env = Object.assign({}, ...routes.map(route => setting(route, 'canary')), { JEV_CANARY_PERCENT: percentage });
    for (const route of routes) {
      sends = { jev: 0, luna: 0 };
      const result = await execute(route, env);
      expect(sends.jev).toBe(0);
      expect(result).toMatchObject(route.purpose === 'candidate_choice'
        ? { status: 'unavailable', reason: 'off' } : { content: 'Luna baseline sentinel' });
    }
  });

  it.each(routes)('global shadow cannot make $purpose authoritative', async route => {
    const result = await execute(route, { ...setting(route, 'canary'), JEV_MODE: 'shadow' });
    if (route.purpose === 'candidate_choice') {
      expect(result).toEqual({ status: 'unavailable', reason: 'not_selected' }); expect(sends).toEqual({ jev: 0, luna: 0 });
    } else {
      expect(result).toMatchObject({ content: 'Luna baseline sentinel' }); expect(sends).toEqual({ jev: 1, luna: 1 });
    }
  });

  it.each(routes)('uses authenticated stable cohort for $purpose at 5/25/100', async route => {
    // Two sides of each threshold, selected by UID only; no request-text selector.
    for (const percent of [5, 25, 100]) {
      for (const [owner, expectedSample] of cohorts[route.purpose]) {
        uid = owner; sends = { jev: 0, luna: 0 };
        expect(jevPurposeCanarySample(route.purpose, uid)).toBe(expectedSample);
        const selected = expectedSample < percent / 100;
        const env = setting(route, 'canary', String(percent));
        const first = await execute(route, env);
        expect(sends.jev).toBe(selected ? 1 : 0);
        sends = { jev: 0, luna: 0 };
        const otherRoutes = Object.assign({}, ...routes.filter(r => r.purpose !== route.purpose).map(r => setting(r, 'canary')));
        expect(await execute(route, { ...env, ...otherRoutes })).toEqual(first);
        expect(sends.jev).toBe(selected ? 1 : 0);
      }
    }
  });

  it('body flags and unknown purposes cannot authorize a provider send', async () => {
    for (const route of routes) {
      sends = { jev: 0, luna: 0 };
      await execute(route, {}, { JEV_MODE: 'canary', ...setting(route, 'canary') }, {
        'X-Jev-Mode': 'canary', 'X-Jev-Purpose': route.purpose,
        [`JEV_${route.prefix}_MODE`]: 'canary', [`JEV_${route.prefix}_CANARY_PERCENT`]: '100',
      });
      expect(sends.jev).toBe(0);
    }
    const env = Object.assign({}, ...routes.map(route => setting(route, 'canary')));
    sends = { jev: 0, luna: 0 };
    expect(await execute(routes[0], env, { decisionContext: { purpose: 'new_research', requestId: 'fixture-new' } })).toMatchObject({ content: 'Luna baseline sentinel' });
    expect(sends).toEqual({ jev: 0, luna: 1 });
  });
});
