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
  resolveWeeklyPlanningTaskDateRules,
} from './weeklyPlanningTaskDateRuleResolver';

function document(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan',
    planningWindow: {
      localId: 'window-1',
      kind: 'absolute',
      value: '2026-07-22から2026-07-28',
      start: '2026-07-22',
      end: '2026-07-28',
      sourceText: '2026年7月22日から28日',
    },
    tasks: [
      {
        localId: 'task-1',
        category: 'study',
        title: '英単語',
        study: {
          purpose: 'self_study',
          contextLabel: null,
          components: [],
        },
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'excluded-1',
            targetLocalId: 'task-1',
            kind: 'excluded_date',
            constraintLevel: 'hard',
            dateExpression: '2026-07-25',
            namedTimePeriod: null,
            startTime: null,
            endTime: null,
            precision: 'exact',
            sourceText: '25日はやらない',
          },
        ],
        recurrence: [
          {
            localId: 'recurrence-1',
            targetLocalId: 'task-1',
            kind: 'weekly',
            count: null,
            days: ['wed', 'fri', 'sat', 'sun'],
            sourceText: '水曜と金曜から日曜',
          },
        ],
        sourceText: '英単語を水曜と金曜から日曜にやる',
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

describe('Stable V5 task date resolver compatibility', () => {
  it('passes Fact Graph V5 directly to the common resolver without projection', () => {
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document(),
      context: {
        conversationId: 'conversation-v5',
        turnId: 'turn-1',
        expectedRevision: 0,
      },
    });

    expect(canonical.status).toBe('applied');
    const resolved = resolveWeeklyPlanningTaskDateRules({
      graph: canonical.graph,
      currentDate: '2026-07-22',
      planningStartDate: '2026-07-22',
      planningEndDate: '2026-07-28',
    });
    const taskId = canonical.localToFactId['task-1'];

    expect(resolved.readiness).toBe('ready');
    expect(resolved.issues).toEqual([]);
    expect(resolved.eligibilities).toEqual([
      {
        taskId,
        allowedDates: ['2026-07-22', '2026-07-24', '2026-07-26'],
        excludedDates: ['2026-07-25'],
        sourceFactIds: [
          canonical.localToFactId['excluded-1'],
          canonical.localToFactId['recurrence-1'],
        ].sort(),
      },
    ]);
  });
});
