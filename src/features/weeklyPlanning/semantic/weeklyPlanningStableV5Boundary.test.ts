import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5,
  WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5,
  createEmptyWeeklyPlanningFactGraphV5,
} from './weeklyPlanningStableV5';

const DIRECT_CORE_FILES = [
  'weeklyPlanningSemanticDocumentV5.ts',
  'weeklyPlanningSemanticValidatorV5.ts',
  'weeklyPlanningFactGraphV5.ts',
  'weeklyPlanningSemanticCanonicalizerV5.ts',
  'weeklyPlanningSemanticCanonicalizerLifecycleV5.ts',
  'weeklyPlanningSemanticNormalizerV5.ts',
] as const;

function source(filename: string): string {
  return readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8');
}

describe('Stable V5 module boundary', () => {
  it('exports the Stable identifiers from one public module', () => {
    expect(WEEKLY_PLANNING_SEMANTIC_SCHEMA_VERSION_V5).toBe(
      'weekly-planning-semantic-v5',
    );
    expect(WEEKLY_PLANNING_FACT_GRAPH_VERSION_V5).toBe(
      'weekly-planning-fact-graph-v5',
    );
    expect(createEmptyWeeklyPlanningFactGraphV5()).toMatchObject({
      version: 'weekly-planning-fact-graph-v5',
      revision: 0,
      factLifecycles: [],
      appliedLifecycleOperationKeys: [],
    });
  });

  it('keeps direct Stable core independent from Alpha schema and old graph modules', () => {
    for (const filename of DIRECT_CORE_FILES) {
      const content = source(filename);
      expect(content, filename).not.toContain("from './weeklyPlanningSemanticDocument'");
      expect(content, filename).not.toContain("from './weeklyPlanningSemanticDocumentV2'");
      expect(content, filename).not.toContain("from './weeklyPlanningSemanticValidator'");
      expect(content, filename).not.toContain("from './weeklyPlanningSemanticValidatorV2'");
      expect(content, filename).not.toContain("from './weeklyPlanningFactGraph'");
      expect(content, filename).not.toContain("from './weeklyPlanningFactGraphV2'");
      expect(content, filename).not.toContain("from './weeklyPlanningSemanticCanonicalizer'");
      expect(content, filename).not.toContain("from './weeklyPlanningSemanticCanonicalizerV2'");
      expect(content, filename).not.toContain('projectToAlpha1');
      expect(content, filename).not.toContain('projectGraphToV1');
    }
  });

  it('keeps the scheduler compiler free from graph projection functions', () => {
    const content = source('weeklyPlanningGenericSchedulerInput.ts');
    expect(content).not.toContain('projectGraphToV1');
    expect(content).not.toContain('weekly-planning-fact-graph-v1');
    expect(content).not.toContain('weekly-planning-fact-graph-v2');
  });
});
