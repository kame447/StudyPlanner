import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_DURABLE_CONCERN_BASES_V5,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  createWeeklyPlanningSemanticMeaningPolicyV5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

describe('Stable V5 durable concern basis contract', () => {
  it('requires a closed concern basis in provider JSON schema', () => {
    const schema = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as any;
    const signal = schema.properties.tasks.items.properties.durableContextSignals.items;
    expect(signal.required).toContain('basis');
    expect(signal.properties.basis.enum).toEqual([...SEMANTIC_DURABLE_CONCERN_BASES_V5]);
  });

  it('has no generic catch-all basis and keeps the semantic boundary domain-independent', () => {
    expect(SEMANTIC_DURABLE_CONCERN_BASES_V5).not.toContain('other' as any);
    const prompt = createWeeklyPlanningSemanticMeaningPolicyV5();
    expect(prompt).toContain('A concern requires explicit evidence');
    expect(prompt).toContain('workload size alone');
    expect(prompt).not.toContain('数学のワークの方が量は多い');
  });
});
