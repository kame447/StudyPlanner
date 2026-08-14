import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

describe('weekly planning semantic entry boundary', () => {
  it('removes the pre-Stable-V5 raw-text gate from production routing', () => {
    const assistant = source('../../../components/NaturalLanguageAssistant.tsx');
    const legacyText = source('../parsing/weeklyPlanningText.ts');

    expect(assistant).toContain('await routeWeeklyPlanningEntry(trimmedText)');
    expect(assistant).not.toContain('looksLikeWeeklyPlanningRequest');
    expect(legacyText).not.toContain('looksLikeWeeklyPlanningRequest');
    expect(legacyText).not.toContain('durationMentions');
  });

  it('keeps route meaning in structured AI output without keyword or regex repair', () => {
    const router = source('./weeklyPlanningEntryRouter.ts');

    expect(router).toContain("enum: ['chat', 'weekly_planning', 'ambiguous']");
    expect(router).toContain('Do not decide readiness, clarification, scheduling, preview, approval, or persistence.');
    expect(router).not.toContain('RegExp');
    expect(router).not.toContain('.match(');
    expect(router).not.toContain('.test(');
    expect(router).not.toContain('.includes(');
  });
});
