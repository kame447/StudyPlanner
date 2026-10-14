import { describe, expect, it, vi } from 'vitest';
import type { Plan, Actual } from '../../../types/domain';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import type { WeeklyPlanningTurnExecutionInput, WeeklyPlanningTurnExecutionResult } from '../weeklyPlanningTurnExecutionTypes';
import { renderWeeklyPlanningStableV5AssistantMessageCore, type WeeklyPlanningTurnDialoguePorts } from './weeklyPlanningStableV5TurnDialogueCore';
import type { WeeklyPlanningStableV5DialogueRenderInput } from './weeklyPlanningStableV5DialogueContracts';

const DATE = '2026-10-15';
const OWNER = 'owner-1';
const USER_TEXT = '今日の予定立てて';

function plan(userId = OWNER): Plan {
  return {
    id: 'math-plan', seriesId: 'math-plan', userId,
    title: '数学の復習', subject: '数学', type: 'study',
    date: '2026-10-11', startTime: '15:00', endTime: '16:00',
    repeat: 'none', repeatUntil: null, excludedDates: [], recurrenceRules: [],
    memo: 'private memo: do not send', createdAt: DATE, updatedAt: DATE,
  };
}

function actual(): Actual {
  return {
    id: 'math-actual', userId: OWNER, planId: 'math-plan',
    occurrenceDate: '2026-10-11', actualStartTime: '15:00', actualEndTime: '16:00',
    subject: '数学', note: 'private actual note',
    updatedAt: DATE,
  };
}

function turn(plans: Plan[] = [plan()], actuals: Actual[] = [actual()]): WeeklyPlanningTurnExecutionInput {
  return {
    userId: OWNER, conversationId: 'weekly-conversation',
    traceRequestId: 'weekly-conversation:request:1',
    userText: USER_TEXT,
    selectedDate: DATE,
    messages: [],
    plans, actuals, scheduleTemplates: [],
  };
}

function pendingResult(code: string): WeeklyPlanningTurnExecutionResult {
  return {
    state: {
      ...createInitialPlanningIntakeState(),
      status: 'revision_pending',
      questions: ['何をする？'],
      lastQuestionContext: {
        kind: 'missing', targetSlot: `stable_v5:${code}`, intent: code,
      },
    },
    message: '何をする？',
    draftCandidates: [],
  } as WeeklyPlanningTurnExecutionResult;
}

function rendererSpy() {
  const capture = vi.fn(async (_input: WeeklyPlanningStableV5DialogueRenderInput) => ({
    status: 'rendered' as const,
    text: '今日は何を進めたいですか？',
    rawResponse: '{"text":"今日は何を進めたいですか？"}',
  }));
  const ports = {
    createRenderer: () => ({ render: capture }),
    getSession: () => null,
  } as WeeklyPlanningTurnDialoguePorts;
  return { capture, ports };
}

describe('read-only reference context enters only appropriate conversational rendering', () => {
  it('binds past user evidence for an unscoped activity question without accepting any new facts', async () => {
    const { capture, ports } = rendererSpy();
    const input = turn();
    const original = pendingResult('missing_schedulable_work');
    const result = await renderWeeklyPlanningStableV5AssistantMessageCore({
      input, result: original,
    }, ports);
    expect(result.responseSource).toBe('ai');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture.mock.calls[0][0]).toMatchObject({
      actionKind: 'question',
      questionIntent: { kind: 'schedulable_work_detail', mode: 'missing_task_identity' },
      referenceContext: {
        referenceDate: DATE,
        pastActivities: [{ source: 'completed', label: '数学の復習', date: '2026-10-11' }],
        targetDateCommitments: [],
      },
    });
    expect(result.stableV5Graph).toBeUndefined();
    expect(result.state.lastQuestionContext?.targetSlot).toBe('stable_v5:missing_schedulable_work');
    expect(JSON.stringify(capture.mock.calls[0][0])).not.toContain('private');
  });

  it('does not inject history into an unrelated effort question', async () => {
    const { capture, ports } = rendererSpy();
    await renderWeeklyPlanningStableV5AssistantMessageCore({
      input: turn(),
      result: pendingResult('missing_effort_estimate'),
    }, ports);
    expect(capture.mock.calls[0][0].referenceContext).toBeUndefined();
  });

  it('does not borrow a different owner\'s past activity as an example', async () => {
    const { capture, ports } = rendererSpy();
    await renderWeeklyPlanningStableV5AssistantMessageCore({
      input: turn([plan('other')], []),
      result: pendingResult('missing_schedulable_work'),
    }, ports);
    expect(capture.mock.calls[0][0].referenceContext).toBeUndefined();
  });
});
