import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ObservabilityOverviewReadModel } from '../../shared/productObservabilityReadModel';
import { createEmptyLatencyHistogram } from '../../workers/ai-proxy/src/productObservabilityReadModelProjection';

const overviewFixture: ObservabilityOverviewReadModel = {
  schemaVersion: 1,
  fromDate: '2026-08-22',
  toDate: '2026-08-28',
  reportingTimeZone: 'Asia/Tokyo',
  registeredUsers: {
    total: 128,
    newInPeriod: 7,
    registrationIndexReady: true,
    scope: 'firebase_project',
  },
  period: {
    processedEventCount: 60,
    firstOccurredAt: '2026-08-22T00:00:00.000Z',
    lastOccurredAt: '2026-08-28T12:00:00.000Z',
    productActivity: {
      eventCount: 30,
      actionCounts: {
        plan_created: 12,
        plan_updated: 8,
        actual_recorded: 6,
        todo_completed: 4,
      },
    },
    ai: {
      requestCount: 20,
      successCount: 18,
      failureCount: 2,
      statusCounts: { success: 18, timeout: 2 },
      promptTokens: 10_000,
      promptTokensUnknownCount: 0,
      completionTokens: 5_000,
      completionTokensUnknownCount: 0,
      totalTokens: 15_000,
      totalTokensUnknownCount: 1,
      cachedTokens: 1_000,
      cachedTokensUnknownCount: 0,
      estimatedCostMicros: 2_500_000,
      estimatedCostUnknownCount: 1,
      latency: {
        ...createEmptyLatencyHistogram(),
        sampleCount: 20,
        sumMs: 18_000,
        minMs: 300,
        maxMs: 2_800,
        bucketCounts: [0, 0, 2, 13, 4, 1, 0, 0, 0, 0],
      },
    },
    planning: {
      outcomeCounts: {
        session_started: 10,
        preview_generated: 8,
        save_completed: 6,
        unscheduled_observed: 2,
        failed: 1,
      },
      previewCountSum: 8,
      previewCountUnknownCount: 0,
      unscheduledCountSum: 2,
      unscheduledCountUnknownCount: 0,
    },
  },
  daily: [
    {
      schemaVersion: 1,
      environment: 'production',
      localDate: '2026-08-28',
      reportingTimeZone: 'Asia/Tokyo',
      processedEventCount: 10,
      activeActorCount: 5,
      firstOccurredAt: '2026-08-28T00:00:00.000Z',
      lastOccurredAt: '2026-08-28T12:00:00.000Z',
      productActivity: {
        eventCount: 6,
        actionCounts: {
          plan_created: 3,
          plan_updated: 1,
          actual_recorded: 1,
          todo_completed: 1,
        },
      },
      ai: {
        requestCount: 2,
        successCount: 2,
        failureCount: 0,
        statusCounts: { success: 2 },
        promptTokens: 1_000,
        promptTokensUnknownCount: 0,
        completionTokens: 500,
        completionTokensUnknownCount: 0,
        totalTokens: 1_500,
        totalTokensUnknownCount: 0,
        cachedTokens: 100,
        cachedTokensUnknownCount: 0,
        estimatedCostMicros: 250_000,
        estimatedCostUnknownCount: 0,
        latency: createEmptyLatencyHistogram(),
      },
      aiByModel: [],
      aiByPurpose: [],
      aiByPhase: [],
      planning: {
        outcomeCounts: { save_completed: 1 },
        previewCountSum: 1,
        previewCountUnknownCount: 0,
        unscheduledCountSum: 0,
        unscheduledCountUnknownCount: 0,
      },
      planningBySchedulerVersion: [],
      planningByPromptVersion: [],
      planningByModel: [],
      updatedAt: '2026-08-28T12:05:00.000Z',
      expireAt: '2027-10-01T00:00:00.000Z',
    },
  ],
  activeUsers: {
    schemaVersion: 1,
    environment: 'production',
    asOfDate: '2026-08-28',
    reportingTimeZone: 'Asia/Tokyo',
    today: 5,
    last7Days: 21,
    last30Days: 42,
    updatedAt: '2026-08-28T12:05:00.000Z',
    expireAt: '2027-10-01T00:00:00.000Z',
  },
  aiLatencyP50Ms: 800,
  aiLatencyP95Ms: 2_800,
  rollupCheckpoint: {
    schemaVersion: 1,
    cursor: null,
    processedEventCount: 60,
    activeUserDirtySources: [],
    lastRunStartedAt: '2026-08-28T12:05:00.000Z',
    lastSuccessfulRunAt: '2026-08-28T12:05:00.000Z',
    lastFailureAt: null,
    lastFailureCategory: null,
    updatedAt: '2026-08-28T12:05:00.000Z',
  },
};

vi.mock('../hooks/useAdminData', () => ({
  useAdminDataLoader: () => ({
    loadState: 'ready',
    data: overviewFixture,
    errorMessage: '',
  }),
}));

vi.mock('../services/adminObservabilityService', () => ({
  getAdminObservabilityOverview: vi.fn(),
}));

import { AdminOverviewPage } from './AdminOverviewPage';

describe('AdminOverviewPage', () => {
  it('renders meaningful labels and preserves unknown usage states', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<AdminOverviewPage navigate={vi.fn()} />);
    });

    const text = JSON.stringify(renderer!.toJSON());
    expect(text).toContain('Overview');
    expect(text).toContain('登録ユーザー数');
    expect(text).toContain('過去7日間の利用ユーザー');
    expect(text).toContain('通常の応答時間');
    expect(text).toContain('遅いケースの応答時間');
    expect(text).toContain('一部未計測');
    expect(text).toContain('Planning保存完了');
    expect(text).not.toContain('Planning品質スコア');
  });

  it('keeps future drill-down buttons disabled until their phases are implemented', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<AdminOverviewPage navigate={vi.fn()} />);
    });

    const disabledButtons = renderer!.root.findAll(
      (node) => node.type === 'button' && node.props.disabled === true,
    );
    expect(disabledButtons.map((button) => button.children.join(' '))).toEqual(
      expect.arrayContaining([
        'AI・APIの詳細は次フェーズ',
        'Planningの詳細は次フェーズ',
        'Systemの詳細は次フェーズ',
      ]),
    );
  });
});
