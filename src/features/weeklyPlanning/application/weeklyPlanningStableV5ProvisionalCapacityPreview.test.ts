import { describe, expect, it } from 'vitest';
import type { WeeklyDraftCandidate } from '../scheduling/weeklyDraftCandidateGenerator';
import type { GenericSchedulerInput } from '../semantic/weeklyPlanningGenericSchedulerInput';
import type { WeeklyPlanningStableV5PreviewSchedulerResult } from '../semantic/weeklyPlanningStableV5PreviewScheduler';
import type {
  WeeklyPlanningStableV5PlanningEvaluation,
} from './weeklyPlanningStableV5PlanningEvaluation';
import {
  projectWeeklyPlanningProvisionalCapacityPreviewV5,
} from './weeklyPlanningStableV5ProvisionalCapacityPreview';
import type {
  ExecuteWeeklyPlanningStableV5RuntimeTurnInput,
} from './weeklyPlanningStableV5RuntimeContracts';

function workItem(id: string, taskId: string) {
  return {
    version: 'weekly-planning-generic-work-item-v1' as const,
    id,
    taskId,
    componentId: null,
    workloadFactId: `workload-${taskId}`,
    label: taskId,
    quantityRole: 'target' as const,
    actionability: 'actionable' as const,
    quantity: {
      amount: 60,
      unitCode: 'minute' as const,
      unitLabel: '分',
      ordinalRange: null,
      actualRange: null,
    },
    estimatedMinutes: 60,
    estimateBasis: 'intrinsic_duration' as const,
    estimateSourceFactIds: [],
    estimateSourceWorkloadFactIds: [],
    splitPolicy: 'splittable' as const,
    periodExpression: null,
    sourceFactRefs: [],
  };
}

function schedulerInput(): GenericSchedulerInput {
  return {
    version: 'weekly-planning-generic-scheduler-input-v2',
    graphRevision: 11,
    ownerId: 'owner-1',
    horizon: {
      startDate: '2026-09-05',
      endDate: '2026-09-30',
      timeZone: 'Asia/Tokyo',
      planningWindowFactIds: [],
    },
    movableWorkItems: [
      workItem('item-math', 'task-math'),
      workItem('item-english', 'task-english'),
    ],
    fixedTaskReservations: [],
    taskDateEligibilities: [],
    availabilityWindows: [],
    sourceSelections: [],
    relations: [{
      factId: 'relation-math-over-english',
      kind: 'priority_over',
      fromTaskId: 'task-math',
      toTaskId: 'task-english',
    }],
    hardDateBounds: [],
    preferredPlacements: [],
    sourceFactRefs: [],
  };
}

function candidate(taskId: string): WeeklyDraftCandidate {
  return {
    stableKey: `stable-v5:11:${taskId}:0`,
    date: '2026-09-05',
    startTime: '18:30',
    endTime: '19:30',
    durationMinutes: 60,
    title: taskId,
    field: taskId,
    year: 0,
    estimatedMinutes: 60,
    source: 'weekly_exam_prep',
    approvalStatus: 'unapproved',
    workItemKey: taskId,
    stableV5Metadata: {
      runtime: 'stable_v5',
      conversationId: 'conversation-1',
      graphRevision: 11,
      taskId,
      sourceFactRefs: [],
      planType: 'study',
    },
  } as WeeklyDraftCandidate;
}

function preview(params: {
  candidateTaskId: string;
  unscheduledWorkItemId: string;
}): WeeklyPlanningStableV5PreviewSchedulerResult {
  return {
    schedulerVersion: 'weekly-planning-stable-v5-preview-scheduler-v1',
    status: 'insufficient_capacity',
    candidates: [candidate(params.candidateTaskId)],
    unscheduledWorkItemIds: [params.unscheduledWorkItemId],
  };
}

function evaluation(source: 'current_directive' | 'session_state' | null) {
  return {
    provisionalTimeboxProjection: {
      source,
      workloadFactIds: ['workload-task-math'],
      minutesPerWorkload: 60,
      state: null,
    },
    compilation: {
      status: 'ready',
      input: schedulerInput(),
      issues: [],
    },
    activeGraph: {
      tasks: [
        { id: 'task-math', title: '数学' },
        { id: 'task-english', title: '英語' },
      ],
    },
    groundingRecords: [],
    repairDecision: { agenda: [] },
    learningStrategyProposals: { records: [] },
    dialogue: { status: 'ready_for_preview' },
  } as unknown as WeeklyPlanningStableV5PlanningEvaluation;
}

function runtimeInput() {
  return {
    userText: '総時間は分からないので、空き時間で数学を優先して暫定配分してください。',
    traceRequestId: 'turn-9',
    previousState: undefined,
  } as unknown as ExecuteWeeklyPlanningStableV5RuntimeTurnInput;
}

describe('Stable V5 provisional capacity preview policy', () => {
  it('surfaces a partial draft only when omitted work is explicitly lower priority', () => {
    const output = projectWeeklyPlanningProvisionalCapacityPreviewV5({
      input: runtimeInput(),
      evaluation: evaluation('current_directive'),
      preview: preview({
        candidateTaskId: 'task-math',
        unscheduledWorkItemId: 'item-english',
      }),
    });

    expect(output).not.toBeNull();
    expect(output?.state.status).toBe('draft_ready');
    expect(output?.draftCandidates).toHaveLength(1);
    expect(output?.message).toContain('英語');
    expect(output?.message).toContain('容量不足');
    expect(output?.message).toContain('優先順位');
    expect(output?.responseSource).toBe('system');
  });

  it('does not weaken the ordinary all-or-nothing contract without provisional permission', () => {
    const output = projectWeeklyPlanningProvisionalCapacityPreviewV5({
      input: runtimeInput(),
      evaluation: evaluation(null),
      preview: preview({
        candidateTaskId: 'task-math',
        unscheduledWorkItemId: 'item-english',
      }),
    });

    expect(output).toBeNull();
  });

  it('does not hide a failed higher-priority task behind a partial preview', () => {
    const output = projectWeeklyPlanningProvisionalCapacityPreviewV5({
      input: runtimeInput(),
      evaluation: evaluation('session_state'),
      preview: preview({
        candidateTaskId: 'task-english',
        unscheduledWorkItemId: 'item-math',
      }),
    });

    expect(output).toBeNull();
  });
});
