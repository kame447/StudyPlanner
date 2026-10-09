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
  isLapsedLearningStrategyProposal,
} from './weeklyPlanningStableV5LearningStrategyProposal';
import { evaluateWeeklyPlanningInsufficientCapacityProposalV5 } from './weeklyPlanningStableV5CapacityProposal';

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
      presentedProposalId: null,
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
      presentedProposalId: null,
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
      presentedProposalId: null,
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
      presentedProposalId: proposalId,
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

  it('does not let a decision settle a pending proposal that was not the presented question', () => {
    const first = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      presentedProposalId: null,
      document: document({ activityKind: 'memorization_retrieval' }),
      localToFactId: { task: 'task-public', workload: 'workload-public' },
      compilation: compilation(),
      graphRevision: 1,
      turnId: 'turn-1',
    });
    const proposalId = first.pendingProposal!.id;
    for (const presentedProposalId of [null, 'some-other-presented-proposal']) {
      const result = evaluateWeeklyPlanningLearningStrategyProposalsV5({
        presentedProposalId,
        previousState: state(first.records),
        document: document({ activityKind: 'unknown', decision: { proposalId, decision: 'accept' } }),
        localToFactId: {},
        compilation: compilation(),
        graphRevision: 1,
        turnId: 'turn-2',
      });
      expect(result.acceptedSpacedProposal).toBeNull();
      expect(result.records.find((record) => record.id === proposalId)).toMatchObject({
        status: 'pending',
        decidedAtTurnId: null,
      });
    }
  });

  it('keeps rejected strategy proposals from becoming scheduling policy', () => {
    const first = evaluateWeeklyPlanningLearningStrategyProposalsV5({
      presentedProposalId: null,
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
      presentedProposalId: proposalId,
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
      presentedProposalId: null,
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
      presentedProposalId: null,
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
      presentedProposalId: null,
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

describe('optional proposal lifecycle: presented once, then decided or lapsed (Issue #488 X2)', () => {
  const pendingRecords = () => evaluateWeeklyPlanningLearningStrategyProposalsV5({
    presentedProposalId: null,
    document: document({ activityKind: 'memorization_retrieval' }),
    localToFactId: { task: 'task-public', workload: 'workload-public' },
    compilation: compilation(),
    graphRevision: 1,
    turnId: 'turn-1',
  });
  const nextTurn = (params: {
    records: ReturnType<typeof pendingRecords>['records'];
    presentedProposalId: string | null;
    doc: WeeklyPlanningSemanticDocumentV5;
    turnId: string;
    restrictToPresentedProposal?: boolean;
    graphChanged?: boolean;
  }) => evaluateWeeklyPlanningLearningStrategyProposalsV5({
    presentedProposalId: params.presentedProposalId,
    previousState: state(params.records),
    document: params.doc,
    localToFactId: {},
    compilation: compilation(),
    graphRevision: 1,
    turnId: params.turnId,
    restrictToPresentedProposal: params.restrictToPresentedProposal,
    graphChanged: params.graphChanged ?? true,
  });
  const withActs = (acts: Array<{ kind: string; targetPublicId: null }>, planning: boolean): WeeklyPlanningSemanticDocumentV5 => ({
    ...(planning ? document({ activityKind: 'problem_solving' }) : document({ activityKind: 'unknown', decision: undefined }) ),
    ...(planning ? {} : { tasks: [], planningWindow: null }),
    conversationActs: acts,
  } as unknown as WeeklyPlanningSemanticDocumentV5);

  it('lapses a fresh presented proposal that the next turn does not decide, and never re-presents or re-creates it', () => {
    const first = pendingRecords();
    const id = first.pendingProposal!.id;
    const second = nextTurn({ records: first.records, presentedProposalId: id, doc: withActs([], true), turnId: 'turn-2' });
    expect(second.pendingProposal).toBeNull();
    expect(isLapsedLearningStrategyProposal(second.records[0])).toBe(true);
    expect(second.records[0]).toMatchObject({ status: 'pending', decidedAtTurnId: 'turn-2' });
    const third = nextTurn({ records: second.records, presentedProposalId: null, doc: document({ activityKind: 'memorization_retrieval' }), turnId: 'turn-3' });
    expect(third.pendingProposal).toBeNull();
    expect(third.records).toHaveLength(1);
  });

  it('a turn that applied no graph change (empty reading, acknowledgement shell, recovery) never lapses it', () => {
    const first = pendingRecords();
    for (const doc of [withActs([], false), withActs([], true), withActs([{ kind: 'answer_pending_question', targetPublicId: null }], true)]) {
      const second = nextTurn({
        records: first.records, presentedProposalId: first.pendingProposal!.id, doc, turnId: 'turn-2', graphChanged: false,
      });
      expect(second.pendingProposal?.id).toBe(first.pendingProposal!.id);
      expect(second.records[0].decidedAtTurnId).toBeNull();
    }
  });

  it('does not lapse a proposal that was not freshly presented', () => {
    const first = pendingRecords();
    const second = nextTurn({ records: first.records, presentedProposalId: null, doc: withActs([], true), turnId: 'turn-2' });
    expect(second.pendingProposal?.id).toBe(first.pendingProposal!.id);
    expect(second.records[0].decidedAtTurnId).toBeNull();
  });

  it.each([
    ['explanation request', [{ kind: 'ask_about_pending_question', targetPublicId: null }], true, false],
    ['consultation without planning content', [{ kind: 'consultation_request', targetPublicId: null }], false, false],
    ['topic shift without planning content', [{ kind: 'topic_shift', targetPublicId: null }], false, false],
    ['consultation with planning content', [{ kind: 'consultation_request', targetPublicId: null }], true, true],
  ] as const)('%s: lapses=%s', (_label, acts, planning, lapses) => {
    const first = pendingRecords();
    const second = nextTurn({
      records: first.records, presentedProposalId: first.pendingProposal!.id, doc: withActs([...acts], planning), turnId: 'turn-2',
    });
    expect(isLapsedLearningStrategyProposal(second.records[0])).toBe(lapses);
    expect(second.pendingProposal === null).toBe(lapses);
  });

  it('a later decision on a lapsed proposal is neither a silent acceptance nor a rejection', () => {
    const first = pendingRecords();
    const id = first.pendingProposal!.id;
    const lapsed = nextTurn({ records: first.records, presentedProposalId: id, doc: withActs([], true), turnId: 'turn-2' });
    for (const decision of ['accept', 'reject'] as const) {
      const later = nextTurn({
        records: lapsed.records, presentedProposalId: id,
        doc: document({ activityKind: 'unknown', decision: { proposalId: id, decision } }), turnId: 'turn-3',
      });
      expect(later.acceptedSpacedProposal).toBeNull();
      expect(later.records[0]).toMatchObject({ status: 'pending', decidedAtTurnId: 'turn-2' });
    }
  });

  it('legacy (unrestricted) decisions keep the pending gate: nothing lapses', () => {
    const first = pendingRecords();
    const second = nextTurn({
      records: first.records, presentedProposalId: first.pendingProposal!.id, doc: withActs([], true), turnId: 'turn-2',
      restrictToPresentedProposal: false,
    });
    expect(second.pendingProposal?.id).toBe(first.pendingProposal!.id);
    expect(second.records[0].decidedAtTurnId).toBeNull();
  });

  it('a capacity proposal lapses the same way and the capacity path does not re-present it', () => {
    const spacing = { ...pendingRecords().records[0], status: 'accepted' as const, decidedAtTurnId: 'turn-2' };
    const capacity = {
      ...spacing, id: 'wpp_capacity_x', kind: 'mixed_acquisition_review' as const, status: 'pending' as const, decidedAtTurnId: null,
      capacityStrategy: { trigger: 'insufficient_capacity' as const, acquisition: 'longer_sessions' as const,
        review: 'short_distributed_sessions' as const, unscheduledWorkItemIds: ['item-1'] },
    };
    const lapsed = nextTurn({ records: [spacing, capacity], presentedProposalId: 'wpp_capacity_x', doc: withActs([], true), turnId: 'turn-3' });
    expect(lapsed.records.find((record) => record.id === 'wpp_capacity_x')).toMatchObject({ status: 'pending', decidedAtTurnId: 'turn-3' });
    const again = evaluateWeeklyPlanningInsufficientCapacityProposalV5({
      records: lapsed.records,
      compilation: { status: 'ready', issues: [], input: { movableWorkItems: [{ id: 'item-1', workloadFactId: 'workload-public' }] } } as never,
      preview: { status: 'insufficient_capacity', unscheduledWorkItemIds: ['item-1'] },
      graphRevision: 1,
      turnId: 'turn-4',
    });
    expect(again.pendingProposal).toBeNull();
    expect(again.records).toHaveLength(lapsed.records.length);
  });
});
