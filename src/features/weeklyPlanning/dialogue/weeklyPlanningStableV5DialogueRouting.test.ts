import { describe, expect, it } from 'vitest';
import {
  isWeeklyPlanningStableV5DialogueExplanationRequest,
  shouldUseAiWeeklyPlanningStableV5DialogueRenderer,
} from './weeklyPlanningStableV5DialogueRouting';

describe('Stable V5 dialogue renderer routing', () => {
  it('keeps ordinary machine-decided questions on the deterministic path', () => {
    expect(shouldUseAiWeeklyPlanningStableV5DialogueRenderer({
      actionKind: 'question',
      questionCode: 'missing_effort_estimate',
      currentUserMessage: '30分くらい',
    })).toBe(false);
  });

  it('uses AI when the user asks for an explanation of a machine question', () => {
    expect(isWeeklyPlanningStableV5DialogueExplanationRequest('それってどういう意味？')).toBe(true);
    expect(shouldUseAiWeeklyPlanningStableV5DialogueRenderer({
      actionKind: 'question',
      questionCode: 'missing_effort_estimate',
      currentUserMessage: 'それってどういう意味？',
    })).toBe(true);
  });

  it('keeps status and preview wording eligible for natural-language rendering', () => {
    expect(shouldUseAiWeeklyPlanningStableV5DialogueRenderer({
      actionKind: 'status',
      questionCode: null,
      currentUserMessage: '了解',
    })).toBe(true);
    expect(shouldUseAiWeeklyPlanningStableV5DialogueRenderer({
      actionKind: 'preview_ready',
      questionCode: null,
      currentUserMessage: 'それで作って',
    })).toBe(true);
  });
});
