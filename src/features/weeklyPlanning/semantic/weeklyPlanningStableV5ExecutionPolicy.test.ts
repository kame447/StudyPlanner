import { describe, expect, it } from 'vitest';
import type {
  PlanningTaskFact,
  StudyContextFact,
  WorkloadFact,
} from './weeklyPlanningFactGraph';
import type { GenericPlanningWorkItem } from './weeklyPlanningGenericWorkItems';
import {
  DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
  deriveWeeklyPlanningSessionPolicyV5,
  inferWeeklyPlanningExecutionProfileV5,
  splitWeeklyPlanningSessionMinutesV5,
} from './weeklyPlanningStableV5ExecutionPolicy';

const source = {
  conversationId: 'conversation-execution-policy',
  turnId: 'turn-1',
  semanticLocalId: 'local',
  sourceText: 'test',
  origin: 'user' as const,
};

function graph(params: {
  unitCode?: WorkloadFact['unitCode'];
  purpose?: StudyContextFact['purpose'];
}) {
  const task: PlanningTaskFact = {
    id: 'task-1',
    category: 'study',
    title: '任意の名前',
    source,
    createdRevision: 1,
  };
  const workload: WorkloadFact = {
    id: 'workload-1',
    taskId: task.id,
    componentId: null,
    quantityRole: 'target',
    amount: 1,
    unitCode: params.unitCode ?? 'hour',
    unitLabel: '単位',
    rangeStart: null,
    rangeEnd: null,
    perOccurrence: false,
    periodExpression: null,
    source,
    createdRevision: 1,
  };
  const studyContexts: StudyContextFact[] = params.purpose
    ? [{
        id: 'study-context-1',
        taskId: task.id,
        purpose: params.purpose,
        contextLabel: null,
        source,
        createdRevision: 1,
      }]
    : [];
  return { tasks: [task], studyContexts, workloads: [workload] };
}

function item(): GenericPlanningWorkItem {
  return {
    version: 'weekly-planning-generic-work-item-v1',
    id: 'item-1',
    taskId: 'task-1',
    componentId: null,
    workloadFactId: 'workload-1',
    label: '任意の名前 1単位',
    quantityRole: 'target',
    actionability: 'actionable',
    quantity: {
      amount: 1,
      unitCode: 'hour',
      unitLabel: '単位',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: 180,
    estimateBasis: 'intrinsic_duration',
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'splittable',
    periodExpression: null,
    sourceFactRefs: ['task-1', 'workload-1'],
  };
}

describe('Stable V5 structured execution policy', () => {
  it('keeps an unknown task neutral instead of inferring from its title', () => {
    const value = inferWeeklyPlanningExecutionProfileV5({ graph: graph({}), item: item() });
    expect(value).toEqual(DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5);
    expect(deriveWeeklyPlanningSessionPolicyV5({ profile: value })).toMatchObject({
      mode: 'balanced',
      minSessionMinutes: 45,
      targetSessionMinutes: 90,
      maxSessionMinutes: 120,
      allowSmallRemainder: false,
    });
  });

  it('maps word workloads to the legacy short-focus characteristics without lexical matching', () => {
    const value = inferWeeklyPlanningExecutionProfileV5({
      graph: graph({ unitCode: 'word' }),
      item: item(),
    });
    expect(value).toMatchObject({
      cognitiveLoad: 2,
      contextRetentionCost: 2,
      chunkability: 5,
      feedbackGranularity: 5,
      fatigueRisk: 2,
      switchingCost: 2,
      repetitionBenefit: 5,
    });
    expect(deriveWeeklyPlanningSessionPolicyV5({ profile: value })).toMatchObject({
      mode: 'short_focus',
      minSessionMinutes: 30,
      targetSessionMinutes: 60,
      maxSessionMinutes: 90,
      allowSmallRemainder: true,
    });
  });

  it('maps structured research purpose to deep-work policy', () => {
    const value = inferWeeklyPlanningExecutionProfileV5({
      graph: graph({ purpose: 'research' }),
      item: item(),
    });
    expect(deriveWeeklyPlanningSessionPolicyV5({ profile: value })).toMatchObject({
      mode: 'deep_work',
      minSessionMinutes: 60,
      targetSessionMinutes: 105,
      maxSessionMinutes: 120,
      allowSmallRemainder: false,
    });
  });

  it('uses a persisted preferred session length only as a bounded deterministic target', () => {
    const policy = deriveWeeklyPlanningSessionPolicyV5({
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
      preferredSessionMinutes: 73,
    });
    expect(policy).toMatchObject({
      mode: 'balanced',
      targetSessionMinutes: 75,
      personalizedTargetApplied: true,
    });
    expect(splitWeeklyPlanningSessionMinutesV5({
      totalMinutes: 150,
      policy,
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
    })).toEqual([75, 75]);
  });

  it('rebalances long work around the target instead of emitting a tiny tail', () => {
    const policy = deriveWeeklyPlanningSessionPolicyV5({
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
    });
    expect(splitWeeklyPlanningSessionMinutesV5({
      totalMinutes: 220,
      policy,
      profile: DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
    })).toEqual([110, 110]);
  });

  it('preserves total minutes and max-session bound across an adversarial range', () => {
    const profiles = [
      DEFAULT_WEEKLY_PLANNING_EXECUTION_PROFILE_V5,
      inferWeeklyPlanningExecutionProfileV5({ graph: graph({ unitCode: 'word' }), item: item() }),
      inferWeeklyPlanningExecutionProfileV5({ graph: graph({ purpose: 'research' }), item: item() }),
    ];
    for (const profile of profiles) {
      const policy = deriveWeeklyPlanningSessionPolicyV5({ profile });
      for (let total = 1; total <= 1440; total += 1) {
        const chunks = splitWeeklyPlanningSessionMinutesV5({ totalMinutes: total, policy, profile });
        expect(chunks.reduce((sum, value) => sum + value, 0)).toBe(total);
        expect(chunks.every((value) => value > 0 && value <= policy.maxSessionMinutes)).toBe(true);
      }
    }
  });
});
