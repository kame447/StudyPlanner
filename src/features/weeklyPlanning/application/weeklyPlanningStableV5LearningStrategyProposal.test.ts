import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import type { GenericSchedulerInputCompilationResult } from '../semantic/weeklyPlanningGenericSchedulerInput';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type SemanticStudyActivityKindV5,
  type WeeklyPlanningSemanticDocumentV5,
} from '../semantic/weeklyPlanningSemanticDocumentV5';
import {
  evaluateWeeklyPlanningLearningStrategyProposalsV5,
} from './weeklyPlanningStableV5LearningStrategyProposal';

function document(params: {
  activityKind: SemanticStudyActivityKindV5;
  decision?: { proposalId: string; decision: 'accept' | 'reject' };
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: params.decision ? 'discuss' : 'create_plan',
    planningWindow: params.decision
      ? null
      : {
          localId: 'window',
          kind: 'absolute',
          value: '2026-08-17/2026-08-23',
          start: '2026-08-17',
          end: '2026-08-23',
          sourceText: '8月17日から23日',
        },
    tasks: params.decision
      ? []
      : [{
          localId: 'task',
          category: 'study',
          title: '暗記学習',
          study: {
            purpose: 'self_study',
            activityKind: params.activityKind,
            contextLabel: '暗記学習',
            components: [],
          },
          workloads: [{
            localId: 'workload',
            quantityRole: 'target',
            amount: 100,
            unitCode: 'custom',
            unitLabel: '項目',
            rangeStart: null,
            rangeEnd: null,
            perOccurrence: false,
            periodExpression: null,
            sourceText: '100項目覚える',
          }],
          effortEstimates: [],
          temporalConstraints: [],
          recurrence: [],
          sourceText: '100項目覚える',
        }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    uncertainties: [],
    corrections: [],
    decisions: params.decision
      ? [{
          localId: 'decision',
          target: {
            kind: 'proposal',
            publicId: params.decision.proposalId,
            localId: null,
            mention: null,
          },
          decision: params.decision.decision,
          sourceText: params.decision.decision === 'accept' ? 'それでお願いします' : '今回はやめておく',
        }]
      : [],
  };
}

function compilation(): GenericSchedulerInputCompilationResult {
  return {
    status: 'needs_resolution',
    input: null,
    issues: [{
      domain: 'work_item',
      code: 'missing_effort_estimate',
      blocking: true,
      factId: 'workload-public',
    }],
  };
}

function state(records: NonNullable<PlanningIntakeState['learningStrategyProposalRecords']>): PlanningIntakeState {
  return {
    status: 'revision_pending',
    intent: 'weekly_study_planning',
    tasks: [],
    progress: [],
    unitRates: [],
    constraints: [],
    priorityPolicy: { kind: 'unknown' },
    missing: [],
    assumptions: [],
    uncertainties: [],
    questions: [],
    shouldCreateDraft: false,
    shouldSavePlan: false,
    learningStrategyProposalRecords: records,
    sourceTurns: [],
  };
}

describe('Stable V5 learning strategy proposal policy', () => {
  it('proposes spaced memory practice for memorization work without inferring it from a unit label', () => {
    const result = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      document: document({ activityKind: 'memorization_retrieval' }),
      localToFactId: {
        task: 'task-public',
        workload: 'workload-public',
      },
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-1',
    });

    expect(result.pendingProposal).toMatchObject({
      kind: 'spaced_memory_practice',
      taskId: 'task-public',
      workloadFactId: 'workload-public',
      status: 'pending',
      suggestedSessionMinutes: { min: 15, max: 30 },
    });
    expect(result.records).toHaveLength(1);
  });

  it('does not propose the memory strategy for problem-solving work', () => {
    const result = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      document: document({ activityKind: 'problem_solving' }),
      localToFactId: {
        task: 'task-public',
        workload: 'workload-public',
      },
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-1',
    });

    expect(result.records).toEqual([]);
    expect(result.pendingProposal).toBeNull();
  });

  it('accepts only the exact pending proposal and preserves that decision in weekly state', () => {
    const first = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      document: document({ activityKind: 'memorization_retrieval' }),
      localToFactId: {
        task: 'task-public',
        workload: 'workload-public',
      },
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-1',
    });
    const proposalId = first.pendingProposal!.id;

    const accepted = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      previousState: state(first.records),
      document: document({
        activityKind: 'unknown',
        decision: { proposalId, decision: 'accept' },
      }),
      localToFactId: {},
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-2',
    });

    expect(accepted.pendingProposal).toBeNull();
    expect(accepted.acceptedSpacedProposal).toMatchObject({
      id: proposalId,
      status: 'accepted',
      decidedAtTurnId: 'turn-2',
    });
    expect(accepted.records).toHaveLength(1);
  });

  it('keeps rejected strategy proposals from becoming scheduling policy', () => {
    const first = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      document: document({ activityKind: 'memorization_retrieval' }),
      localToFactId: {
        task: 'task-public',
        workload: 'workload-public',
      },
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-1',
    });
    const proposalId = first.pendingProposal!.id;

    const rejected = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      previousState: state(first.records),
      document: document({
        activityKind: 'unknown',
        decision: { proposalId, decision: 'reject' },
      }),
      localToFactId: {},
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-2',
    });

    expect(rejected.pendingProposal).toBeNull();
    expect(rejected.acceptedSpacedProposal).toBeNull();
    expect(rejected.records[0]).toMatchObject({
      id: proposalId,
      status: 'rejected',
      decidedAtTurnId: 'turn-2',
    });
  });

  it('proposes one pace-calibration session after an accepted spacing strategy and one-session duration', () => {
    const first = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      document: document({ activityKind: 'memorization_retrieval' }),
      localToFactId: {
        task: 'task-public',
        workload: 'workload-public',
      },
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-1',
    });
    const acceptedSpacing = first.records.map((record) => ({
      ...record,
      status: 'accepted' as const,
      decidedAtTurnId: 'turn-2',
    }));

    const calibrated = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      previousState: state(acceptedSpacing),
      document: document({ activityKind: 'unknown' }),
      localToFactId: {},
      compilation: compilation(),
      effortEstimates: [{
        targetFactId: 'workload-public',
        kind: 'session_duration',
        minutes: 20,
        unitCode: 'custom',
      }],
      graphRevision: 2,
      turnId: 'turn-3',
    });

    expect(calibrated.pendingProposal).toMatchObject({
      kind: 'calibrate_memory_pace',
      workloadFactId: 'workload-public',
      status: 'pending',
      selectedSessionMinutes: 20,
      suggestedSessionMinutes: { min: 20, max: 20 },
    });
    expect(calibrated.records).toHaveLength(2);
  });

  it('does not invent pace calibration before one-session duration is known', () => {
    const records = [{
      id: 'spacing',
      kind: 'spaced_memory_practice' as const,
      taskId: 'task-public',
      workloadFactId: 'workload-public',
      scope: 'week' as const,
      status: 'accepted' as const,
      suggestedSessionMinutes: { min: 15, max: 30 },
      selectedSessionMinutes: null,
      createdRevision: 1,
      proposedAtTurnId: 'turn-1',
      decidedAtTurnId: 'turn-2',
    }];
    const result = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      previousState: state(records),
      document: document({ activityKind: 'unknown' }),
      localToFactId: {},
      compilation: compilation(),
      effortEstimates: [],
      graphRevision: 2,
      turnId: 'turn-3',
    });

    expect(result.pendingProposal).toBeNull();
    expect(result.records).toEqual(records);
  });
});
