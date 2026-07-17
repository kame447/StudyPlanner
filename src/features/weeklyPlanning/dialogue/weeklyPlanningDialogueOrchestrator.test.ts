import { describe, expect, it } from 'vitest';
import {
  beginDialogueRequest,
  canIssueDialogueCall,
  createDialogueOrchestratorState,
  createDialogueTurnEnvelope,
  decideDialogueKeyboardAction,
  resetDialogueOrchestrator,
  transitionDialoguePhase,
  validateDialogueAsyncResult,
} from './weeklyPlanningDialogueOrchestrator';

function envelope(revision = 0) {
  return createDialogueTurnEnvelope({
    conversationId: 'conversation-1',
    inputStateRevision: revision,
    userText: '来週の予定を作りたい',
    createdAt: '2026-07-14T12:00:00Z',
    requestSequence: 1,
  });
}

describe('weeklyPlanningDialogueOrchestrator', () => {
  it('allows a single active request and opening only once', () => {
    const initial = createDialogueOrchestratorState();
    const first = beginDialogueRequest({ state: initial, envelope: envelope(), opening: true });
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;

    const duplicate = beginDialogueRequest({ state: first.state, envelope: envelope(), opening: true });
    expect(duplicate).toMatchObject({ accepted: false, reason: 'active-request' });

    const idle = transitionDialoguePhase(
      transitionDialoguePhase(
        transitionDialoguePhase(
          transitionDialoguePhase(
            transitionDialoguePhase(
              transitionDialoguePhase(first.state, 'applying'),
              'calculating',
            ),
            'planning_response',
          ),
          'validating_response',
        ),
        'rendering',
      ),
      'idle',
    );
    const secondOpening = beginDialogueRequest({ state: idle, envelope: envelope(), opening: true });
    expect(secondOpening).toMatchObject({ accepted: false, reason: 'duplicate-opening' });
  });

  it('silently classifies reordered and stale results', () => {
    const started = beginDialogueRequest({
      state: createDialogueOrchestratorState(),
      envelope: envelope(2),
    });
    if (!started.accepted) throw new Error('fixture failed');

    expect(validateDialogueAsyncResult({
      state: started.state,
      envelope: { ...started.envelope, requestId: 'other-request' },
      currentStateRevision: 2,
    })?.reason).toBe('request_id_mismatch');

    expect(validateDialogueAsyncResult({
      state: started.state,
      envelope: started.envelope,
      currentStateRevision: 3,
    })?.reason).toBe('state_revision_mismatch');
  });

  it('invalidates active response on reset', () => {
    const started = beginDialogueRequest({
      state: createDialogueOrchestratorState(),
      envelope: envelope(),
    });
    if (!started.accepted) throw new Error('fixture failed');
    const reset = resetDialogueOrchestrator(started.state);
    expect(validateDialogueAsyncResult({
      state: reset,
      envelope: started.envelope,
      currentStateRevision: 0,
    })?.reason).toBe('cancelled');
  });

  it('enforces opening and normal call budgets', () => {
    expect(canIssueDialogueCall({ kind: 'opening', issuedCalls: 0 })).toBe(true);
    expect(canIssueDialogueCall({ kind: 'opening', issuedCalls: 1 })).toBe(false);
    expect(canIssueDialogueCall({ kind: 'normal', issuedCalls: 1 })).toBe(true);
    expect(canIssueDialogueCall({ kind: 'normal', issuedCalls: 2 })).toBe(false);
  });

  it('uses Ctrl or Meta Enter for submit and never submits while composing', () => {
    expect(decideDialogueKeyboardAction({ key: 'Enter', isComposing: true, ctrlKey: true })).toBe('ignore');
    expect(decideDialogueKeyboardAction({ key: 'Enter', keyCode: 229, ctrlKey: true })).toBe('ignore');
    expect(decideDialogueKeyboardAction({ key: 'Enter' })).toBe('newline');
    expect(decideDialogueKeyboardAction({ key: 'Enter', shiftKey: true })).toBe('newline');
    expect(decideDialogueKeyboardAction({ key: 'Enter', ctrlKey: true })).toBe('submit');
    expect(decideDialogueKeyboardAction({ key: 'Enter', metaKey: true })).toBe('submit');
  });
});
