import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  resolveWeeklyPlanningAvailability,
} from './weeklyPlanningAvailabilityResolver';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-24',
      start: '2026-07-24',
      end: '2026-07-24',
      sourceText: '24日の計画',
    },
    tasks: [],
    relations: [],
    availabilityDeclarations: [
      {
        localId: 'availability-1',
        kind: 'unavailable',
        dateExpression: '2026-07-24',
        namedTimePeriod: null,
        startTime: '18:00',
        endTime: '20:00',
        recurrenceKind: null,
        days: [],
        constraintLevel: 'hard',
        sourceText: '24日の18時から20時は空いていない',
      },
    ],
    constraintSourceRequests: [
      {
        localId: 'source-request-1',
        kind: 'calendar',
        selector: 'active',
        requestedAction: 'use',
        sourceText: '登録済みカレンダーも使う',
      },
    ],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 availability resolver compatibility', () => {
  it('passes Fact Graph V5 directly while preserving source ownership checks', () => {
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document(),
      context: {
        conversationId: 'conversation-v5',
        turnId: 'turn-availability',
        expectedRevision: 0,
      },
    });
    expect(canonical.status).toBe('applied');

    const resolved = resolveWeeklyPlanningAvailability({
      graph: canonical.graph,
      context: {
        ownerId: 'owner-1',
        currentDate: '2026-07-22',
        planningStartDate: '2026-07-24',
        planningEndDate: '2026-07-24',
        timeZone: 'Asia/Tokyo',
      },
      externalSources: [
        {
          kind: 'calendar',
          status: 'success',
          ownerId: 'owner-1',
          activeSourceId: 'calendar-active',
          events: [
            {
              eventId: 'event-1',
              ownerId: 'owner-1',
              start: { date: '2026-07-24', time: '10:00' },
              end: { date: '2026-07-24', time: '11:00' },
              timeZone: 'Asia/Tokyo',
              constraintLevel: 'hard',
            },
          ],
          attemptCount: 1,
        },
      ],
    });

    expect(resolved.readiness).toBe('ready');
    expect(resolved.issues).toEqual([]);
    expect(resolved.windows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'unavailable',
        start: { date: '2026-07-24', time: '18:00' },
        end: { date: '2026-07-24', time: '20:00' },
        sourceKind: 'user_declaration',
        sourceRef: canonical.localToFactId['availability-1'],
        graphRevision: 1,
      }),
      expect.objectContaining({
        kind: 'occupied',
        start: { date: '2026-07-24', time: '10:00' },
        end: { date: '2026-07-24', time: '11:00' },
        sourceKind: 'calendar',
        sourceRef: 'event-1',
        graphRevision: 1,
      }),
    ]));
    expect(resolved.sourceSelections).toEqual([
      expect.objectContaining({
        requestFactId: canonical.localToFactId['source-request-1'],
        kind: 'calendar',
        status: 'selected',
        sourceId: 'calendar-active',
        ownerId: 'owner-1',
        graphRevision: 1,
      }),
    ]);
  });
});
