import { describe, expect, it, vi } from 'vitest';
import { createInitialPlanningIntakeState } from '../intake/weeklyPlanningIntakeReducer';
import { createEmptyWeeklyPlanningFactGraphV5 } from '../semantic/weeklyPlanningFactGraphV5';
import type { WeeklyPlanningDialogueRendererTrace } from '../trace/weeklyPlanningDialogueRendererTrace';
import type { WeeklyPlanningPendingTurn } from '../types';
import {
  recordCommittedWeeklyPlanningApplicationTurn,
  type WeeklyPlanningTurnSideEffectServices,
} from './weeklyPlanningTurnSideEffects';

const pending: WeeklyPlanningPendingTurn = {
  conversationId: 'conversation-1',
  turnId: 'conversation-1:turn:1',
  requestId: 'conversation-1:request:1',
  weekStartDate: '2026-07-27',
  baseRevision: 0,
  startedAt: '2026-07-30T00:00:00.000Z',
};

const rendererTrace: WeeklyPlanningDialogueRendererTrace = {
  actionId: 'stable-v5:conversation-1:request:1:status',
  actionKind: 'status',
  questionCode: null,
  request: {
    purpose: 'weekly_planning_renderer',
    requiredLabels: [],
    fallbackText: '条件を整理しました。',
    previewCount: 0,
  },
  response: {
    status: 'rendered',
    reason: null,
    rawResponse: '{"actionId":"stable-v5:conversation-1:request:1:status","text":"整理できました。"}',
    renderedText: '整理できました。',
  },
  decision: {
    branch: 'ai_rendered',
    responseSource: 'ai',
    finalMessage: '整理できました。',
  },
};

describe('weeklyPlanningTurnSideEffects renderer trace', () => {
  it('forwards the adopted renderer trace with the committed turn', async () => {
    const recordTurnTrace = vi.fn(async () => undefined);
    const services: WeeklyPlanningTurnSideEffectServices = {
      isStableV5Enabled: vi.fn(() => true),
      hasStagedGraph: vi.fn(() => true),
      finalizeRuntimeGraph: vi.fn(),
      discardStagedGraph: vi.fn(),
      getRuntimeSession: vi.fn(() => ({
        ownerId: 'owner-1',
        conversationId: 'conversation-1',
        graph: createEmptyWeeklyPlanningFactGraphV5(),
        updatedAt: Date.parse('2026-07-30T00:00:00.000Z'),
      })),
      recordTurnTrace,
    } as WeeklyPlanningTurnSideEffectServices;

    await recordCommittedWeeklyPlanningApplicationTurn({
      ownerId: 'owner-1',
      pending,
      userText: '予定を作りたい',
      result: {
        state: {
          ...createInitialPlanningIntakeState(),
          status: 'revision_pending',
        },
        message: '整理できました。',
        draftCandidates: [],
        responseSource: 'ai',
        dialogueRendererTrace: rendererTrace,
      },
    }, services);

    expect(recordTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      responseSource: 'ai',
      dialogueRendererTrace: rendererTrace,
      assistantMessage: '整理できました。',
      outcome: 'revision_pending',
    }));
  });
});
