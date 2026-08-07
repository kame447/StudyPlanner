import { describe, expect, it } from 'vitest';
import {
  SEMANTIC_DURABLE_CONCERN_BASES_V5,
  WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5,
  createWeeklyPlanningSemanticSystemPromptV5,
} from './weeklyPlanningSemanticDocumentV5';

describe('Stable V5 durable concern basis contract', () => {
  it('requires a closed concern basis in provider JSON schema', () => {
    const schema = WEEKLY_PLANNING_SEMANTIC_RESPONSE_FORMAT_V5.json_schema.schema as any;
    const signal = schema.properties.tasks.items.properties.durableContextSignals.items;
    expect(signal.required).toContain('basis');
    expect(signal.properties.basis.enum).toEqual([...SEMANTIC_DURABLE_CONCERN_BASES_V5]);
  });

  it('has no generic catch-all basis and keeps the semantic boundary domain-independent', () => {
    expect(SEMANTIC_DURABLE_CONCERN_BASES_V5).not.toContain('other' as any);
    const prompt = createWeeklyPlanningSemanticSystemPromptV5();
    expect(prompt).toContain('If no basis is supported by current userText, emit no concern');
    expect(prompt).toContain('workload comparison alone supports none of these bases');
    expect(prompt).not.toContain('数学のワークの方が量は多い');
  });
});
