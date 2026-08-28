const latency = {
  version: 'latency-ms-v1',
  bucketCounts: [0, 0, 2, 12, 3, 1, 0, 0, 0, 0],
  sampleCount: 18,
  sumMs: 17600,
  minMs: 320,
  maxMs: 2800,
};

function aiAggregate(requestCount, costMicros, tokenCount, cachedTokens = Math.round(tokenCount * 0.1)) {
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
    cachedTokens,
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

const users = [
  {
    schemaVersion: 1,
    actorSubjectId: 'actor-aaaaaaaa-1111-2222-3333-444444444444',
    firstActivityAt: '2026-08-20T01:10:00.000Z',
    lastActivityAt: '2026-08-29T11:40:00.000Z',
    firstActivityDate: '2026-08-20',
    lastActivityDate: '2026-08-29',
    eventCount: 88,
    productActivityCount: 51,
    aiRequestCount: 24,
    planningOutcomeCount: 13,
    lastProductAction: 'plan_updated',
    lastPlanningOutcome: 'save_completed',
    updatedAt: '2026-08-29T11:40:01.000Z',
  },
  {
    schemaVersion: 1,
    actorSubjectId: 'actor-bbbbbbbb-1111-2222-3333-555555555555',
    firstActivityAt: '2026-08-22T02:20:00.000Z',
    lastActivityAt: '2026-08-29T09:15:00.000Z',
    firstActivityDate: '2026-08-22',
    lastActivityDate: '2026-08-29',
    eventCount: 43,
    productActivityCount: 29,
    aiRequestCount: 8,
    planningOutcomeCount: 6,
    lastProductAction: 'actual_recorded',
    lastPlanningOutcome: 'preview_generated',
    updatedAt: '2026-08-29T09:15:01.000Z',
  },
  {
    schemaVersion: 1,
    actorSubjectId: 'actor-cccccccc-1111-2222-3333-666666666666',
    firstActivityAt: '2026-08-25T03:00:00.000Z',
    lastActivityAt: '2026-08-28T08:00:00.000Z',
    firstActivityDate: '2026-08-25',
    lastActivityDate: '2026-08-28',
    eventCount: 17,
    productActivityCount: 15,
    aiRequestCount: 0,
    planningOutcomeCount: 2,
    lastProductAction: 'todo_completed',
    lastPlanningOutcome: 'session_started',
    updatedAt: '2026-08-28T08:00:01.000Z',
  },
];

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
  return { users, nextCursor: null };
}

export async function resolveAdminObservabilityUserIdentity() {
  return [{
    firebaseUid: 'firebase-user-example',
    email: 'student@example.com',
    username: 'Sample Student',
    registeredAt: '2026-08-18T02:30:00.000Z',
    actorSubjectId: users[0].actorSubjectId,
  }];
}

export async function getAdminObservabilityUserInvestigation() {
  return {
    environment: 'production',
    actorSubjectId: users[0].actorSubjectId,
    summary: users[0],
    activeDayCount: 8,
    nextCursor: null,
    timeline: [
      {
        eventId: 'planning-save-1',
        eventType: 'planning_outcome',
        occurredAt: '2026-08-29T11:40:00.000Z',
        appVersion: '2026.8.29',
        productAction: null,
        ai: null,
        planningOutcome: 'save_completed',
        featureSessionId: 'planning-session-42',
        requestId: null,
        traceSessionId: 'trace-session-42',
      },
      {
        eventId: 'ai-request-42',
        eventType: 'ai_request_metric',
        occurredAt: '2026-08-29T11:39:40.000Z',
        appVersion: '2026.8.29',
        productAction: null,
        ai: {
          purpose: 'weekly_planning_semantic_normalizer',
          phase: 'repair',
          provider: 'openai',
          model: 'gpt-5.6-luna',
          status: 'success',
          totalTokens: 1840,
          cachedTokens: 920,
          cacheWriteTokens: 120,
          reasoningTokens: 88,
          estimatedCostMicros: 164000,
          durationMs: 1420,
        },
        planningOutcome: null,
        featureSessionId: 'planning-session-42',
        requestId: 'ai-request-42',
        traceSessionId: 'trace-session-42',
      },
      {
        eventId: 'activity-plan-1',
        eventType: 'product_activity',
        occurredAt: '2026-08-29T10:20:00.000Z',
        appVersion: '2026.8.29',
        productAction: 'plan_updated',
        ai: null,
        planningOutcome: null,
        featureSessionId: null,
        requestId: null,
        traceSessionId: null,
      },
    ],
  };
}

export async function getAdminObservabilityAiAnalysis() {
  const modelLuna = aiAggregate(28, 1920000, 31800, 9200);
  const modelMini = aiAggregate(16, 760000, 16400, 2800);
  return {
    fromDate: '2026-08-23',
    toDate: '2026-08-29',
    environment: 'production',
    reportingTimeZone: 'Asia/Tokyo',
    total: aiAggregate(44, 2680000, 48200, 12000),
    latencyP50Ms: 820,
    latencyP95Ms: 2780,
    byModel: [
      { key: 'gpt-5.6-luna', aggregate: modelLuna, latencyP50Ms: 800, latencyP95Ms: 2600 },
      { key: 'gpt-5.6-mini', aggregate: modelMini, latencyP50Ms: 620, latencyP95Ms: 1900 },
    ],
    byPurpose: [
      { key: 'weekly_planning_semantic_normalizer', aggregate: modelLuna, latencyP50Ms: 800, latencyP95Ms: 2600 },
      { key: 'weekly_planning_renderer', aggregate: modelMini, latencyP50Ms: 620, latencyP95Ms: 1900 },
    ],
    byPhase: [
      { key: 'initial', aggregate: aiAggregate(21, 1360000, 25000, 7000), latencyP50Ms: 760, latencyP95Ms: 2400 },
      { key: 'repair', aggregate: aiAggregate(7, 560000, 6800, 2200), latencyP50Ms: 980, latencyP95Ms: 2800 },
      { key: 'single', aggregate: aiAggregate(16, 760000, 16400, 2800), latencyP50Ms: 620, latencyP95Ms: 1900 },
    ],
    planningEfficiency: {
      sessionCount: 18,
      requestCount: 44,
      repairRequestCount: 7,
      repairRate: 0.25,
      requestsPerSession: 2.44,
      estimatedCostMicros: 2680000,
      estimatedCostUnknownCount: 1,
      estimatedCostPerSessionMicros: null,
      cachedTokens: 12000,
      promptTokens: 31300,
      cacheHitTokenRatio: 0.3834,
    },
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
