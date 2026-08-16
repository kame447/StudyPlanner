import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  type WeeklyPlanningSemanticDocumentV5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  validateWeeklyPlanningCorrectionTargetReferencesV5,
  validateWeeklyPlanningRawCorrectionTargetReferencesV5,
} from './weeklyPlanningCorrectionReferenceValidationV5';
import {
  createWeeklyPlanningSemanticRepairMessagesV5,
} from './weeklyPlanningSemanticRepairPromptV5';
import {
  validateWeeklyPlanningSemanticResponseV5,
} from './weeklyPlanningSemanticResponseValidationV5';

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

function documentWithEffortReplacement(): WeeklyPlanningSemanticDocumentV5 {
  return {
    schemaVersion: WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-vocab',
      existingPublicId: 'wpf_task_vocab',
      category: 'study',
      title: '英単語',
      decompositionStatus: 'atomic',
      study: {
        purpose: 'unknown',
        activityKind: 'memorization_retrieval',
        contextLabel: null,
        components: [],
      },
      workloads: [],
      effortEstimates: [{
        localId: 'effort-session-25',
        targetLocalId: 'task-vocab',
        kind: 'session_duration',
        minutes: 25,
        unitCode: 'session',
        precision: 'approximate',
        sourceText: '英単語は1回25分を目安にしてください',
      }],
      temporalConstraints: [],
      recurrence: [],
      durableContextSignals: [],
      sourceText: '英単語は1回25分を目安にしてください',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [{
      localId: 'correction-effort',
      target: {
        kind: 'effort_estimate',
        publicId: 'wpf_effort_per_unit',
        localId: null,
        mention: '英単語は1語5分くらい',
      },
      operation: 'replace',
      replacementLocalId: 'effort-session-25',
      sourceText: '英単語は1回25分を目安にしてください',
    }],
    decisions: [],
  };
}

const publicStateSummary = {
  effortEstimates: [{
    publicId: 'wpf_effort_per_unit',
    kind: 'duration_per_unit',
  }],
};

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

  it('rejects replacing an existing effort with a different measurement kind', () => {
    expect(validateWeeklyPlanningCorrectionTargetReferencesV5(
      documentWithEffortReplacement(),
      publicStateSummary,
    )).toEqual([
      'document.corrections[0]:effort-measurement-mismatch:duration_per_unit->session_duration',
    ]);
  });

  it('allows replacement when the effort measurement kind is the same', () => {
    expect(validateWeeklyPlanningCorrectionTargetReferencesV5(
      documentWithEffortReplacement(),
      {
        effortEstimates: [{
          publicId: 'wpf_effort_per_unit',
          kind: 'session_duration',
        }],
      },
    )).toEqual([]);
  });

  it('detects a correction invariant even when an unrelated schema field is invalid', () => {
    const document = documentWithEffortReplacement();
    const rawResponse = JSON.stringify({
      ...document,
      tasks: document.tasks.map((task) => ({
        ...task,
        study: null,
      })),
    });

    expect(validateWeeklyPlanningRawCorrectionTargetReferencesV5(
      rawResponse,
      publicStateSummary,
    )).toEqual([
      'document.corrections[0]:effort-measurement-mismatch:duration_per_unit->session_duration',
    ]);

    const result = validateWeeklyPlanningSemanticResponseV5(rawResponse, {
      publicStateSummary,
    });
    expect(result.document).toBeNull();
    expect(result.errors).toEqual(expect.arrayContaining([
      'document.tasks[0].study:required',
      'document.corrections[0]:effort-measurement-mismatch:duration_per_unit->session_duration',
    ]));
  });

  it('does not turn malformed provider JSON into a correction-specific error', () => {
    expect(validateWeeklyPlanningRawCorrectionTargetReferencesV5(
      '{not-json',
      publicStateSummary,
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

  it('tells repair to keep different effort measurements independent and fix every listed error', () => {
    const payload = repairPayload([
      'document.tasks[0].study:required',
      'document.corrections[0]:effort-measurement-mismatch:duration_per_unit->session_duration',
    ]);
    expect(payload.requiredChanges).toHaveLength(1);
    expect(payload.requiredChanges?.[0]).toContain('Effort measurement kinds are independent facts');
    expect(payload.requiredChanges?.[0]).toContain('remove that replace correction and keep the new effort fact');
    expect(payload.requiredChanges?.[0]).toContain('separate remove correction');
    expect(payload.requiredChanges?.[0]).toContain('Correct every listed validation failure');
  });
});
