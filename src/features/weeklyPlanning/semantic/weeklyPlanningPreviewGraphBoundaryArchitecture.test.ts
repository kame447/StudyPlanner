import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('weekly planning preview graph boundary', () => {
  it('does not pass the raw semantic graph into preview execution', () => {
    const runtime = source('../application/weeklyPlanningStableV5RuntimeExecutor.ts');

    expect(runtime).not.toContain(
      'graph: semantic.graph,\n    schedulerInput: responseRoute.schedulerInput,',
    );
    expect(runtime).toContain('createWeeklyPlanningPlacementGraphViewV5');
  });
});
