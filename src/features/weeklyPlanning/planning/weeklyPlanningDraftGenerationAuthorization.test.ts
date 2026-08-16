import { describe, expect, it } from 'vitest';
import type { PlanningIntakeState } from '../intake/weeklyPlanningIntakeTypes';
import {
  applyDraftGenerationAuthorizationTurn,
  reduceDraftGenerationAuthorization,
  validateDraftGenerationAuthorizationCommand,
} from './weeklyPlanningDraftGenerationAuthorization';

function state(): PlanningIntakeState {
  return {
    status: 'draft_ready',
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
    shouldCreateDraft: true,
    shouldSavePlan: false,
    sourceTurns: ['条件を確認した'],
  };
}

describe('draft generation authorization command', () => {
  it('validates only the typed authorization command shape', () => {
    expect(validateDraftGenerationAuthorizationCommand({
      type: 'authorize_draft_generation',
      sourceText: 'この条件で仮の予定を組んで',
      confidence: 'high',
    })).toEqual({
      accepted: true,
      command: {
        type: 'authorize_draft_generation',
        sourceText: 'この条件で仮の予定を組んで',
        confidence: 'high',
      },
    });
  });

  it('rejects lifecycle and unknown properties at the validator boundary', () => {
    expect(validateDraftGenerationAuthorizationCommand({
      type: 'authorize_draft_generation',
      sourceText: '仮の予定を組んで',
      confidence: 'high',
      authorizedAtRevision: 99,
    })).toEqual({ accepted: false, reason: 'invalid-command' });
  });

  it('applies an already-selected authorization signal without parsing its wording', () => {
    const authorized = applyDraftGenerationAuthorizationTurn({
      state: state(),
      userText: 'semantic layer selected authorization',
    });
    expect(authorized).toMatchObject({
      draftGenerationIntent: 'user_authorized',
      draftGenerationAuthorizedAtRevision: 1,
    });

    const reset = reduceDraftGenerationAuthorization(authorized, {
      accepted: false,
      reason: 'invalid-command',
    });
    expect(reset.draftGenerationIntent).toBe('not_requested');
    expect(reset.draftGenerationAuthorizedAtRevision).toBeUndefined();
  });
});
