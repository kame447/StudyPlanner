import { describe, expect, it } from 'vitest';
import type {
  GenericSchedulerInputCompilationResult,
} from './weeklyPlanningGenericSchedulerInput';
import {
  decideWeeklyPlanningStableDialogueV5,
  evaluateWeeklyPlanningStablePreviewGateV5,
} from './weeklyPlanningStableDialoguePolicyV5';

function compilation(
  overrides: Partial<GenericSchedulerInputCompilationResult> = {},
): GenericSchedulerInputCompilationResult {
  return {
    status: 'ready',
    input: {
      version: 'weekly-planning-generic-scheduler-input-v2',
      graphRevision: 3,
      ownerId: 'owner-1',
      horizon: {
        startDate: '2026-07-24',
        endDate: '2026-07-24',
        timeZone: 'Asia/Tokyo',
        planningWindowFactIds: [],
      },
      movableWorkItems: [],
      fixedTaskReservations: [],
      taskDateEligibilities: [],
      availabilityWindows: [],
      sourceSelections: [],
      relations: [],
      sourceFactRefs: [],
    },
    issues: [],
    ...overrides,
  };
}

describe('Stable V5 dialogue policy', () => {
  it('selects exactly one highest-priority blocking question', () => {
    const result = decideWeeklyPlanningStableDialogueV5(compilation({
      status: 'needs_resolution',
      input: null,
      issues: [
        {
          domain: 'work_item',
          code: 'missing_effort_estimate',
          blocking: true,
          factId: 'workload-1',
        },
        {
          domain: 'availability',
          code: 'constraint_source_unavailable',
          blocking: true,
          factId: 'source-request-1',
          details: { kind: 'calendar' },
        },
        {
          domain: 'deduplication',
          code: 'fixed_task_movable_work_suppressed',
          blocking: false,
          factId: 'workload-fixed',
          details: { taskId: 'task-fixed', workItemId: 'work-item-fixed' },
        },
      ],
    }));

    expect(result).toEqual({
      policyVersion: 'weekly-planning-stable-dialogue-policy-v5',
      status: 'ask_question',
      question: {
        domain: 'availability',
        code: 'constraint_source_unavailable',
        factId: 'source-request-1',
        details: { kind: 'calendar' },
      },
      previewEligible: false,
    });
  });

  it('marks only a ready scheduler result as preview eligible', () => {
    expect(decideWeeklyPlanningStableDialogueV5(compilation())).toMatchObject({
      status: 'ready_for_preview',
      question: null,
      previewEligible: true,
    });
    expect(decideWeeklyPlanningStableDialogueV5(compilation({
      status: 'empty',
      input: null,
    }))).toMatchObject({
      status: 'nothing_to_schedule',
      question: null,
      previewEligible: false,
    });
  });

  it('requires explicit conversation- and revision-bound authorization', () => {
    const ready = compilation();
    expect(evaluateWeeklyPlanningStablePreviewGateV5({
      compilation: ready,
      conversationId: 'conversation-1',
      graphRevision: 3,
      authorization: null,
    })).toEqual({ allowed: false, reason: 'authorization_missing' });

    expect(evaluateWeeklyPlanningStablePreviewGateV5({
      compilation: ready,
      conversationId: 'conversation-1',
      graphRevision: 3,
      authorization: {
        authorized: true,
        conversationId: 'conversation-2',
        graphRevision: 3,
      },
    })).toEqual({
      allowed: false,
      reason: 'authorization_conversation_mismatch',
    });

    expect(evaluateWeeklyPlanningStablePreviewGateV5({
      compilation: ready,
      conversationId: 'conversation-1',
      graphRevision: 3,
      authorization: {
        authorized: true,
        conversationId: 'conversation-1',
        graphRevision: 2,
      },
    })).toEqual({
      allowed: false,
      reason: 'authorization_revision_mismatch',
    });

    expect(evaluateWeeklyPlanningStablePreviewGateV5({
      compilation: ready,
      conversationId: 'conversation-1',
      graphRevision: 3,
      authorization: {
        authorized: true,
        conversationId: 'conversation-1',
        graphRevision: 3,
      },
    })).toEqual({ allowed: true, reason: 'allowed' });
  });

  it('rejects preview when scheduler compilation is not ready', () => {
    expect(evaluateWeeklyPlanningStablePreviewGateV5({
      compilation: compilation({ status: 'needs_resolution', input: null }),
      conversationId: 'conversation-1',
      graphRevision: 3,
      authorization: {
        authorized: true,
        conversationId: 'conversation-1',
        graphRevision: 3,
      },
    })).toEqual({ allowed: false, reason: 'scheduler_not_ready' });
  });
});
