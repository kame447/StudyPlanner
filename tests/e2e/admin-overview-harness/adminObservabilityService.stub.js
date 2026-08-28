const latency = {
  version: 'latency-ms-v1',
  bucketCounts: [0, 0, 2, 12, 3, 1, 0, 0, 0, 0],
  sampleCount: 18,
  sumMs: 17600,
  minMs: 320,
  maxMs: 2800,
};

function aiAggregate(requestCount, costMicros, tokenCount) {
  return {
    requestCount,
    successCount: Math.max(0, requestCount - 1),
    failureCount: requestCount > 0 ? 1 : 0,
    statusCounts: requestCount > 0 ? { success: Math.max(0, requestCount - 1), provider_error: 1 } : {},
    promptTokens: Math.round(tokenCount * 0.65),
    promptTokensUnknownCount: 0,
    completionTokens: Math.round(tokenCount * 0.35),
    completionTokensUnknownCount: 0,
    totalTokens: tokenCount,
    totalTokensUnknownCount: requestCount > 3 ? 1 : 0,
    cachedTokens: Math.round(tokenCount * 0.1),
    cachedTokensUnknownCount: 0,
    estimatedCostMicros: costMicros,
    estimatedCostUnknownCount: requestCount > 3 ? 1 : 0,
    latency,
  };
}

const dates = ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'];
const active = [18, 21, 17, 28, 31, 34, 38];
const plans = [9, 11, 8, 14, 18, 16, 20];

const daily = dates.map((localDate, index) => ({
  schemaVersion: 1,
  environment: 'production',
  localDate,
  reportingTimeZone: 'Asia/Tokyo',
  processedEventCount: 20 + index * 3,
  activeActorCount: active[index],
  firstOccurredAt: `${localDate}T00:30:00.000Z`,
  lastOccurredAt: `${localDate}T13:30:00.000Z`,
  productActivity: {
    eventCount: plans[index] + 12,
    actionCounts: {
      plan_created: plans[index],
      plan_updated: 5 + index,
      actual_recorded: 4 + index,
      todo_completed: 3 + (index % 3),
      weekly_planning_opened: 2 + (index % 2),
    },
  },
  ai: aiAggregate(3 + index, 120000 + index * 25000, 1800 + index * 300),
  aiByModel: [],
  aiByPurpose: [],
  aiByPhase: [],
  planning: {
    outcomeCounts: {
      session_started: 2 + index,
      preview_generated: 2 + Math.max(0, index - 1),
      save_completed: 1 + Math.max(0, index - 2),
      unscheduled_observed: index % 3 === 0 ? 1 : 0,
      failed: index === 4 ? 1 : 0,
    },
    previewCountSum: 2 + index,
    previewCountUnknownCount: 0,
    unscheduledCountSum: index % 3 === 0 ? 1 : 0,
    unscheduledCountUnknownCount: 0,
  },
  planningBySchedulerVersion: [],
  planningByPromptVersion: [],
  planningByModel: [],
  updatedAt: `${localDate}T14:00:00.000Z`,
  expireAt: '2027-10-01T00:00:00.000Z',
}));

export async function getAdminObservabilityOverview() {
  return {
    schemaVersion: 1,
    fromDate: '2026-08-23',
    toDate: '2026-08-29',
    reportingTimeZone: 'Asia/Tokyo',
    registeredUsers: {
      total: 1284,
      newInPeriod: 48,
      registrationIndexReady: true,
      scope: 'firebase_project',
    },
    period: {
      processedEventCount: 284,
      firstOccurredAt: '2026-08-23T00:30:00.000Z',
      lastOccurredAt: '2026-08-29T13:30:00.000Z',
      productActivity: {
        eventCount: 206,
        actionCounts: {
          plan_created: 96,
          plan_updated: 56,
          actual_recorded: 49,
          todo_completed: 28,
          weekly_planning_opened: 18,
        },
      },
      ai: aiAggregate(44, 2680000, 48200),
      planning: {
        outcomeCounts: {
          session_started: 39,
          preview_generated: 32,
          save_completed: 27,
          unscheduled_observed: 4,
          failed: 2,
        },
        previewCountSum: 32,
        previewCountUnknownCount: 0,
        unscheduledCountSum: 4,
        unscheduledCountUnknownCount: 0,
      },
    },
    daily,
    activeUsers: {
      schemaVersion: 1,
      environment: 'production',
      asOfDate: '2026-08-29',
      reportingTimeZone: 'Asia/Tokyo',
      today: 38,
      last7Days: 214,
      last30Days: 572,
      updatedAt: '2026-08-29T14:00:00.000Z',
      expireAt: '2027-10-01T00:00:00.000Z',
    },
    aiLatencyP50Ms: 820,
    aiLatencyP95Ms: 2780,
    rollupCheckpoint: {
      schemaVersion: 1,
      cursor: { observedAt: '2026-08-29T13:30:00.000Z', documentName: 'observability_events/latest' },
      processedEventCount: 9384,
      activeUserDirtySources: [],
      lastRunStartedAt: '2026-08-29T14:00:00.000Z',
      lastSuccessfulRunAt: '2026-08-29T14:00:02.000Z',
      lastFailureAt: null,
      lastFailureCategory: null,
      updatedAt: '2026-08-29T14:00:02.000Z',
    },
  };
}

export async function getAdminObservabilityUsers() {
  return { users: [], nextCursor: null };
}
