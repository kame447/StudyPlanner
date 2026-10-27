import { describe, expect, it } from 'vitest';
import { isWeeklyPlanningStableV5PreviewAuthorized } from './weeklyPlanningStableV5PlanningEvaluation';

describe('Stable V5 preview authorization', () => {
  it('does not treat create_plan emitted while answering a machine pending question as new approval', () => {
    expect(isWeeklyPlanningStableV5PreviewAuthorized({
      previousStatus: 'revision_pending',
      previousDraftGenerationIntent: null,
      planningIntent: 'create_plan',
      semanticChanged: true,
      hadMachinePendingQuestion: true,
    })).toBe(false);
  });

  it('preserves approval that was already given before a repair question', () => {
    expect(isWeeklyPlanningStableV5PreviewAuthorized({
      previousStatus: 'revision_pending',
      previousDraftGenerationIntent: 'user_authorized',
      planningIntent: 'create_plan',
      semanticChanged: true,
      hadMachinePendingQuestion: true,
    })).toBe(true);
  });

  it.each(['not_requested', 'user_authorized'] as const)('checks durable study authorization before updating a draft-ready preview: %s', previousDraftGenerationIntent => {
    expect(isWeeklyPlanningStableV5PreviewAuthorized({ previousStatus: 'draft_ready', previousDraftGenerationIntent,
      planningIntent: 'update_plan', semanticChanged: true })).toBe(previousDraftGenerationIntent === 'user_authorized');
  });

  it('still accepts a pure create_plan turn when no machine question was pending', () => {
    expect(isWeeklyPlanningStableV5PreviewAuthorized({
      previousStatus: 'revision_pending',
      previousDraftGenerationIntent: null,
      planningIntent: 'create_plan',
      semanticChanged: false,
      hadMachinePendingQuestion: false,
    })).toBe(true);
  });
});
