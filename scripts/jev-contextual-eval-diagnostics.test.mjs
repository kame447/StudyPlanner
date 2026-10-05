import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { ERROR_BODY_BYTE_CAP, ERROR_BODY_TIMEOUT_MS, REQUEST_ID_LENGTH_CAP, emptyDispatchDiagnostics,
  isEvalDispatchDiagnostics, providerRequestId, readProviderError, typedJevDiagnostic, typedProviderError } from './jev-contextual-eval-diagnostics.mjs';
import { validateArm } from './jev-contextual-paired-artifact.mjs';
import { createPairedWorkerSource } from './jev-contextual-paired-runtime.mjs';
import { buildWorkerBundle, loadBundleInProcess, preSendFor } from './jev-contextual-unit0-eval.mjs';
import { PREREGISTERED_PRICING, callCostFields, classifyAttempt, settlementUsd } from './jev-contextual-unit0-budget.mjs';
import { createBlindPacket } from './jev-contextual-unit0-review.mjs';
import { dispatchFocusedContextual } from '../workers/ai-proxy/src/decision/focusedContextualDispatch.ts';
import * as policy from '../workers/ai-proxy/src/decision/contextualDecisionPolicy.ts';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const sensitive = 'PRIVATE_ERROR_ECHO_こんにちは_保存して';
const knownError = { type: 'invalid_request_error', code: 'invalid_prompt', param: 'response_format.json_schema.schema' };
const expectedError = { type: 'invalid_request_error', code: 'invalid_prompt', param: 'json_schema_schema', bodyStatus: 'complete' };
const unknown = (bodyStatus) => ({ type: 'unknown', code: 'unknown', param: 'unknown', bodyStatus });

describe('eval error privacy and bounded reading', () => {
  it('keeps only fixed enums when the error echoes user text in message and extra fields', async () => {
    const diagnostic = await readProviderError(Response.json({ error: { ...knownError, message: sensitive, extra: sensitive }, raw: sensitive }));
    expect(diagnostic).toEqual(expectedError);
    expect(JSON.stringify(diagnostic)).not.toContain(sensitive);
  });
  it.each(['{', '<html>bad gateway</html>', '', 'null', '[]', JSON.stringify({ error: sensitive })])('handles malformed or unstructured error bodies: %s', async (body) => {
    expect(await readProviderError(new Response(body))).toEqual(unknown(['null', '[]', JSON.stringify({ error: sensitive })].includes(body)
      ? 'complete' : 'malformed_json'));
  });
  it.each([sensitive, 'user_text_with_valid_identifier_charset', '__proto__', 'constructor', 'toString', null, {}, ['api_error'], 123])(
    'maps unknown type/code/param to unknown without relying on a charset: %s', (value) => {
      expect(typedProviderError({ error: { type: value, code: value, param: value } })).toEqual(unknown('complete'));
    });
  it('maps only known exact parameter paths and numeric provider codes', () => {
    expect(typedProviderError({ error: { type: 'api_error', code: 429, param: 'messages[2].content' } }))
      .toEqual({ type: 'api_error', code: 'rate_limited', param: 'messages_content', bodyStatus: 'complete' });
    for (const param of ['messages[999].content', 'response_format.json_schema.schema.secret', 'messages[2].content.echo']) {
      expect(typedProviderError({ error: { param } }).param).toBe('unknown');
    }
  });
  it('ignores echoed keys and nested error fields', () => {
    expect(typedProviderError({ error: { [sensitive]: knownError, type: { value: sensitive },
      code: { value: sensitive }, param: [sensitive], message: sensitive } })).toEqual(unknown('complete'));
  });
  it('rejects malformed UTF-8 even when replacement decoding would form valid JSON', async () => {
    const prefix = new TextEncoder().encode('{"error":{"type":"api_error","code":"invalid_prompt","message":"');
    const suffix = new TextEncoder().encode('"}}');
    const bytes = new Uint8Array(prefix.length + 1 + suffix.length);
    bytes.set(prefix); bytes[prefix.length] = 0xff; bytes.set(suffix, prefix.length + 1);
    expect(await readProviderError(new Response(bytes))).toEqual(unknown('malformed_json'));
  });
  it('bounds and discards deeply nested unstructured JSON', async () => {
    expect(await readProviderError(new Response('['.repeat(1_000) + '0' + ']'.repeat(1_000)))).toEqual(unknown('complete'));
  });
  it('stops streaming at 4 KiB without pulling the remaining chunks', async () => {
    let reads = 0;
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      pull(controller) { reads += 1; controller.enqueue(new Uint8Array(1_024).fill(65)); }, cancel,
    }, { highWaterMark: 0 }));
    expect(await readProviderError(response)).toEqual(unknown('byte_cap'));
    expect(reads).toBe(ERROR_BODY_BYTE_CAP / 1_024);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('rejects a single oversized chunk and an exactly cap-sized body', async () => {
    for (const size of [ERROR_BODY_BYTE_CAP, ERROR_BODY_BYTE_CAP * 4]) {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ pull(controller) {
        controller.enqueue(new Uint8Array(size).fill(65));
      }, cancel }, { highWaterMark: 0 }));
      expect(await readProviderError(response)).toEqual(unknown('byte_cap'));
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
  it('times out a stalled read even when stream cancellation never settles', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise(() => {}));
    const pending = readProviderError(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(ERROR_BODY_TIMEOUT_MS);
    expect(await pending).toEqual(unknown('timeout'));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('contains body transport errors without preserving their messages', async () => {
    const response = new Response(new ReadableStream({ start(controller) { controller.error(new Error(sensitive)); } }));
    expect(await readProviderError(response)).toEqual(unknown('read_failure'));
  });
  it('contains a locked body-reader failure', async () => {
    const response = new Response('{}');
    const reader = response.body.getReader();
    expect(await readProviderError(response)).toEqual(unknown('read_failure'));
    reader.releaseLock();
  });
  it.each(['luna', 'jev'])('uses only the fixed request ID header for %s', (provider) => {
    const expectedHeader = provider === 'luna' ? 'x-request-id' : 'x-generation-id';
    const otherHeader = provider === 'luna' ? 'x-generation-id' : 'x-request-id';
    expect(providerRequestId(new Headers({ [otherHeader]: 'other-valid' }), provider)).toBeNull();
    expect(providerRequestId(new Headers({ [expectedHeader]: 'opaque_A-123' }), provider)).toBe('opaque_A-123');
    expect(providerRequestId(new Headers({ [expectedHeader]: 'a'.repeat(REQUEST_ID_LENGTH_CAP) }), provider)).toHaveLength(REQUEST_ID_LENGTH_CAP);
    for (const value of ['', 'a'.repeat(REQUEST_ID_LENGTH_CAP + 1), 'bad.charset', 'bad charset', 'bad,charset', 'bad/charset']) {
      expect(providerRequestId(new Headers({ [expectedHeader]: value }), provider)).toBeNull();
    }
    expect(providerRequestId(new Headers(), provider)).toBeNull();
  });
});

const metadata = { provider: 'openrouter', requestedModel: 'typesafe/jev-1.13', servedModel: 'typesafe/jev-1.13',
  latencyMs: 0, inputTokens: 1, outputTokens: 1, costUsd: 0.000001, requestBytes: 1, responseBytes: 1 };
const evaluated = (choice = 'target', overrides = {}) => ({ status: 'evaluated', decision: choice, confidence: 0.999,
  probabilities: Object.fromEntries(['target', 'remaining', 'completed', 'focused_luna', 'fallback'].map(key => [key, key === choice ? 0.9996 : 0.0001])),
  conditionChange: 0.001, independentMeaning: 0.001, metadata, ...overrides });
const wireJev = (result) => Response.json({ model: 'typesafe/jev-1.13', answers: {
  contextual_answer: { type: 'choice', choice: result.decision, confidence: result.confidence, probabilities: result.probabilities },
  condition_change: { type: 'noul', noul: result.conditionChange }, independent_meaning: { type: 'noul', noul: result.independentMeaning } },
  usage: { input_tokens: 1, output_tokens: 1, cost: 0.000001 } }, { headers: { 'x-generation-id': 'gen-synthetic_1' } });
const context = (questionCode) => ({ purpose: 'focused_contextual_answer', requestId: 'synthetic-context', inputRevision: 1, questionCode,
  state: { currentUserText: '合成の回答', pendingQuestion: { targetQuantityRole: 'unknown', questionBasis: null, hasEstimateTarget: false } } });

describe('recomputed gate provenance and parity with actual dispatch', () => {
  it.each([
    ['accepted role', 'quantity_role_unresolved', evaluated(), { status: 'accepted', decision: 'target' }],
    ['deferred focused Luna', 'quantity_role_unresolved', evaluated('focused_luna'), { status: 'deferred', reason: 'luna_owned' }],
    ['deferred missing effort', 'missing_effort_estimate', evaluated(), { status: 'deferred', reason: 'cross_question_choice' }],
    ['conflicting heads', 'quantity_role_unresolved', evaluated('remaining', { conditionChange: 0.5 }), { status: 'abstained', reason: 'conflicting_heads' }],
    ['low confidence', 'quantity_role_unresolved', evaluated('completed', { confidence: 0.1 }), { status: 'abstained', reason: 'uncertain' }],
    ['accepted fallback', 'quantity_role_unresolved', evaluated('fallback'), { status: 'accepted', decision: 'fallback' }],
    ['head-triggered fallback', 'quantity_role_unresolved', evaluated('target', { independentMeaning: 0.96 }), { status: 'accepted', decision: 'fallback' }],
    ['unavailable', 'quantity_role_unresolved', { status: 'unavailable', reason: 'http', httpStatus: 400, metadata }, { status: 'unavailable', reason: 'http' }],
  ])('%s preserves status, reason and decision', async (_name, questionCode, result, expected) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    // Observe the gate calls made by the real dispatcher; recomputation is
    // explicitly separate from this observation and never claims to be it.
    const actualGate = vi.spyOn(policy, 'gateContextualDecision');
    const fallback = vi.fn(async () => new Response('baseline'));
    const respond = vi.fn(decision => Response.json(decision));
    await dispatchFocusedContextual({ context: context(questionCode), env: { JEV_MODE: 'canary', JEV_CANARY_PERCENT: '100' },
      firebaseUid: 'synthetic', signal: new AbortController().signal, fallback, respond,
      provider: { evaluate: async () => result } });
    const observed = actualGate.mock.results.map(call => call.value);
    expect(observed).toHaveLength(2);
    expect(observed).toEqual([expected, expected]);
    const recomputed = typedJevDiagnostic(result, policy.gateContextualDecision(result, questionCode), policy.CONTEXTUAL_GATE_VERSION);
    expect(recomputed.gateRecomputedByHarness).toEqual({ status: expected.status, reason: expected.reason ?? 'none',
      decision: expected.decision ?? null, gateVersion: policy.CONTEXTUAL_GATE_VERSION });
    expect(respond).toHaveBeenCalledTimes(expected.status === 'accepted' ? 1 : 0);
    expect(fallback).toHaveBeenCalledTimes(expected.status === 'accepted' ? 0 : 1);
    if (expected.decision === 'target') expect(respond.mock.calls[0][0]).toMatchObject({ decision: 'quantity_role_answer', quantityRole: 'target' });
    if (expected.decision === 'fallback') expect(respond.mock.calls[0][0].decision).toBe('fallback');
    expect(isEvalDispatchDiagnostics({ ...emptyDispatchDiagnostics('jev'), jev: recomputed }, 'jev')).toBe(true);
  });
});

const item = { id: 'diag-case', group: 'diag-group', stratum: 'B', labelSource: 'synthetic_unreviewed',
  questionCode: 'quantity_role_unresolved', targetAmount: 14, unitCode: 'page', unitLabel: 'ページ', taskTitle: '合成の課題', userText: '残りの量です' };
const env = { OPENROUTER_API_KEY: 'offline', OPENAI_API_KEY: 'offline' };
const options = () => ({ budgetRemainingUsd: 5, runState: { attempts: 0, infrastructureFailures: 0, consecutiveInfrastructureFailures: 0 } });
let runtime;
const run = (arm = 'jevFirst', selectedItem = item) => runtime.runTurn(selectedItem, env, new AbortController().signal, arm, options());
const install = (provider) => {
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const fetch = vi.fn(provider); vi.stubGlobal('fetch', fetch); return fetch;
};

describe('eval-only dispatch records through the Unit 0 bundle', () => {
  beforeAll(async () => {
    const bundle = await buildWorkerBundle({ cases: [item], preSend: preSendFor({ ...PREREGISTERED_PRICING, source: 'offline synthetic frozen tariff' }) });
    ({ module: runtime } = await loadBundleInProcess(bundle, { digest: 'a'.repeat(64), expiresAt: 0 }));
  });
  it.each(['lunaOnly', 'jevFirst'])('records sanitized HTTP errors without changing latch/accounting for %s', async (arm) => {
    const fetch = install(async () => Response.json({ error: { ...knownError, message: sensitive } }, {
      status: 400, headers: { 'x-request-id': 'req-synthetic_1', 'x-generation-id': 'gen-synthetic_1' },
    }));
    const record = await run(arm);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(record.dispatches).toHaveLength(1);
    expect(record.dispatches[0]).toMatchObject({ outcome: 'http_failure', httpStatus: 400,
      inputTokens: null, outputTokens: null, costUsd: null, evalDiagnostics: { providerError: expectedError } });
    expect(record.dispatches[0].evalDiagnostics.requestId).toBe(arm === 'lunaOnly' ? 'req-synthetic_1' : 'gen-synthetic_1');
    expect(record.dispatches[0].evalDiagnostics.elapsedToHeadersMs).toBeGreaterThanOrEqual(0);
    expect(record).toMatchObject({ inputTokens: null, outputTokens: null, actualCostUsd: null,
      preSend: { stopLatched: 'configuration_failure', runStateAfter: { attempts: 1, infrastructureFailures: 0 } } });
    expect(record.preSend.reservations).toHaveLength(1);
    expect(JSON.stringify(record)).not.toContain(sensitive);
    expect(JSON.stringify(console.info.mock.calls)).not.toContain(sensitive);
    validateArm(record, item, arm, { preSend: true });
    // Diagnostics cannot alter reservation-based unknown/upper-bound handling:
    // strict framing still accepts the exact historical record without them.
    const legacy = structuredClone(record); delete legacy.dispatches[0].evalDiagnostics;
    expect(() => validateArm(legacy, item, arm, { preSend: true })).not.toThrow();
    const dispatch = record.dispatches[0], oldDispatch = legacy.dispatches[0];
    expect(callCostFields(dispatch, PREREGISTERED_PRICING)).toEqual(callCostFields(oldDispatch, PREREGISTERED_PRICING));
    expect(settlementUsd(dispatch, PREREGISTERED_PRICING)).toEqual(settlementUsd(oldDispatch, PREREGISTERED_PRICING));
    expect(classifyAttempt(dispatch)).toEqual(classifyAttempt(oldDispatch));
  });
  it('records valid choice/probability/heads and gate version after a direct Jev acceptance', async () => {
    const fetch = install(async () => wireJev(evaluated('remaining')));
    const record = await run();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(record.directRoleAccepted).toBe(true);
    expect(record.dispatches[0].evalDiagnostics.jev).toEqual({ choice: 'remaining', confidence: 0.999,
      selectedProbability: 0.9996, conditionChange: 0.001, independentMeaning: 0.001,
      gateRecomputedByHarness: { status: 'accepted', reason: 'none', decision: 'remaining', gateVersion: policy.CONTEXTUAL_GATE_VERSION } });
  });
  it('records notApplicable when absent decision context excludes Jev', async () => {
    const fetch = install(async () => Response.json({ error: knownError }, { status: 400 }));
    const record = await run('jevFirst', { ...item, progressBasis: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(record.dispatches.map(dispatch => dispatch.provider)).toEqual(['luna']);
    expect(record.dispatches[0].evalDiagnostics.jev).toBe('notApplicable');
  });
  it.each(['lunaOnly', 'jevFirst'])('discards echoed type/code/param and invalid IDs throughout records (%s)', async (arm) => {
    install(async () => Response.json({ error: { type: sensitive, code: sensitive, param: sensitive, message: sensitive }, [sensitive]: sensitive },
      { status: 400, headers: { 'x-request-id': 'bad.charset', 'x-generation-id': 'bad.charset' } }));
    const record = await run(arm);
    expect(record.dispatches[0].evalDiagnostics).toMatchObject({ requestId: null, providerError: unknown('complete') });
    expect(JSON.stringify(record)).not.toContain(sensitive);
    expect(JSON.stringify(record)).not.toContain('bad.charset');
    expect(JSON.stringify(console.info.mock.calls)).not.toContain(sensitive);
    expect(record.dispatches).toHaveLength(1);
  });
  it.each(['lunaOnly', 'jevFirst'])('does not await a stalled cloned body before original response and stop/latch (%s)', async (arm) => {
    vi.useFakeTimers();
    const responses = [];
    const fetch = install(async () => {
      const response = new Response(new ReadableStream({}), { status: 400 });
      // The clone observer must leave this original response unconsumed.
      responses.push(response);
      return response;
    });
    let settled = false;
    const pending = run(arm).then(record => { settled = true; return record; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false); // only the final artifact awaits diagnostics
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(responses[0].bodyUsed).toBe(false);
    // Semantic execution cleared its 1,500/85,000 ms timers and completed
    // before the 200 ms diagnostic timeout: only that timer remains.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(ERROR_BODY_TIMEOUT_MS);
    const record = await pending;
    expect(record.elapsedMs).toBe(0); // diagnostic wait excluded from measurement
    expect(record.dispatches[0].evalDiagnostics).toMatchObject({ elapsedToHeadersMs: 0, providerError: unknown('timeout') });
    expect(record.preSend.stopLatched).toBe('configuration_failure');
    expect(record.preSend.runStateAfter.attempts).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(responses[0].bodyUsed).toBe(false);
    await responses[0].body.cancel();
  });
  it.each(['complete', 'timeout'])('finalizes diagnostic reads before a normalization throw reaches the caller (%s)', async (completion) => {
    const { build } = await import('esbuild');
    // Test-only instrumentation exposes the existing dispatch array. A stub
    // normalizer throws after the real provider wrapper returns a 400; neither
    // the production normalizer nor the harness API gains a testing hook.
    const captured = [];
    vi.stubGlobal('__p1ThrowDispatches', captured);
    const request = { messages: [{ role: 'user', content: 'synthetic' }], maxCompletionTokens: 320,
      responseFormat: { type: 'json_schema', json_schema: { name: 'synthetic', schema: {} } } };
    const source = createPairedWorkerSource({ root: resolve('.'), cases: [], digest: 'a'.repeat(64), expiresAt: 0,
      preSend: preSendFor({ ...PREREGISTERED_PRICING, source: 'offline synthetic frozen tariff' }) })
      .replace('const dispatches = [];', 'const dispatches = globalThis.__p1ThrowDispatches;');
    const bundled = await build({ stdin: { contents: source, resolveDir: resolve('.'), loader: 'ts' }, bundle: true,
      platform: 'node', format: 'esm', write: false, logLevel: 'silent', plugins: [{ name: 'synthetic-throw', setup(builder) {
        builder.onLoad({ filter: /weeklyPlanningSemanticNormalizerV5\.ts$/ }, () => ({ loader: 'ts', contents:
          'export function createWeeklyPlanningSemanticNormalizerV5(client) { return { async normalize() {'
          + 'try { await client.createChatCompletion(' + JSON.stringify(request) + '); } catch {}'
          + 'const error = new Error("Synthetic normalization failure"); error.observedDispatches = globalThis.__p1ThrowDispatches; throw error; } }; }' }));
      } }] });
    const throwing = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));
    vi.useFakeTimers();
    let controller;
    const original = new Response(new ReadableStream({ start(value) { controller = value; } }), { status: 400 });
    const fetch = install(async () => original);
    let rejected = false;
    const pending = throwing.runTurn(item, env, new AbortController().signal, 'lunaOnly', options())
      .then(() => { throw new Error('Expected normalization failure'); }, error => { rejected = true; return error; });
    await vi.advanceTimersByTimeAsync(0);
    expect(rejected).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(captured[0].outcome).toBe('http_failure');
    expect(captured[0].evalDiagnostics.providerError).toBeNull();
    expect(original.bodyUsed).toBe(false);
    if (completion === 'complete') {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: knownError })));
      controller.close();
      await vi.advanceTimersByTimeAsync(0);
    } else await vi.advanceTimersByTimeAsync(ERROR_BODY_TIMEOUT_MS);
    const error = await pending;
    expect(error.message).toBe('Synthetic normalization failure');
    expect(error.observedDispatches).toBe(captured);
    expect(captured[0].evalDiagnostics.providerError).toEqual(completion === 'complete' ? expectedError : unknown('timeout'));
    const finalRecord = JSON.stringify(error.observedDispatches);
    if (completion === 'timeout') { controller.enqueue(new TextEncoder().encode(JSON.stringify({ error: knownError }))); controller.close(); }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(JSON.stringify(error.observedDispatches)).toBe(finalRecord);
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await original.body.cancel();
  });
  it('measures send-to-header latency, independent of body completion', async () => {
    vi.useFakeTimers();
    install(async () => { vi.setSystemTime(Date.now() + 37); return wireJev(evaluated()); });
    const record = await run();
    expect(record.dispatches[0].evalDiagnostics.elapsedToHeadersMs).toBe(37);
  });
  it('rejects extra/raw/invalid diagnostic fields on artifact import', async () => {
    install(async () => wireJev(evaluated()));
    const record = await run();
    for (const mutate of [
      diagnostic => { diagnostic.errorMessage = sensitive; },
      diagnostic => { diagnostic.providerError = { ...expectedError, message: sensitive }; },
      diagnostic => { diagnostic.providerError = { ...expectedError, code: sensitive }; },
      diagnostic => { diagnostic.providerError = { ...expectedError, param: 'messages[999].content' }; },
      diagnostic => { diagnostic.requestId = 'bad.charset'; },
      diagnostic => { diagnostic.requestId = 'a'.repeat(129); },
      diagnostic => { diagnostic.jev.confidence = 2; },
      diagnostic => { diagnostic.jev.gateRecomputedByHarness.reason = sensitive; },
      diagnostic => { diagnostic.jev.gateRecomputedByHarness.gateVersion = sensitive; },
    ]) {
      const changed = structuredClone(record); mutate(changed.dispatches[0].evalDiagnostics);
      expect(() => validateArm(changed, item, 'jevFirst', { preSend: true })).toThrow('Invalid eval dispatch diagnostics');
    }
  });
  it('structurally excludes every new field and opaque ID from the blind packet', async () => {
    install(async () => Response.json({ error: knownError }, { status: 400, headers: { 'x-request-id': 'req-private_marker', 'x-generation-id': 'gen-private_marker' } }));
    const jevFirst = await run(); const lunaOnly = await run('lunaOnly');
    const roster = { cases: [item] }; const pairs = [{ caseId: item.id, jevFirst, lunaOnly }];
    const bindings = { runtimeSha256: 'a'.repeat(64), resultsSha256: 'b'.repeat(64) };
    const packet = createBlindPacket({ roster, pairs, bindings, randomSlot: () => 0 }).packet;
    const without = structuredClone(pairs);
    for (const arm of ['jevFirst', 'lunaOnly']) for (const dispatch of without[0][arm].dispatches) delete dispatch.evalDiagnostics;
    expect(packet).toEqual(createBlindPacket({ roster, pairs: without, bindings, randomSlot: () => 0 }).packet);
    const serialized = JSON.stringify(packet);
    for (const field of ['evalDiagnostics', 'elapsedToHeadersMs', 'requestId', 'providerError', 'bodyStatus', 'choice', 'confidence',
      'selectedProbability', 'conditionChange', 'independentMeaning', 'gateRecomputedByHarness', 'gateVersion', 'req-private_marker', 'gen-private_marker']) {
      expect(serialized).not.toContain(field);
    }
  });
  it('keeps the diagnostic module outside all production source imports', async () => {
    // The entire production entry tree is bundled below using the same build
    // graph as the Worker; no diagnostic symbols can enter that artifact.
    const { build } = await import('esbuild');
    const bundle = await build({ entryPoints: [resolve('workers/ai-proxy/src/index.ts')], bundle: true, write: false,
      format: 'esm', platform: 'browser', external: ['cloudflare:workers'], metafile: true, logLevel: 'silent' });
    expect(Object.keys(bundle.metafile.inputs).some(path => path.includes('eval-diagnostics'))).toBe(false);
    expect(bundle.outputFiles[0].text).not.toContain('gateRecomputedByHarness');
  });
});
