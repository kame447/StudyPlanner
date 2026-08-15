import { afterEach, describe, expect, it } from 'vitest';
import type { Actual, Plan } from '../../../types/domain';
import {
  clearWeeklyPlanningMemoryPaceRuntimeV5,
  setWeeklyPlanningMemoryPaceRuntimeV5,
} from '../personalization/weeklyPlanningMemoryPaceRuntimeV5';
import type { WeeklyPlanningGenericSchedulerGraphView } from './weeklyPlanningGenericSchedulerInput';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticTypesV5';
import { projectWeeklyPlanningMemoryObservedPaceV5 } from './weeklyPlanningMemoryObservedPaceProjectionV5';

const ownerId = 'owner-memory-pace';

function plan(): Plan {
  return {
    id: 'plan-calibration', seriesId: 'plan-calibration', userId: ownerId,
    title: '英単語のペース計測', subject: '英語', date: '2026-08-17',
    startTime: '09:00', endTime: '09:20', repeat: 'none', repeatUntil: null,
    excludedDates: [], recurrenceRules: [], type: 'study', memo: '',
    createdAt: '2026-08-16T00:00:00.000Z', updatedAt: '2026-08-16T00:00:00.000Z',
    weeklyPlanningObservationSource: {
      version: 1, kind: 'memory_pace_calibration', activityKind: 'memorization_retrieval',
      conversationId: 'conversation-old', graphRevision: 4, taskId: 'task-old',
      workloadFactId: 'workload-old', sessionEffortFactId: 'effort-session-old',
      unitCode: 'word', unitLabel: '語', targetAmount: 220, plannedSessionMinutes: 20,
    },
  };
}

function actual(): Actual {
  return {
    id: 'actual-calibration', userId: ownerId, planId: 'plan-calibration',
    occurrenceDate: '2026-08-17', actualStartTime: '09:00', actualEndTime: '09:20',
    subject: '英語', isAlignedToPlan: true, note: '', updatedAt: '2026-08-17T00:00:00.000Z',
    weeklyPlanningObservationResult: {
      version: 1, kind: 'memory_pace_calibration', progressAmount: 35,
      unitCode: 'word', unitLabel: '語',
    },
  };
}

function graph(explicit = false): WeeklyPlanningGenericSchedulerGraphView {
  const source = {
    conversationId: 'conversation-new', turnId: 'turn-1', semanticLocalId: 'workload',
    sourceText: '英単語220語', origin: 'user' as const,
  };
  const tasks = [{
    id: 'task', category: 'study' as const, title: '英単語', source, createdRevision: 1,
  }] as unknown as WeeklyPlanningGenericSchedulerGraphView['tasks'];
  return {
    revision: 1,
    planningWindows: [],
    tasks,
    components: [],
    workloads: [{
      id: 'workload', taskId: 'task', componentId: null, quantityRole: 'target',
      amount: 220, unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
      perOccurrence: false, periodExpression: null, source, createdRevision: 1,
    }],
    effortEstimates: explicit ? [{
      id: 'effort-explicit', taskId: 'task', targetFactId: 'workload',
      kind: 'duration_per_unit', minutes: 1, unitCode: 'word', precision: 'exact',
      source, createdRevision: 1,
    }] : [],
    temporalConstraints: [], taskDateRules: [], recurrences: [], relations: [],
    uncertainties: [], availabilityDeclarations: [], constraintSourceRequests: [],
  };
}

function document(activityKind: 'memorization_retrieval' | 'problem_solving'): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'create_plan', planningWindow: null,
    tasks: [{
      localId: 'task-local', category: 'study', title: '英単語', sourceText: '英単語220語',
      study: { purpose: 'self_study', activityKind, contextLabel: null, components: [] },
      workloads: [{
        localId: 'workload-local', quantityRole: 'target', amount: 220,
        unitCode: 'word', unitLabel: '語', rangeStart: null, rangeEnd: null,
        perOccurrence: false, periodExpression: null, sourceText: '220語',
      }],
      effortEstimates: [], temporalConstraints: [], recurrence: [],
    }],
    relations: [], availabilityDeclarations: [], constraintSourceRequests: [],
    uncertainties: [], corrections: [], decisions: [],
  };
}

afterEach(() => clearWeeklyPlanningMemoryPaceRuntimeV5(ownerId));

describe('observed memory pace scheduler projection', () => {
  it('uses persisted pace only after Luna classified the workload as memorization', () => {
    setWeeklyPlanningMemoryPaceRuntimeV5({ ownerId, plans: [plan()], actuals: [actual()] });
    const result = projectWeeklyPlanningMemoryObservedPaceV5({
      ownerId, graph: graph(), document: document('memorization_retrieval'),
      localToFactId: { 'task-local': 'task', 'workload-local': 'workload' }, previousRecords: [],
    });
    expect(result.appliedWorkloadFactIds).toEqual(['workload']);
    const observed = result.graph.effortEstimates.find((item) =>
      item.id.startsWith('observed-memory-pace:'));
    expect(observed?.kind).toBe('duration_per_unit');
    expect(observed?.minutes).toBeCloseTo(20 / 35);
  });

  it('does not infer memorization from the word unit alone', () => {
    setWeeklyPlanningMemoryPaceRuntimeV5({ ownerId, plans: [plan()], actuals: [actual()] });
    const result = projectWeeklyPlanningMemoryObservedPaceV5({
      ownerId, graph: graph(), document: document('problem_solving'),
      localToFactId: { 'task-local': 'task', 'workload-local': 'workload' }, previousRecords: [],
    });
    expect(result.appliedWorkloadFactIds).toEqual([]);
    expect(result.graph.effortEstimates).toHaveLength(0);
  });

  it('keeps an explicit current estimate ahead of observed history', () => {
    setWeeklyPlanningMemoryPaceRuntimeV5({ ownerId, plans: [plan()], actuals: [actual()] });
    const result = projectWeeklyPlanningMemoryObservedPaceV5({
      ownerId, graph: graph(true), document: document('memorization_retrieval'),
      localToFactId: { 'task-local': 'task', 'workload-local': 'workload' }, previousRecords: [],
    });
    expect(result.appliedWorkloadFactIds).toEqual([]);
    expect(result.graph.effortEstimates).toHaveLength(1);
    expect(result.graph.effortEstimates[0].minutes).toBe(1);
  });
});
