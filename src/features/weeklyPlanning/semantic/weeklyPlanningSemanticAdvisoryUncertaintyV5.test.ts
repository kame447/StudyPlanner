import { describe, expect, it } from 'vitest';
import { normalizeWeeklyPlanningSemanticPreParseV5 } from './weeklyPlanningSemanticPreParseNormalizationV5';
import {
  WEEKLY_PLANNING_SEMANTIC_LEGACY_RESPONSE_FORMAT_V5,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticSchemaV5';
import { createWeeklyPlanningSemanticMeaningPolicyV5 } from './weeklyPlanningSemanticMeaningPolicyV5';

const uncertainty = (field: string, flag?: unknown) => ({
  localId: `u-${field}`, targetLocalId: 'document', field, reason: 'r', sourceText: 's',
  ...(flag === undefined ? {} : { blocksPlanning: flag }),
});
const raw = (uncertainties: unknown[]) => JSON.stringify({
  schemaVersion: 'weekly-planning-semantic-v5', planningIntent: 'discuss', planningWindow: null, tasks: [], relations: [],
  availabilityDeclarations: [], constraintSourceRequests: [], userContextFacts: [], conversationActs: [], uncertainties,
  corrections: [], decisions: [],
});

describe('advisory uncertainty (blocksPlanning), interaction only (Issue #488 H)', () => {
  it('drops blocksPlanning:false for every field uniformly and strips the flag from kept entries', () => {
    const fields = ['one_day_completion_feasibility', 'work_breakdown', 'material', 'material_identity'];
    const result = normalizeWeeklyPlanningSemanticPreParseV5({
      rawResponse: raw([...fields.map((field) => uncertainty(field, false)), uncertainty('kept-true', true), uncertainty('kept-absent')]),
    });
    const parsed = JSON.parse(result.rawResponse) as { uncertainties: Array<Record<string, unknown>> };
    expect(parsed.uncertainties.map((entry) => entry.field)).toEqual(['kept-true', 'kept-absent']);
    expect(parsed.uncertainties.every((entry) => !('blocksPlanning' in entry))).toBe(true);
    expect(result.repairs).toContain(`advisory-uncertainty-not-committed:${fields.length}`);
  });

  it('leaves a non-boolean flag in place so validation rejects it', () => {
    const result = normalizeWeeklyPlanningSemanticPreParseV5({ rawResponse: raw([uncertainty('x', 'false')]) });
    expect((JSON.parse(result.rawResponse) as { uncertainties: Array<Record<string, unknown>> }).uncertainties[0].blocksPlanning).toBe('false');
  });

  it('legacy: the stage does not exist and the response is untouched', () => {
    const input = raw([uncertainty('x', false)]);
    const result = normalizeWeeklyPlanningSemanticPreParseV5({ rawResponse: input, semanticConversationActs: false });
    expect(result.rawResponse).toBe(input);
    expect(result.stages.map((stage) => stage.id)).not.toContain('advisory_uncertainty');
  });

  it('schema and meaning rule exist only in the interaction architecture', () => {
    const uncertaintyItems = (format: typeof WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5) =>
      ((format.json_schema.schema as { properties: { uncertainties: { items: { required: string[] } } } })
        .properties.uncertainties.items.required);
    expect(uncertaintyItems(WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5)).toContain('blocksPlanning');
    expect(uncertaintyItems(WEEKLY_PLANNING_SEMANTIC_LEGACY_RESPONSE_FORMAT_V5)).not.toContain('blocksPlanning');
    expect(createWeeklyPlanningSemanticMeaningPolicyV5('interaction_v1')).toContain('blocksPlanning');
    expect(createWeeklyPlanningSemanticMeaningPolicyV5('legacy_v5')).not.toContain('blocksPlanning');
  });
});
