import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_DEFINITIONS_V5,
  WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_IDS_V5,
  normalizeWeeklyPlanningSemanticPreParseV5,
} from './weeklyPlanningSemanticPreParseNormalizationV5';

function decompositionResponse(): string {
  return JSON.stringify({
    schemaVersion: 'weekly-planning-semantic-v5',
    planningIntent: 'update_plan',
    planningWindow: null,
    tasks: [{
      localId: 'task-1',
      category: 'study',
      title: '課題を進める',
      decompositionStatus: 'needs_breakdown',
      study: null,
      workloads: [],
      effortEstimates: [],
      temporalConstraints: [],
      recurrence: [],
      sourceText: '課題を進めたい',
    }],
    relations: [],
    availabilityDeclarations: [],
    constraintSourceRequests: [],
    userContextFacts: [],
    uncertainties: [],
    corrections: [],
    decisions: [],
  });
}

function emptyProviderDeltaEnvelope(): string {
  return JSON.stringify({
    facts: [],
    corrections: [],
    execution: { approvalRequests: [] },
    uncertainties: [],
    grounding: {
      needsGrounding: false,
      targetFactIds: [],
      note: null,
    },
    notes: [],
  });
}

describe('Stable V5 semantic pre-parse normalization pipeline', () => {
  it('keeps provider-output rewrite order explicit and observable', () => {
    const result = normalizeWeeklyPlanningSemanticPreParseV5({
      rawResponse: decompositionResponse(),
    });

    expect(result.stages.map((stage) => stage.id)).toEqual(
      WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_IDS_V5,
    );
    expect(result.repairs).toContain(
      'task-decomposition-uncertainty-derived:0:task-1',
    );
    expect(result.stages.find((stage) => stage.id === 'task_decomposition_uncertainty')?.repairs)
      .toContain('task-decomposition-uncertainty-derived:0:task-1');
  });

  it('canonicalizes only a structurally explicit empty provider delta into a no-change V5 document', () => {
    const result = normalizeWeeklyPlanningSemanticPreParseV5({
      rawResponse: emptyProviderDeltaEnvelope(),
    });

    expect(JSON.parse(result.rawResponse)).toEqual({
      schemaVersion: 'weekly-planning-semantic-v5',
      planningIntent: 'discuss',
      planningWindow: null,
      tasks: [],
      relations: [],
      availabilityDeclarations: [],
      constraintSourceRequests: [],
      userContextFacts: [],
      uncertainties: [],
      corrections: [],
      decisions: [],
    });
    expect(result.repairs).toContain('empty-semantic-delta-envelope-canonicalized');
  });

  it('does not discard non-empty meaning from an incompatible provider envelope', () => {
    const rawResponse = JSON.stringify({
      facts: [{ kind: 'task', title: '課題' }],
      corrections: [],
      execution: { approvalRequests: [] },
      uncertainties: [],
      grounding: {
        needsGrounding: false,
        targetFactIds: [],
        note: null,
      },
      notes: [],
    });
    const result = normalizeWeeklyPlanningSemanticPreParseV5({ rawResponse });

    expect(result.rawResponse).toBe(rawResponse);
    expect(result.repairs).not.toContain('empty-semantic-delta-envelope-canonicalized');
  });

  it('requires every stage to declare one normalization category and owning invariant', () => {
    expect(Object.keys(WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_DEFINITIONS_V5))
      .toEqual([...WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_IDS_V5]);

    const definitions = Object.values(
      WEEKLY_PLANNING_SEMANTIC_PRE_PARSE_NORMALIZATION_STAGE_DEFINITIONS_V5,
    );
    expect(definitions.every((definition) => definition.owningInvariant.trim().length > 0))
      .toBe(true);
    expect(new Set(definitions.map((definition) => definition.owningInvariant)).size)
      .toBe(definitions.length);
  });

  it('is idempotent after the deterministic rewrites have been applied', () => {
    const first = normalizeWeeklyPlanningSemanticPreParseV5({
      rawResponse: decompositionResponse(),
    });
    const second = normalizeWeeklyPlanningSemanticPreParseV5({
      rawResponse: first.rawResponse,
    });

    expect(second.rawResponse).toBe(first.rawResponse);
    expect(second.repairs).toEqual([]);
    expect(second.stages.every((stage) => stage.repairs.length === 0)).toBe(true);
  });
});
