import { expect } from '@playwright/test';
import { summarizeDurableTurnBody } from './vnext-durable-summary.mjs';

export { summarizeDurableTurnBody };

// With durable turns (production: DURABLE_WEEKLY_TURNS=enabled) the provider is called by the Worker's Durable Object
// alarm (workers/ai-proxy/src/durableTurns/durableTurnProvider.ts), so the page never POSTs */chat/completions. What the
// page does see is the durable turn API: GET/POST <worker>/weekly-planning/turns, whose `completed` body carries `result`
// (a JSON string). That result's `core` and `result.debugTraceEvents` (weeklyPlanningVNextTurnDiagnostics.ts) hold one
// `semantic_provider_request` event per interpreter provider call, with its schema name; the renderer call shows as
// `dialogueRendererTrace.request`. Only schema names and counts leave this module: no bodies, ids or tokens.
export const DURABLE_TURNS_PATH = '/weekly-planning/turns';
export const VNEXT_SCHEMA = 'weekly_planning_vnext_native_v1';
export const V5_SEMANTIC_SCHEMAS = ['weekly_planning_semantic_document_v5', 'weekly_planning_focused_contextual_answer_v5'];
export const MAX_TURN_PROVIDER_CALLS = 6; // reading + bounded repair + renderer; a runaway loop fails the run.

/** Attach before the first turn. A turn is polled until completed; the last completed body per requestId is the turn. */
export function observeDurableTurns(page) {
  const turns = new Map(); const pending = [];
  const seen = { pageProviderCalls: 0, durablePosts: 0 };
  page.on('request', request => {
    const url = new URL(request.url());
    if (request.method() === 'POST' && url.pathname.endsWith('/chat/completions')) seen.pageProviderCalls++;
    if (request.method() === 'POST' && url.pathname.endsWith(DURABLE_TURNS_PATH)) seen.durablePosts++;
  });
  page.on('response', response => {
    let url; try { url = new URL(response.url()); } catch { return; }
    if (!url.pathname.endsWith(DURABLE_TURNS_PATH) || !['GET', 'POST'].includes(response.request().method())) return;
    pending.push(response.text().then(text => {
      const summary = summarizeDurableTurnBody(text);
      if (summary) turns.set(summary.requestId ?? `turn-${turns.size}`, summary);
    }).catch(() => undefined));
  });
  return {
    seen,
    async settled() { await Promise.all(pending); return [...turns.values()]; },
    async observedCalls() { return (await this.settled()).reduce((sum, turn) => sum + turn.schemas.length + turn.rendererCalls, 0); },
  };
}

/**
 * The contract: every observed turn ran on VNext through the Worker, used the VNext schema and no V5 semantic schema,
 * the evidence is complete, and the calls stay within the bound. `turns` is how many durable turns the test made.
 */
export async function expectDurableVNext(observation, { turns, maxCalls = MAX_TURN_PROVIDER_CALLS }) {
  const observed = await observation.settled();
  expect(observed, 'every turn of this test completed through the durable turn API').toHaveLength(turns);
  expect(observation.seen.pageProviderCalls, 'the page never calls the provider itself').toBe(0);
  for (const turn of observed) {
    expect(turn.core).toBe('vnext');
    expect(turn.traceAvailable, 'the turn carries its provider trace').toBe(true);
    expect(turn.traceTruncated, 'the provider trace was not dropped for size').toBe(false);
    expect(turn.schemas).toContain(VNEXT_SCHEMA);
    expect(turn.schemas.filter(name => V5_SEMANTIC_SCHEMAS.includes(name))).toEqual([]);
    expect(turn.schemas.length + turn.rendererCalls).toBeLessThanOrEqual(maxCalls);
  }
}
