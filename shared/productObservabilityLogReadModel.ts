export const OBSERVABILITY_DEBUG_BUNDLE_SCHEMA = 'studyplanner-debug-bundle' as const;
export const OBSERVABILITY_DEBUG_BUNDLE_SCHEMA_VERSION = 1 as const;

export type ObservabilityLogSeverity = 'debug' | 'info' | 'warn' | 'error';
export type ObservabilityDiagnosticSource = 'weekly_planning_trace';

export interface ObservabilityLogSessionSummary {
  source: ObservabilityDiagnosticSource;
  traceSessionId: string;
  subjectAlias: string;
  status: string;
  severity: ObservabilityLogSeverity;
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  planningRangeStart: string | null;
  planningRangeEnd: string | null;
  entryCount: number;
  turnCount: number;
  hasPreview: boolean;
  hasApprovalFailure: boolean;
  hasFallback: boolean;
  hasError: boolean;
  appVersion: string | null;
  traceSchemaVersion: number | null;
  summary: string;
}

export interface ObservabilityLogSessionPage {
  sessions: ObservabilityLogSessionSummary[];
  nextCursor: string | null;
}

export interface ObservabilityLogEntryProjection {
  id: string;
  source: ObservabilityDiagnosticSource;
  feature: 'weekly_planning';
  occurredAt: string;
  severity: ObservabilityLogSeverity;
  subjectAlias: string;
  traceSessionId: string;
  requestId: string | null;
  stateRevision: number | null;
  eventType: string;
  summary: string;
  detail: Record<string, unknown>;
}

export interface ObservabilityLogEntryPage {
  entries: ObservabilityLogEntryProjection[];
  totalEntryCount: number;
  nextAfterSequence: number | null;
  responseBytes: number;
}

export interface ObservabilityDebugBundleSelection {
  source: ObservabilityDiagnosticSource;
  traceSessionId: string;
  requestId: string | null;
  period: {
    from: string;
    to: string;
  };
}

export interface ObservabilityDebugBundleVersions {
  appVersion: string | null;
  traceSchemaVersion: number | null;
  models: string[];
  promptVersions: string[];
  schedulerVersions: string[];
}

export interface ObservabilityDebugBundleV1 {
  schema: typeof OBSERVABILITY_DEBUG_BUNDLE_SCHEMA;
  schemaVersion: typeof OBSERVABILITY_DEBUG_BUNDLE_SCHEMA_VERSION;
  generatedAt: string;
  selection: ObservabilityDebugBundleSelection;
  correlation: {
    subjectAlias: string;
    traceSessionId: string;
    requestIds: string[];
  };
  versions: ObservabilityDebugBundleVersions;
  metrics: {
    sessionStatus: string;
    turnCount: number;
    totalEntryCount: number;
    includedEntryCount: number;
    hasPreview: boolean;
    hasApprovalFailure: boolean;
    hasFallback: boolean;
    hasError: boolean;
  };
  entries: ObservabilityLogEntryProjection[];
  redactionSummary: {
    policy: 'weekly_planning_trace_admin_redaction_v1';
    sensitiveIdentityFieldsRemoved: true;
    secretFieldsRemoved: true;
    textPatternRedactionApplied: true;
  };
  truncationSummary: {
    availableEntryCount: number;
    includedEntryCount: number;
    omittedEntryCount: number;
    entryLimit: number;
    scanLimit: number;
    scanLimitReached: boolean;
    byteLimit: number;
    byteLimitReached: boolean;
  };
}
