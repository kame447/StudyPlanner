import type {
  AiRequestMetricStatus,
  ObservabilityEnvironment,
  PlanningOutcomeType,
  ProductActivityAction,
} from './productObservabilityContract';
import type {
  ObservabilityAiAggregate,
  ObservabilityRollupCheckpoint,
  ObservabilityUserSummary,
} from './productObservabilityReadModel';

export interface ObservabilityAiDimensionSummary {
  key: string;
  aggregate: ObservabilityAiAggregate;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
}

export interface ObservabilityAiAnalysisReadModel {
  fromDate: string;
  toDate: string;
  environment: ObservabilityEnvironment;
  reportingTimeZone: 'Asia/Tokyo';
  total: ObservabilityAiAggregate;
  latencyP50Ms: number | null;
  latencyP95Ms: number | null;
  byModel: ObservabilityAiDimensionSummary[];
  byPurpose: ObservabilityAiDimensionSummary[];
  byPhase: ObservabilityAiDimensionSummary[];
  rollupCheckpoint: ObservabilityRollupCheckpoint;
}

export interface ObservabilityUserTimelineAiDetail {
  purpose: string;
  phase: 'initial' | 'repair' | 'single' | 'unknown';
  provider: 'openai' | 'gemini';
  model: string;
  status: AiRequestMetricStatus;
  totalTokens: number | null;
  estimatedCostMicros: number | null;
  durationMs: number;
}

export interface ObservabilityUserTimelineItem {
  eventId: string;
  eventType: 'product_activity' | 'ai_request_metric' | 'planning_outcome';
  occurredAt: string;
  appVersion: string;
  productAction: ProductActivityAction | null;
  ai: ObservabilityUserTimelineAiDetail | null;
  planningOutcome: PlanningOutcomeType | null;
  featureSessionId: string | null;
  requestId: string | null;
  traceSessionId: string | null;
}

export interface ObservabilityUserInvestigationReadModel {
  environment: ObservabilityEnvironment;
  actorSubjectId: string;
  summary: ObservabilityUserSummary | null;
  activeDayCount: number;
  timeline: ObservabilityUserTimelineItem[];
  nextCursor: {
    orderedValue: string;
    documentName: string;
  } | null;
}
