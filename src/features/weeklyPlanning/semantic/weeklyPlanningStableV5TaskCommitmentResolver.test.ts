import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  canonicalizeWeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticCanonicalizerV5';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  resolveWeeklyPlanningTaskCommitments,
} from './weeklyPlanningTaskCommitmentResolver';

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
      sourceText: '2026年7月24日の計画',
    },
    tasks: [
      {
        localId: 'task-1',
        category: 'non_study',
        title: 'アルバイト',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'fixed-1',
            targetLocalId: 'task-1',
            kind: 'fixed_interval',
            constraintLevel: 'hard',
            dateExpression: '2026-07-24',
            namedTimePeriod: null,
            startTime: '18:00',
            endTime: '22:00',
            precision: 'exact',
            sourceText: '24日は18時から22時までアルバイト',
          },
        ],
        recurrence: [],
        sourceText: 'アルバイト',
      },
    ],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 fixed commitment resolver compatibility', () => {
  it('passes Fact Graph V5 directly to the common commitment resolver', () => {
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document(),
      context: {
        conversationId: 'conversation-v5',
        turnId: 'turn-fixed',
        expectedRevision: 0,
      },
    });

    expect(canonical.status).toBe('applied');
    const resolved = resolveWeeklyPlanningTaskCommitments({
      graph: canonical.graph,
      context: {
        currentDate: '2026-07-22',
        planningStartDate: '2026-07-24',
        planningEndDate: '2026-07-24',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(resolved.readiness).toBe('ready');
    expect(resolved.issues).toEqual([]);
    expect(resolved.reservations).toEqual([
      expect.objectContaining({
        taskId: canonical.localToFactId['task-1'],
        temporalConstraintFactId: canonical.localToFactId['fixed-1'],
        start: { date: '2026-07-24', time: '18:00' },
        end: { date: '2026-07-24', time: '22:00' },
        timeZone: 'Asia/Tokyo',
        constraintLevel: 'hard',
        sourceKind: 'user_commitment',
        graphRevision: 1,
      }),
    ]);
  });
});
