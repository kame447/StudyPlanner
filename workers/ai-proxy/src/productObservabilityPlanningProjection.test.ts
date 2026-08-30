import { describe, expect, it } from 'vitest';
import type {
  PlanningOutcomeMetricPayload,
  PlanningOutcomeType,
  StoredObservabilityEvent,
} from '../../../shared/productObservabilityContract';
import type {
  ObservabilityPlanningDailyCohort,
  ObservabilityPlanningSessionSummary,
} from '../../../shared/productObservabilityPlanningReadModel';
import {
  planningRates,
  projectPlanningDailyCohort,
  projectPlanningSessionSummary,
} from './productObservabilityPlanningProjection';

function event(params: {
  outcomeType: PlanningOutcomeType;
  occurredAt: string;
  observedAt?: string;
  turnIndex?: number | null;
  schedulerVersion?: string | null;
  unscheduledCount?: number | null;
  appVersion?: string;
}): StoredObservabilityEvent<PlanningOutcomeMetricPayload> {
  return {
    schemaVersion: 1,
    eventId: `planning-${params.outcomeType}-${params.observedAt ?? params.occurredAt}`,
    eventType: 'planning_outcome',
    occurredAt: params.occurredAt,
    observedAt: params.observedAt ?? params.occurredAt,
    actorSubjectId: 'actor-12345678',
    environment: 'production',
    appVersion: params.appVersion ?? '1.2.3',
    source: 'weekly_planning',
    correlation: {
      featureSessionId: 'conversation-1',
      requestId: `request-${params.outcomeType}`,
    },
    payload: {
      outcomeType: params.outcomeType,
      turnIndex: params.turnIndex ?? null,
      stateRevision: null,
      previewCount: params.outcomeType === 'preview_generated' ? 3 : null,
      unscheduledCount: params.unscheduledCount ?? null,
      fallbackUsed: null,
      repairUsed: null,
      staleObserved: null,
      approvalFailureObserved: null,
      schedulerVersion: params.schedulerVersion ?? null,
      promptVersion: null,
      model: null,
    },
    expireAt: '2026-12-31T00:00:00.000Z',
  };
}

describe('planning session cohort projection', () => {
  it('keeps later outcomes in the session-start cohort and counts each session once', () => {
    const nowIso = '2026-08-30T15:00:00.000Z';
    const events = [
      event({ outcomeType: 'turn_started', occurredAt: '2026-08-29T14:50:00.000Z', turnIndex: 1 }),
      event({ outcomeType: 'session_started', occurredAt: '2026-08-29T14:50:00.000Z', turnIndex: 1 }),
      event({ outcomeType: 'turn_started', occurredAt: '2026-08-29T15:10:00.000Z', turnIndex: 2 }),
      event({
        outcomeType: 'preview_generated',
        occurredAt: '2026-08-29T15:11:00.000Z',
        turnIndex: 2,
        schedulerVersion: 'scheduler-v3',
        unscheduledCount: 1,
      }),
      event({ outcomeType: 'approval_started', occurredAt: '2026-08-30T00:01:00.000Z' }),
      event({ outcomeType: 'save_completed', occurredAt: '2026-08-30T00:02:00.000Z' }),
    ];

    let session: ObservabilityPlanningSessionSummary | null = null;
    let cohort: ObservabilityPlanningDailyCohort | null = null;
    for (const planningEvent of events) {
      const previous = session;
      session = projectPlanningSessionSummary({ current: session, event: planningEvent, nowIso });
      cohort = projectPlanningDailyCohort({
        current: cohort,
        previousSession: previous,
        nextSession: session,
        environment: 'production',
        cohortDate: '2026-08-29',
        nowIso,
      });
    }

    expect(session.startedDate).toBe('2026-08-29');
    expect(session.turnCount).toBe(2);
    expect(session.firstPreviewTurnIndex).toBe(2);
    expect(session.saveCompleted).toBe(true);
    expect(session.unscheduledObserved).toBe(true);
    expect(cohort?.aggregate).toMatchObject({
      sessionCount: 1,
      previewReachedCount: 1,
      approvalReachedCount: 1,
      saveCompletedCount: 1,
      unscheduledObservedCount: 1,
      turnCountSum: 2,
      firstPreviewTurnIndexSum: 2,
      firstPreviewTurnIndexKnownCount: 1,
    });
    expect(planningRates(cohort!.aggregate)).toMatchObject({
      previewRate: 1,
      approvalRate: 1,
      saveRate: 1,
      averageTurns: 2,
      averageTurnsToFirstPreview: 2,
    });
  });

  it('moves a session from unknown to the observed scheduler dimension without duplicating it', () => {
    const nowIso = '2026-08-30T15:00:00.000Z';
    const started = projectPlanningSessionSummary({
      current: null,
      event: event({ outcomeType: 'session_started', occurredAt: '2026-08-29T00:00:00.000Z' }),
      nowIso,
    });
    const beforePreview = projectPlanningDailyCohort({
      current: null,
      previousSession: null,
      nextSession: started,
      environment: 'production',
      cohortDate: '2026-08-29',
      nowIso,
    });
    const previewed = projectPlanningSessionSummary({
      current: started,
      event: event({
        outcomeType: 'preview_generated',
        occurredAt: '2026-08-29T00:05:00.000Z',
        turnIndex: 1,
        schedulerVersion: 'scheduler-v3',
      }),
      nowIso,
    });
    const afterPreview = projectPlanningDailyCohort({
      current: beforePreview,
      previousSession: started,
      nextSession: previewed,
      environment: 'production',
      cohortDate: '2026-08-29',
      nowIso,
    });

    const unknown = afterPreview.bySchedulerVersion.find((entry) => entry.key === 'unknown');
    const scheduler = afterPreview.bySchedulerVersion.find((entry) => entry.key === 'scheduler-v3');
    expect(afterPreview.aggregate.sessionCount).toBe(1);
    expect(unknown?.aggregate.sessionCount).toBe(0);
    expect(scheduler?.aggregate.sessionCount).toBe(1);
    expect(scheduler?.aggregate.previewReachedCount).toBe(1);
  });

  it('does not create a cohort until the typed session_started outcome is observed', () => {
    const nowIso = '2026-08-30T15:00:00.000Z';
    const turnOnly = projectPlanningSessionSummary({
      current: null,
      event: event({ outcomeType: 'turn_started', occurredAt: '2026-08-29T00:00:00.000Z', turnIndex: 1 }),
      nowIso,
    });

    expect(turnOnly.startedAt).toBeNull();
    expect(turnOnly.startedDate).toBeNull();
    expect(turnOnly.turnCount).toBe(1);
  });
});
