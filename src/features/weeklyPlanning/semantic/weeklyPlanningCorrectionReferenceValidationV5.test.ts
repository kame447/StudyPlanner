import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningCorrectionTargetReferencesV5,
} from './weeklyPlanningCorrectionReferenceValidationV5';
import {
  createWeeklyPlanningSemanticRepairMessagesV5,
} from './weeklyPlanningSemanticRepairPromptV5';

function documentWithTarget(target: {
  publicId: string | null;
  localId: string | null;
  mention: string | null;
}): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [{
      localId: 'correction-1',
      target: {
        kind: 'temporal_constraint',
        ...target,
      },
      operation: 'remove',
      replacementLocalId: null,
      sourceText: '金曜日は20時以降を予定に入れないでください',
    }],
    decisions: [],
  };
}

function repairPayload(errors: string[]): {
  requiredChanges?: string[];
  validationErrors?: string[];
} {
  const messages = createWeeklyPlanningSemanticRepairMessagesV5({
    baseMessages: [{ role: 'system', content: 'normalize' }],
    invalidResponse: '{}',
    validationErrors: errors,
  });
  return JSON.parse(messages[messages.length - 1]?.content ?? '{}');
}

describe('Stable V5 correction target reference validation', () => {
  it('rejects mention-only correction targets before Fact Graph canonicalization', () => {
    expect(validateWeeklyPlanningCorrectionTargetReferencesV5(
      documentWithTarget({
        publicId: null,
        localId: null,
        mention: '金曜日は20時以降を予定に入れない',
      }),
    )).toEqual([
      'document.corrections[0].target:requires-id',
    ]);
  });

  it('accepts an exact existing public target', () => {
    expect(validateWeeklyPlanningCorrectionTargetReferencesV5(
      documentWithTarget({
        publicId: 'wpf_temporal_existing',
        localId: null,
        mention: '既存の制約',
      }),
    )).toEqual([]);
  });

  it('accepts a target declared by localId in the same semantic response', () => {
    expect(validateWeeklyPlanningCorrectionTargetReferencesV5(
      documentWithTarget({
        publicId: null,
        localId: 'temporal-current-turn',
        mention: null,
      }),
    )).toEqual([]);
  });

  it('tells repair not to resolve a lifecycle target from mention text', () => {
    const payload = repairPayload([
      'document.corrections[0].target:requires-id',
    ]);
    expect(payload.requiredChanges).toHaveLength(1);
    expect(payload.requiredChanges?.[0]).toContain('exact existing publicId');
    expect(payload.requiredChanges?.[0]).toContain('localId declared in this response');
    expect(payload.requiredChanges?.[0]).toContain('mention alone is not a target');
    expect(payload.requiredChanges?.[0]).toContain('remove that correction and keep the new fact');
    expect(payload.requiredChanges?.[0]).toContain('Preserve unrelated supported current-turn facts');
  });
});
