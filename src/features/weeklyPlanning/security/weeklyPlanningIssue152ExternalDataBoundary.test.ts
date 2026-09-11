import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const semanticTurnSource = readFileSync(
  new URL('../application/weeklyPlanningStableV5SemanticTurn.ts', import.meta.url),
  'utf8',
);
const semanticContextSource = readFileSync(
  new URL('../application/weeklyPlanningStableV5SemanticContext.ts', import.meta.url),
  'utf8',
);

describe('Issue #152 external untrusted data boundary', () => {
  it('keeps existing plan and timetable payload text out of the semantic LLM phase', () => {
    expect(semanticTurnSource).not.toContain('input.plans');
    expect(semanticTurnSource).not.toContain('input.scheduleTemplates');
    expect(semanticTurnSource).not.toContain('input.timetableTermId');

    expect(semanticContextSource).not.toContain('plans:');
    expect(semanticContextSource).not.toContain('scheduleTemplates:');
    expect(semanticContextSource).not.toContain('timetableTermId:');
  });

  it('introduces external scheduling data only after semantic interpretation', () => {
    expect(semanticTurnSource).toContain('createWeeklyPlanningSemanticPipelineV5');
    expect(semanticTurnSource).toContain('schedulerContext: initialSchedulerContext');
    expect(semanticTurnSource).not.toContain('externalSources:');
  });
});
