import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_DURABLE_CONCERN_BASES_V5,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
} from './weeklyPlanningSemanticDocumentV5';
import {
  WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5,
} from './weeklyPlanningSemanticMeaningPolicyV5';

describe('Stable V5 durable concern basis contract', () => {
  it('requires a closed concern basis in provider JSON schema', () => {
    const schema = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as any;
    const signal = schema.properties.tasks.items.properties.durableContextSignals.items;
    expect(signal.required).toContain('basis');
    expect(signal.properties.basis.enum).toEqual([...SEMANTIC_DURABLE_CONCERN_BASES_V5]);
  });

  it('keeps the semantic evidence boundary in addition to the closed enum', () => {
    expect(SEMANTIC_DURABLE_CONCERN_BASES_V5).not.toContain('other' as any);
    const rule = WEEKLY_PLANNING_SEMANTIC_MEANING_RULES_V5.find(
      (candidate) => candidate.id === 'durable_concern_basis',
    );

    expect(rule).toBeDefined();
    expect(rule?.instruction).toContain('explicitly supports one concern basis');
    expect(rule?.instruction).toContain('workload comparison alone supports none');
    expect(rule?.instruction).toContain('emit no concern signal');
    expect(rule?.instruction).toContain('do not invent a diagnosis');
  });
});
