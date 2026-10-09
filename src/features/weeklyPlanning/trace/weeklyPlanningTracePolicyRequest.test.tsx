import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { deferred, microtasks } from '../../../repositories/localPersistenceConcurrency.testUtils';
import { WEEKLY_PLANNING_TRACE_HEADERS } from '../../../../shared/weeklyPlanningTraceContract';
import { useWeeklyPlanningTracePolicy, type WeeklyPlanningTracePolicyState } from './useWeeklyPlanningTracePolicy';
import { createWeeklyPlanningTraceApiClient, WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS, WEEKLY_PLANNING_TRACE_POLICY_VERSION, type WeeklyPlanningTraceApiClient } from './weeklyPlanningTracePrivacyClient';

const fixture = vi.hoisted(() => ({ token: vi.fn(), fetch: vi.fn() }));
vi.mock('../../../lib/firebaseClient', () => ({ getFirebaseAuth: () => ({ currentUser: { getIdToken: fixture.token } }) }));
vi.mock('../../../lib/aiConfig', () => ({ getCloudflareAiProxyUrl: () => 'https://trace.example.test' }));
vi.mock('./weeklyPlanningTraceRepository', () => ({ isWeeklyPlanningTraceEnabled: () => true }));
const accepted = { policyVersion: WEEKLY_PLANNING_TRACE_POLICY_VERSION, accepted: true, acceptedAt: '2026-10-08T00:00:00Z' };
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('fetch', fixture.fetch);
  fixture.token.mockResolvedValue('fixture-token');
  fixture.fetch.mockResolvedValue(new Response(JSON.stringify(accepted)));
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('preserves a successful policy GET and removes the complete-request deadline', async () => {
  expect(await createWeeklyPlanningTraceApiClient().getPolicyStatus()).toEqual(accepted);
  const [url, init] = fixture.fetch.mock.calls[0];
  expect(url).toBe('https://trace.example.test/weekly-planning-trace/policy');
  expect(init.method).toBeUndefined(); expect(init.headers.Authorization).toBe('Bearer fixture-token');
  expect(init.signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
});

it('uses one deadline across token, response and body with the request correlation ID', async () => {
  const token = deferred<string>(), response = deferred<any>(), body = deferred<object>();
  fixture.token.mockReturnValue(token.promise); fixture.fetch.mockReturnValue(response.promise);
  const result = createWeeklyPlanningTraceApiClient().getPolicyStatus().catch(error => error);
  await vi.advanceTimersByTimeAsync(5_000); token.resolve('fixture-token'); await microtasks();
  await vi.advanceTimersByTimeAsync(5_000); response.resolve({ ok: true, status: 200, headers: new Headers(), json: () => body.promise }); await microtasks();
  await vi.advanceTimersByTimeAsync(4_999);
  let settled = false; void result.then(() => { settled = true; }); await microtasks(); expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  const error = await result;
  expect(error.details).toMatchObject({ stage: 'policy', code: 'trace_policy_timeout', category: 'network', status: null, retryable: true,
    correlationId: fixture.fetch.mock.calls[0][1].headers[WEEKLY_PLANNING_TRACE_HEADERS.correlationId] });
  expect(fixture.fetch.mock.calls[0][1].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  body.resolve(accepted); await microtasks();
});

it('does not start token restoration for an already-retired caller', async () => {
  const controller = new AbortController(), reason = new Error('retired'); controller.abort(reason);
  await expect(createWeeklyPlanningTraceApiClient().getPolicyStatus({ signal: controller.signal })).rejects.toBe(reason);
  expect(fixture.token).not.toHaveBeenCalled(); expect(fixture.fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it('caller cancellation retires a token wait and prevents dispatch when the token arrives later', async () => {
  const token = deferred<string>(), controller = new AbortController(), reason = new Error('owner retired');
  fixture.token.mockReturnValue(token.promise);
  const result = createWeeklyPlanningTraceApiClient().getPolicyStatus({ signal: controller.signal }).catch(error => error);
  controller.abort(reason);
  expect(await result).toBe(reason); expect(vi.getTimerCount()).toBe(0);
  token.resolve('late-token'); await microtasks(); expect(fixture.fetch).not.toHaveBeenCalled();
});

it('preserves early authentication failures rather than replacing them with a timeout', async () => {
  const original = new Error('token unavailable'); fixture.token.mockRejectedValue(original);
  await expect(createWeeklyPlanningTraceApiClient().getPolicyStatus()).rejects.toBe(original);
  expect(vi.getTimerCount()).toBe(0); expect(fixture.fetch).not.toHaveBeenCalled();
});

it('preserves early HTTP error metadata and removes the deadline', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  fixture.fetch.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'policy unavailable', errorCode: 'fixture_policy_unavailable', errorCategory: 'policy', retryable: false }), { status: 412 }));
  await expect(createWeeklyPlanningTraceApiClient().getPolicyStatus()).rejects.toMatchObject({ message: 'policy unavailable', details: { stage: 'policy', status: 412, code: 'fixture_policy_unavailable', category: 'policy', retryable: false } });
  expect(vi.getTimerCount()).toBe(0);
});

it('does not apply the read deadline or cancellation signal to policy-accept writes', async () => {
  const response = deferred<Response>(); fixture.fetch.mockReturnValue(response.promise);
  let settled = false; const result = createWeeklyPlanningTraceApiClient().acceptPolicy(); void result.then(() => { settled = true; });
  await vi.advanceTimersByTimeAsync(WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS * 2);
  expect(settled).toBe(false); expect(vi.getTimerCount()).toBe(0);
  expect(fixture.fetch.mock.calls[0]).toMatchObject(['https://trace.example.test/weekly-planning-trace/policy/accept', { method: 'POST', body: '{}' }]);
  expect(fixture.fetch.mock.calls[0][1].signal).toBeUndefined();
  response.resolve(new Response(JSON.stringify(accepted))); expect(await result).toEqual(accepted);
});

function policyProbe(client: WeeklyPlanningTraceApiClient) {
  let state!: WeeklyPlanningTracePolicyState;
  function Probe({ owner = 'a' }: { owner?: string }) { state = useWeeklyPlanningTracePolicy(owner, client); return null; }
  return { Probe, current: () => state };
}

it.each(['required', 'unavailable'])('newer %s refresh result wins when an injected older read ignores cancellation', async outcome => {
  const first = deferred<typeof accepted>(), second = deferred<typeof accepted>();
  const getPolicyStatus = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const probe = policyProbe({ getPolicyStatus } as unknown as WeeklyPlanningTraceApiClient);
  await act(async () => { renderer = create(<probe.Probe />); await microtasks(); });
  let retry!: Promise<void>;
  await act(async () => { retry = probe.current().refresh(); await microtasks(); });
  expect(getPolicyStatus.mock.calls[0][0]?.signal?.aborted).toBe(true);
  await act(async () => {
    if (outcome === 'unavailable') second.reject(new Error('retry unavailable'));
    else second.resolve({ ...accepted, accepted: false });
    await retry;
  });
  expect(probe.current().status).toBe(outcome);
  await act(async () => { first.resolve(accepted); await microtasks(); });
  expect(probe.current().status).toBe(outcome); expect(probe.current().acceptedAt).toBeNull();
});

it('owner changes cancel and isolate the previous read', async () => {
  const first = deferred<typeof accepted>(), second = deferred<typeof accepted>();
  const getPolicyStatus = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const probe = policyProbe({ getPolicyStatus } as unknown as WeeklyPlanningTraceApiClient);
  await act(async () => { renderer = create(<probe.Probe owner="a" />); await microtasks(); });
  await act(async () => { renderer!.update(<probe.Probe owner="b" />); await microtasks(); });
  expect(getPolicyStatus.mock.calls[0][0]?.signal?.aborted).toBe(true);
  await act(async () => { first.resolve(accepted); await microtasks(); });
  expect(probe.current().status).toBe('loading');
  await act(async () => { second.resolve({ ...accepted, accepted: false }); await microtasks(); });
  expect(probe.current().status).toBe('required');
});

it('an older status read cannot replace a completed explicit acceptance', async () => {
  const first = deferred<typeof accepted>();
  const getPolicyStatus = vi.fn((_options?: { signal?: AbortSignal }) => first.promise), acceptPolicy = vi.fn(async () => accepted);
  const probe = policyProbe({ getPolicyStatus, acceptPolicy } as unknown as WeeklyPlanningTraceApiClient);
  await act(async () => { renderer = create(<probe.Probe />); await microtasks(); });
  await act(async () => { expect(await probe.current().accept()).toBe(true); });
  expect(getPolicyStatus.mock.calls[0][0]?.signal?.aborted).toBe(true);
  await act(async () => { first.resolve({ ...accepted, accepted: false }); await microtasks(); });
  expect(probe.current().status).toBe('accepted'); expect(acceptPolicy).toHaveBeenCalledOnce();
});


it('accepts a successful response just inside the deadline without a later abort', async () => {
  const body = deferred<object>();
  fixture.fetch.mockResolvedValue({ ok: true, status: 200, headers: new Headers(), json: () => body.promise });
  const result = createWeeklyPlanningTraceApiClient().getPolicyStatus();
  await vi.advanceTimersByTimeAsync(WEEKLY_PLANNING_TRACE_POLICY_TIMEOUT_MS - 1);
  body.resolve(accepted); expect(await result).toEqual(accepted);
  await vi.advanceTimersByTimeAsync(1);
  expect(fixture.fetch.mock.calls[0][1].signal.aborted).toBe(false); expect(vi.getTimerCount()).toBe(0);
});
