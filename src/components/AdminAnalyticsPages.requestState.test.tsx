import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ObservabilityAiAnalysisReadModel } from '../../shared/productObservabilityAdminReadModel';
import type { ObservabilityPlanningAnalysisReadModel } from '../../shared/productObservabilityPlanningReadModel';

const services = vi.hoisted(() => ({ ai: vi.fn(), planning: vi.fn() }));
vi.mock('../services/adminObservabilityService', () => ({
  getAdminObservabilityAiAnalysis: services.ai,
  getAdminObservabilityPlanningAnalysis: services.planning,
}));
import { AdminAiApiPage } from './AdminAiApiPage';
import { AdminPlanningPage } from './AdminPlanningPage';

function deferred() {
  let resolve!: (data: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function aiFixture(count: number): ObservabilityAiAnalysisReadModel {
  return {
    environment: 'production', fromDate: '2026-10-07', toDate: '2026-10-13', reportingTimeZone: 'Asia/Tokyo',
    total: {
      requestCount: count, successCount: count, failureCount: 0, statusCounts: {},
      promptTokens: 0, promptTokensUnknownCount: 0, completionTokens: 0, completionTokensUnknownCount: 0,
      totalTokens: 0, totalTokensUnknownCount: 0, cachedTokens: 0, cachedTokensUnknownCount: 0,
      estimatedCostMicros: 0, estimatedCostUnknownCount: 0,
      latency: { version: 'latency-ms-v1', bucketCounts: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], sampleCount: 0, sumMs: 0, minMs: null, maxMs: null },
    },
    latencyP50Ms: null, latencyP95Ms: null, byModel: [], byPurpose: [], byPhase: [],
    planningEfficiency: {
      turnCount: 0, requestCount: 0, repairRequestCount: 0, repairRate: null, requestsPerTurn: null,
      estimatedCostMicros: 0, estimatedCostUnknownCount: 0, estimatedCostPerTurnMicros: null,
      cachedTokens: 0, promptTokens: 0, cacheHitTokenRatio: null,
    },
    rollupCheckpoint: {
      schemaVersion: 1, cursor: null, processedEventCount: 0, activeUserDirtySources: [],
      lastRunStartedAt: null, lastSuccessfulRunAt: null, lastFailureAt: null, lastFailureCategory: null, updatedAt: '2026-10-13T00:00:00.000Z',
    },
  };
}

function planningFixture(count: number): ObservabilityPlanningAnalysisReadModel {
  return {
    environment: 'production', fromDate: '2026-10-07', toDate: '2026-10-13', reportingTimeZone: 'Asia/Tokyo',
    aggregate: {
      sessionCount: count, previewReachedCount: 0, approvalReachedCount: 0, saveCompletedCount: 0,
      abandonedCount: 0, failedCount: 0, fallbackUsedCount: 0, semanticRepairUsedCount: 0,
      staleObservedCount: 0, unscheduledObservedCount: 0, approvalFailureObservedCount: 0,
      turnCountSum: 0, firstPreviewTurnIndexSum: 0, firstPreviewTurnIndexKnownCount: 0,
    },
    rates: {
      previewRate: null, approvalRate: null, saveRate: null, failureObservedRate: null, fallbackRate: null,
      semanticRepairRate: null, staleObservedRate: null, unscheduledObservedRate: null,
      approvalFailureObservedRate: null, averageTurns: null, averageTurnsToFirstPreview: null,
    },
    byAppVersion: [], bySchedulerVersion: [], byPromptVersion: [], byModel: [], daily: [],
    measurementStartedAt: null, lastUpdatedAt: null, abandonedMeasured: false,
  };
}

let renderer: ReactTestRenderer | undefined;
let requests: ReturnType<typeof deferred>[];
function cards() { return renderer!.root.findAllByProps({ className: 'admin-overview-metric panel' }); }
function count() { return cards()[0]?.findByType('strong').children.join(''); }
function text() { return JSON.stringify(renderer!.toJSON()); }
async function changeEnvironment(value: string) {
  await act(async () => { renderer!.root.findByType('select').props.onChange({ target: { value } }); });
}
async function refresh() {
  await act(async () => { renderer!.root.findAllByType('button').find((button) => button.children.includes('更新'))!.props.onClick(); });
}
async function fail(index: number, message: string) {
  await act(async () => { requests[index].reject(new Error(message)); });
}

beforeEach(() => {
  requests = [];
  for (const service of Object.values(services)) {
    service.mockReset().mockImplementation(() => {
      const request = deferred(); requests.push(request); return request.promise;
    });
  }
  vi.stubGlobal('window', {
    location: { pathname: '/admin/analysis', search: '?from=2026-10-07&to=2026-10-13' },
    history: { replaceState: vi.fn() },
  });
});
afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; vi.unstubAllGlobals(); });

for (const { name, Page, service, fixture } of [
  { name: 'AI/API', Page: AdminAiApiPage, service: services.ai, fixture: aiFixture },
  { name: 'Planning', Page: AdminPlanningPage, service: services.planning, fixture: planningFixture },
]) {
  describe(`${name} current query snapshots`, () => {
    async function resolve(index: number, value: number) {
      await act(async () => { requests[index].resolve({ ...fixture(value), ...service.mock.calls[index][0] }); });
    }
    async function show() { await act(async () => { renderer = create(<Page />); }); }

    it('hides the prior environment through pending/failure and recovers on retry', async () => {
      await show(); await resolve(0, 101);
      expect(count()).toBe('101');
      await changeEnvironment('preview');
      expect(service.mock.calls[1][0].environment).toBe('preview');
      expect(cards()).toHaveLength(0);
      await fail(1, 'preview unavailable');
      expect(text()).toContain('preview unavailable');
      expect(cards()).toHaveLength(0);
      await refresh(); await resolve(2, 202);
      expect(count()).toBe('202');
      expect(text()).not.toContain('preview unavailable');
    });

    it('hides the prior period while retaining the applied query for invalid drafts', async () => {
      await show(); await resolve(0, 101);
      await act(async () => { renderer!.root.findAllByProps({ type: 'date' })[0].props.onChange({ target: { value: '' } }); });
      expect(requests).toHaveLength(1);
      expect(count()).toBe('101');
      await act(async () => { renderer!.root.findAllByProps({ type: 'date' })[0].props.onChange({ target: { value: '2026-10-08' } }); });
      expect(service.mock.calls[1][0].fromDate).toBe('2026-10-08');
      expect(cards()).toHaveLength(0);
      await resolve(1, 202);
      expect(count()).toBe('202');
    });

    it('hides old metrics during same-condition refresh and after its failure', async () => {
      await show(); await resolve(0, 101); await refresh();
      expect(service.mock.calls[1][0]).toEqual(service.mock.calls[0][0]);
      expect(cards()).toHaveLength(0);
      await fail(1, 'refresh unavailable');
      expect(cards()).toHaveLength(0);
      await refresh(); await resolve(2, 303);
      expect(count()).toBe('303');
    });

    it.each(['success', 'failure'] as const)('ignores an obsolete %s after the latest environment succeeds', async (outcome) => {
      await show(); await resolve(0, 101);
      await changeEnvironment('preview'); await changeEnvironment('test');
      await resolve(2, 303);
      if (outcome === 'success') await resolve(1, 202);
      else await fail(1, 'obsolete preview failure');
      expect(count()).toBe('303');
      expect(text()).not.toContain('obsolete preview failure');
      expect(renderer!.root.findByType('select').props.value).toBe('test');
    });
  });
}
