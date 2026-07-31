import { describe, expect, it } from 'vitest';
import {
  REQUIRED_WEEKLY_PLANNING_CONVERSATION_EVAL_CAPABILITIES,
  WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS,
  validateWeeklyPlanningConversationEvalScenarioManifests,
} from './weeklyPlanningConversationEvalScenarioManifest';

describe('weekly planning conversation eval scenario manifest', () => {
  it('covers every required capability with deterministic user utterances', () => {
    expect(
      validateWeeklyPlanningConversationEvalScenarioManifests(
        WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS,
      ),
    ).toEqual([]);

    const covered = new Set(
      WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS.flatMap(
        (scenario) => scenario.capabilities,
      ),
    );
    expect([...covered].sort()).toEqual(
      [...REQUIRED_WEEKLY_PLANNING_CONVERSATION_EVAL_CAPABILITIES].sort(),
    );
  });

  it('rejects missing capability coverage and duplicate scenario identity', () => {
    const duplicated = [
      {
        ...WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS[0],
        capabilities: ['natural_multiturn'] as const,
      },
      {
        ...WEEKLY_PLANNING_CONVERSATION_EVAL_SCENARIO_MANIFESTS[0],
        capabilities: ['natural_multiturn'] as const,
      },
    ];

    const errors = validateWeeklyPlanningConversationEvalScenarioManifests(duplicated);
    expect(errors).toContain('duplicate scenario id: tomorrow-natural-multiturn');
    expect(errors.some((error) => error.startsWith('duplicate initial utterance:'))).toBe(true);
    expect(errors).toContain('missing required capability: explicit_repair');
    expect(errors).toContain('missing required capability: preview_correction');
  });
});
