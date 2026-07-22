import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningFactGraphV5';
import {
  compileGenericSchedulerInput,
} from './weeklyPlanningGenericSchedulerInput';
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
      value: '2026-07-22から2026-07-28',
      start: '2026-07-22',
      end: '2026-07-28',
      sourceText: '2026年7月22日から28日までの計画',
    },
    tasks: [
      {
        localId: 'task-study',
        category: 'study',
        title: '英単語',
        study: {
          purpose: 'self_study',
          contextLabel: null,
          components: [],
        },
        workloads: [
          {
            localId: 'workload-study',
            quantityRole: 'target',
            amount: 60,
            unitCode: 'minute',
            unitLabel: '分',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '英単語を60分進める',
          },
        ],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'allowed-study',
            targetLocalId: 'task-study',
            kind: 'allowed_date',
            constraintLevel: 'hard',
            dateExpression: '2026-07-24',
            namedTimePeriod: null,
            startTime: null,
            endTime: null,
            precision: 'exact',
            sourceText: '24日に行う',
          },
        ],
        recurrence: [],
        sourceText: '英単語を60分進める',
      },
      {
        localId: 'task-fixed',
        category: 'non_study',
        title: 'アルバイト',
        study: null,
        workloads: [],
        effortEstimates: [],
        temporalConstraints: [
          {
            localId: 'fixed-work',
            targetLocalId: 'task-fixed',
            kind: 'fixed_interval',
            constraintLevel: 'hard',
            dateExpression: '2026-07-23',
            namedTimePeriod: null,
            startTime: '18:00',
            endTime: '22:00',
            precision: 'exact',
            sourceText: '23日は18時から22時までアルバイト',
          },
        ],
        recurrence: [],
        sourceText: 'アルバイト',
      },
    ],
    relations: [
      {
        localId: 'relation-1',
        kind: 'before',
        fromLocalId: 'task-fixed',
        toLocalId: 'task-study',
        sourceText: 'アルバイトの後に英単語を進める',
      },
    ],
    availabilityDeclarations: [
      {
        localId: 'availability-1',
        kind: 'unavailable',
        dateExpression: '2026-07-24',
        namedTimePeriod: null,
        startTime: '12:00',
        endTime: '13:00',
        recurrenceKind: null,
        days: [],
        constraintLevel: 'hard',
        sourceText: '24日の12時から13時は空いていない',
      },
    ],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  };
}

describe('Stable V5 generic scheduler input compatibility', () => {
  it('compiles Fact Graph V5 directly without Alpha or Graph V1 projection', () => {
    const canonical = canonicalizeWeeklyPlanningSemanticDocumentV5({
      graph: createEmptyWeeklyPlanningFactGraphV5(),
      document: document(),
      context: {
        conversationId: 'conversation-v5',
        turnId: 'turn-scheduler',
        expectedRevision: 0,
      },
    });

    expect(canonical.status).toBe('applied');
    const compiled = compileGenericSchedulerInput({
      graph: canonical.graph,
      context: {
        ownerId: 'owner-1',
        currentDate: '2026-07-22',
        planningStartDate: '2026-07-22',
        planningEndDate: '2026-07-28',
        timeZone: 'Asia/Tokyo',
      },
    });

    expect(compiled.status).toBe('ready');
    expect(compiled.input).not.toBeNull();
    expect(compiled.input).toMatchObject({
      version: 'weekly-planning-generic-scheduler-input-v2',
      graphRevision: 1,
      ownerId: 'owner-1',
      horizon: {
        startDate: '2026-07-22',
        endDate: '2026-07-28',
        timeZone: 'Asia/Tokyo',
        planningWindowFactIds: [canonical.localToFactId['window-1']],
      },
    });
    expect(compiled.input?.movableWorkItems).toEqual([
      expect.objectContaining({
        taskId: canonical.localToFactId['task-study'],
        workloadFactId: canonical.localToFactId['workload-study'],
        estimatedMinutes: 60,
      }),
    ]);
    expect(compiled.input?.fixedTaskReservations).toEqual([
      expect.objectContaining({
        taskId: canonical.localToFactId['task-fixed'],
        temporalConstraintFactId: canonical.localToFactId['fixed-work'],
        start: { date: '2026-07-23', time: '18:00' },
        end: { date: '2026-07-23', time: '22:00' },
      }),
    ]);
    expect(compiled.input?.taskDateEligibilities).toEqual([
      {
        taskId: canonical.localToFactId['task-study'],
        allowedDates: ['2026-07-24'],
        excludedDates: [],
        sourceFactIds: [canonical.localToFactId['allowed-study']],
      },
    ]);
    expect(compiled.input?.availabilityWindows).toEqual([
      expect.objectContaining({
        kind: 'unavailable',
        start: { date: '2026-07-24', time: '12:00' },
        end: { date: '2026-07-24', time: '13:00' },
        sourceRef: canonical.localToFactId['availability-1'],
      }),
    ]);
    expect(compiled.input?.relations).toEqual([
      {
        factId: canonical.localToFactId['relation-1'],
        kind: 'before',
        fromTaskId: canonical.localToFactId['task-fixed'],
        toTaskId: canonical.localToFactId['task-study'],
      },
    ]);
    expect(compiled.input?.sourceFactRefs).toEqual(expect.arrayContaining([
      canonical.localToFactId['window-1'],
      canonical.localToFactId['task-study'],
      canonical.localToFactId['workload-study'],
      canonical.localToFactId['allowed-study'],
      canonical.localToFactId['task-fixed'],
      canonical.localToFactId['fixed-work'],
      canonical.localToFactId['availability-1'],
      canonical.localToFactId['relation-1'],
    ]));
    expect(compiled.issues).toEqual([]);
  });
});
