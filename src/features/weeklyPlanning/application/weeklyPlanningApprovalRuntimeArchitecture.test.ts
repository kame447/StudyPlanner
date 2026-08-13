import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const resolverSource = readFileSync(
  new URL('./weeklyPlanningApprovalRuntimeResolver.ts', import.meta.url),
  'utf8',
);
const lookupSource = readFileSync(
  new URL('./weeklyPlanningApprovalRuntimeLookup.ts', import.meta.url),
  'utf8',
);

describe('weekly planning approval runtime architecture', () => {
  it('keeps preview-source classification in the resolver and concrete runtime lookup behind one facade', () => {
    expect(resolverSource).toContain("candidateSource === 'stable_v5'");
    expect(resolverSource).toContain("kind: 'mixed_runtime_sources'");
    expect(resolverSource).toContain('weeklyPlanningApprovalRuntimeLookup.stableV5(');
    expect(resolverSource).toContain('weeklyPlanningApprovalRuntimeLookup.compatibility()');

    expect(resolverSource).not.toContain('getWeeklyPlanningStableV5RuntimeSession');
    expect(resolverSource).not.toContain('getWeeklyPlanningSessionRuntime');
  });

  it('owns both concrete singleton lookups inside the runtime lookup boundary', () => {
    expect(lookupSource).toContain('getWeeklyPlanningStableV5RuntimeSession');
    expect(lookupSource).toContain('getWeeklyPlanningSessionRuntime');
    expect(lookupSource).toContain('createWeeklyPlanningApprovalRuntimeLookup(');
    expect(lookupSource).toContain('weeklyPlanningApprovalRuntimeLookup =');
    expect(lookupSource).toContain('stableV5(params)');
    expect(lookupSource).toContain('compatibility()');
  });
});
