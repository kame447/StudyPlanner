import { describe, expect, it } from 'vitest';
import {
  WEEKLY_DIALOGUE_TAB_ORDER,
  createRetryDialogueEnvelope,
  decideWeeklyDialogueSubmit,
  shouldRestoreWeeklyDialogueFocus,
  validateWeeklyDialogueTabOrder,
} from './weeklyPlanningDialogueUiPolicy';
import {
  createDialogueOrchestratorState,
  createDialogueTurnEnvelope,
} from './weeklyPlanningDialogueOrchestrator';

describe('weeklyPlanningDialogueUiPolicy', () => {
  it('uses multiline-safe submit rules and blocks busy or empty submission', () => {
    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter' },
      phase: 'idle',
      hasText: true,
    })).toBe('newline');
    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter', ctrlKey: true },
      phase: 'idle',
      hasText: true,
    })).toBe('submit');
    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter', metaKey: true, isComposing: true },
      phase: 'idle',
      hasText: true,
    })).toBe('ignore');
    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter', ctrlKey: true },
      phase: 'interpreting',
      hasText: true,
    })).toBe('ignore');
    expect(decideWeeklyDialogueSubmit({
      event: { key: 'Enter', ctrlKey: true },
      phase: 'idle',
      hasText: false,
    })).toBe('ignore');
  });

  it('restores focus only after a completed or failed active turn', () => {
    expect(shouldRestoreWeeklyDialogueFocus({
      previousPhase: 'rendering',
      nextPhase: 'idle',
      mounted: true,
      modeActive: true,
    })).toBe(true);
    expect(shouldRestoreWeeklyDialogueFocus({
      previousPhase: 'rendering',
      nextPhase: 'idle',
      mounted: false,
      modeActive: true,
    })).toBe(false);
    expect(shouldRestoreWeeklyDialogueFocus({
      previousPhase: 'idle',
      nextPhase: 'idle',
      mounted: true,
      modeActive: true,
    })).toBe(false);
  });

  it('fixes one logical Tab order without duplicate controls', () => {
    expect(validateWeeklyDialogueTabOrder(WEEKLY_DIALOGUE_TAB_ORDER)).toBe(true);
    expect(validateWeeklyDialogueTabOrder([
      ...WEEKLY_DIALOGUE_TAB_ORDER.slice(0, -1),
      'reset-button',
    ])).toBe(false);
  });

  it('creates retry with a new request and turn identity', () => {
    const state = { ...createDialogueOrchestratorState(), requestSequence: 3 };
    const previous = createDialogueTurnEnvelope({
      conversationId: 'conversation-1',
      inputStateRevision: 1,
      userText: '来週の予定を作りたい',
      createdAt: '2026-07-14T10:00:00Z',
      requestSequence: 3,
    });
    const retry = createRetryDialogueEnvelope({
      state,
      previousEnvelope: previous,
      currentStateRevision: 2,
      createdAt: '2026-07-14T10:01:00Z',
    });
    expect(retry.requestId).not.toBe(previous.requestId);
    expect(retry.turnId).not.toBe(previous.turnId);
    expect(retry.inputStateRevision).toBe(2);
  });
});
